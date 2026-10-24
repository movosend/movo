import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import {
  AccountSanction,
  AdminApplySanctionBody,
  AdminLiftSanctionBody,
  AdminSanctionPreview,
  AdminSanctionWithdrawal,
  AdminUserSanction,
  AdminUserSanctions,
  ApiError,
  AuditLogEntry,
  WithdrawOpenActivityResult,
} from "@movo/shared";
import { RequestContext } from "../../adapters/internal-client";
import { requireAdmin } from "../../utils/require-admin";
import { createAuditRepository } from "../audit/audit.repository";
import { createNameResolver, requireReason } from "../users/user-names";
import { sanctionsSchemas } from "./sanctions.schema";

/** Acciones de la bitácora que intentan el retiro de una sanción: su `context` trae `sanctionId` y `withdrawal`. */
export const WITHDRAWAL_ACTIONS = ["user.suspend", "user.disable", "user.sanction_withdraw"] as const;

interface SanctionParams {
  id: string;
  sanctionId: string;
}

/** Lo que queda en `context.withdrawal` de la bitácora. `attemptedAt` es el `createdAt` de la fila. */
type StoredWithdrawal = Omit<AdminSanctionWithdrawal, "attemptedAt">;

function toWithdrawal(result: WithdrawOpenActivityResult): StoredWithdrawal {
  return { status: result.failures.length > 0 ? "partial" : "complete", result, errorCode: null };
}

function isStoredWithdrawal(value: unknown): value is StoredWithdrawal {
  if (typeof value !== "object" || value === null) return false;
  const status = (value as { status?: unknown }).status;
  return status === "complete" || status === "partial" || status === "failed";
}

/**
 * Cómo quedó el retiro según una fila de la bitácora. `succeeded` trae el resultado en el
 * contexto (también si el retiro falló al aplicar la sanción: la sanción sí salió). `unknown` es
 * un reintento en el que `svc-shipments` no respondió. `failed` es un rechazo previo (conflicto,
 * sanción cerrada): no se intentó retirar nada, así que no cuenta.
 */
export function withdrawalFromAudit(entry: AuditLogEntry): AdminSanctionWithdrawal | null {
  if (entry.outcome === "succeeded") {
    const stored = entry.context?.withdrawal;
    return isStoredWithdrawal(stored) ? { ...stored, attemptedAt: entry.createdAt } : null;
  }
  if (entry.outcome === "unknown") {
    return { status: "failed", result: null, errorCode: entry.errorCode, attemptedAt: entry.createdAt };
  }
  return null;
}

/**
 * MOVO-299: sanciones de cuenta desde la ficha (MOVO-36). `svc-admin` orquesta: la regla de
 * conflicto y la bitácora (`runAdminAction`), la sanción en `svc-users` (MOVO-296) y el retiro de
 * la actividad abierta en `svc-shipments` (MOVO-297).
 *
 * Orden al sancionar (AC2): primero la sanción, así el gateway ya bloquea lo nuevo (MOVO-298);
 * después el retiro. Si el retiro falla o queda parcial, la sanción sigue aplicada, la fila de la
 * bitácora lo dice en `context.withdrawal` y el panel ofrece reintentar
 * (`POST .../:sanctionId/withdraw`, idempotente).
 */
export default async function sanctionsRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const auditRepository = createAuditRepository(app.db);
  const namesOf = createNameResolver(app);
  const ctxOf = (request: FastifyRequest): RequestContext => ({ requestId: request.requestId });

  /** Nombres de los admins y último intento de retiro de cada sanción. */
  async function enrich(userId: string, sanctions: AccountSanction[], ctx: RequestContext): Promise<AdminUserSanction[]> {
    const [nameOf, rows] = await Promise.all([
      namesOf(sanctions.flatMap((s) => [s.appliedBy, s.liftedBy]), ctx),
      auditRepository.listBySanction(
        userId,
        sanctions.map((s) => s.id),
        WITHDRAWAL_ACTIONS,
      ),
    ]);
    // Las filas vienen de la más reciente a la más vieja: gana el primer intento que cuenta.
    const latest = new Map<string, AdminSanctionWithdrawal>();
    for (const row of rows) {
      const sanctionId = row.context?.sanctionId;
      if (typeof sanctionId !== "string" || latest.has(sanctionId)) continue;
      const withdrawal = withdrawalFromAudit(row);
      if (withdrawal) latest.set(sanctionId, withdrawal);
    }
    return sanctions.map((s) => ({
      ...s,
      appliedByName: s.appliedBy ? nameOf(s.appliedBy) : null,
      liftedByName: s.liftedBy ? nameOf(s.liftedBy) : null,
      withdrawal: latest.get(s.id) ?? null,
    }));
  }

  /** La sanción tiene que ser de este usuario y seguir vigente (levantar o reintentar el retiro). */
  async function assertOpenSanction(userId: string, sanctionId: string, ctx: RequestContext): Promise<void> {
    const sanction = (await app.usersClient.listSanctions(userId, ctx)).find((s) => s.id === sanctionId);
    if (!sanction) throw new ApiError(404, "SANCTION_NOT_FOUND", "La sanción no existe.");
    if (sanction.liftedAt) throw new ApiError(409, "SANCTION_ALREADY_CLOSED", "La sanción ya está cerrada.");
  }

  app.get(
    "/users/:id/sanctions",
    { schema: { tags: ["admin"], summary: "Ficha: historial de sanciones (svc-users) con el estado del retiro", ...sanctionsSchemas.list } },
    async (request): Promise<AdminUserSanctions> => {
      requireAdmin(request);
      const { id } = request.params as { id: string };
      const ctx = ctxOf(request);
      return { items: await enrich(id, await app.usersClient.listSanctions(id, ctx), ctx) };
    },
  );

  app.get(
    "/users/:id/sanctions/preview",
    {
      schema: {
        tags: ["admin"],
        summary: "Qué retiraría una sanción hoy y qué envíos siguen su curso (svc-shipments)",
        description: "Solo lectura, sin bitácora. Es una foto: entre la vista previa y la confirmación algo puede cambiar.",
        ...sanctionsSchemas.preview,
      },
    },
    async (request): Promise<AdminSanctionPreview> => {
      requireAdmin(request);
      const { id } = request.params as { id: string };
      return app.shipmentsClient.getOpenActivity(id, ctxOf(request));
    },
  );

  app.post(
    "/users/:id/sanctions",
    {
      schema: {
        tags: ["admin"],
        summary: "Suspender o inhabilitar la cuenta",
        description:
          "Primero la sanción en svc-users y después el retiro de la actividad abierta en svc-shipments. Si el retiro " +
          "falla, la sanción queda aplicada y `withdrawal.status` es `partial` o `failed`: se reintenta con " +
          "`POST .../:sanctionId/withdraw`. Inhabilitar con envíos en curso responde 409 " +
          "`USER_HAS_IN_PROGRESS_SHIPMENTS` (`details.shipments`) sin aplicar nada. 403 `ADMIN_CONFLICT_OF_INTEREST` " +
          "sobre uno mismo. Bitácora: `user.suspend` / `user.disable`, con nota interna, plazo y lo retirado.",
        ...sanctionsSchemas.apply,
      },
    },
    async (request, reply): Promise<AdminUserSanction> => {
      const adminId = requireAdmin(request);
      const { id } = request.params as { id: string };
      const ctx = ctxOf(request);
      const raw = request.body as AdminApplySanctionBody;
      const internalNote = raw.internalNote?.trim();
      const body: AdminApplySanctionBody = {
        type: raw.type,
        reason: requireReason(raw.reason),
        ...(internalNote ? { internalNote } : {}),
        ...(raw.endsAt ? { endsAt: raw.endsAt } : {}),
      };

      const { sanction, withdrawal } = await app.audit.runAdminAction(
        {
          adminId,
          action: body.type === "suspension" ? "user.suspend" : "user.disable",
          target: { type: "user", id },
          reason: body.reason,
          context: { type: body.type, internalNote: body.internalNote ?? null, endsAt: body.endsAt ?? null },
          // AC3: inhabilitar es permanente y corta el login; con un envío en curso, la contraparte queda colgada.
          ...(body.type === "disable"
            ? {
                precheck: async () => {
                  const shipments = await app.shipmentsClient.listInProgressShipments(id, ctx);
                  if (shipments.length > 0) {
                    throw new ApiError(
                      409,
                      "USER_HAS_IN_PROGRESS_SHIPMENTS",
                      "La cuenta tiene envíos en curso: suspendela primero y esperá a que terminen.",
                      { shipments },
                    );
                  }
                },
              }
            : {}),
          resolveContext: (result) => ({ sanctionId: result.sanction.id, withdrawal: result.withdrawal }),
          requestId: request.requestId,
        },
        async () => {
          const applied = await app.usersClient.applySanction(id, body, adminId, ctx);
          // La sanción ya está aplicada: un retiro fallido no la deshace ni hace fallar la acción.
          let stored: StoredWithdrawal;
          try {
            stored = toWithdrawal(await app.shipmentsClient.withdrawOpenActivity(id, applied.id, ctx));
          } catch (error) {
            app.log.warn(
              { err: error, event: "admin_sanction_withdrawal_failed", userId: id, sanctionId: applied.id, requestId: ctx.requestId },
              "Sanción aplicada pero no se pudo retirar la actividad abierta",
            );
            stored = { status: "failed", result: null, errorCode: error instanceof ApiError ? error.code : "INTERNAL_ERROR" };
          }
          return { sanction: applied, withdrawal: stored };
        },
      );

      const nameOf = await namesOf([adminId], ctx);
      reply.code(201);
      return {
        ...sanction,
        appliedByName: sanction.appliedBy ? nameOf(sanction.appliedBy) : null,
        liftedByName: null,
        withdrawal: { ...withdrawal, attemptedAt: new Date().toISOString() },
      };
    },
  );

  app.post(
    "/users/:id/sanctions/:sanctionId/lift",
    {
      schema: {
        tags: ["admin"],
        summary: "Levantar una sanción vigente",
        description:
          "Lo retirado no vuelve: los envíos cancelados y las ofertas retiradas quedan así. 403 " +
          "`ADMIN_CONFLICT_OF_INTEREST` sobre la propia sanción. Bitácora: `user.sanction_lift`.",
        ...sanctionsSchemas.lift,
      },
    },
    async (request): Promise<AdminUserSanction> => {
      const adminId = requireAdmin(request);
      const { id, sanctionId } = request.params as SanctionParams;
      const ctx = ctxOf(request);
      const reason = requireReason((request.body as AdminLiftSanctionBody).reason);
      const lifted = await app.audit.runAdminAction(
        {
          adminId,
          action: "user.sanction_lift",
          target: { type: "user", id },
          reason,
          context: { sanctionId },
          precheck: () => assertOpenSanction(id, sanctionId, ctx),
          requestId: request.requestId,
        },
        () => app.usersClient.liftSanction(id, sanctionId, reason, adminId, ctx),
      );
      const [enriched] = await enrich(id, [lifted], ctx);
      return enriched ?? { ...lifted, appliedByName: null, liftedByName: null, withdrawal: null };
    },
  );

  app.post(
    "/users/:id/sanctions/:sanctionId/withdraw",
    {
      schema: {
        tags: ["admin"],
        summary: "Reintentar el retiro de la actividad abierta de una sanción vigente",
        description:
          "Idempotente: solo toma lo que sigue abierto. 502 `SHIPMENTS_SERVICE_UNAVAILABLE` si svc-shipments no " +
          "responde. Bitácora: `user.sanction_withdraw`.",
        ...sanctionsSchemas.retryWithdrawal,
      },
    },
    async (request): Promise<AdminSanctionWithdrawal> => {
      const adminId = requireAdmin(request);
      const { id, sanctionId } = request.params as SanctionParams;
      const ctx = ctxOf(request);
      const stored = await app.audit.runAdminAction(
        {
          adminId,
          action: "user.sanction_withdraw",
          target: { type: "user", id },
          context: { sanctionId },
          precheck: () => assertOpenSanction(id, sanctionId, ctx),
          resolveContext: (withdrawal) => ({ withdrawal }),
          requestId: request.requestId,
        },
        async () => toWithdrawal(await app.shipmentsClient.withdrawOpenActivity(id, sanctionId, ctx)),
      );
      return { ...stored, attemptedAt: new Date().toISOString() };
    },
  );
}
