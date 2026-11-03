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

/**
 * Rechazos de un reintento que cortan antes de llamar a `svc-shipments` (regla de conflicto y
 * `assertOpenSanction`). Un `failed` con otro código sí llegó a intentar el retiro.
 */
const REJECTED_BEFORE_WITHDRAWAL = new Set([
  "ADMIN_CONFLICT_OF_INTEREST",
  "USER_NOT_FOUND",
  "SANCTION_NOT_FOUND",
  "SANCTION_ALREADY_CLOSED",
]);

/**
 * Lo que queda en `context.withdrawal` de la bitácora. `attemptedAt` lo fija la ruta y es el mismo
 * que va en la respuesta; las filas anteriores a guardarlo usan el `createdAt` de la fila.
 */
type StoredWithdrawal = Omit<AdminSanctionWithdrawal, "attemptedAt"> & { attemptedAt?: string };

function toWithdrawal(result: WithdrawOpenActivityResult, attemptedAt: string): AdminSanctionWithdrawal {
  return { status: result.failures.length > 0 ? "partial" : "complete", result, errorCode: null, attemptedAt };
}

function isStoredWithdrawal(value: unknown): value is StoredWithdrawal {
  if (typeof value !== "object" || value === null) return false;
  const status = (value as { status?: unknown }).status;
  return status === "complete" || status === "partial" || status === "failed";
}

/**
 * Cómo quedó un intento de retiro según una fila de la bitácora. `succeeded` trae el resultado en
 * el contexto (también si el retiro falló al aplicar la sanción: la sanción sí salió). `unknown` es
 * un reintento en el que `svc-shipments` no respondió. `failed` es un reintento que llegó a
 * `svc-shipments` y falló, salvo que lo haya cortado un rechazo previo (`REJECTED_BEFORE_WITHDRAWAL`,
 * o un servicio caído en el `precheck`: en la acción eso sería `unknown`), que no cuenta.
 */
export function withdrawalFromAudit(entry: AuditLogEntry): AdminSanctionWithdrawal | null {
  if (entry.outcome === "succeeded") {
    const stored = entry.context?.withdrawal;
    return isStoredWithdrawal(stored) ? { ...stored, attemptedAt: stored.attemptedAt ?? entry.createdAt } : null;
  }
  const code = entry.errorCode ?? "INTERNAL_ERROR";
  if (entry.outcome === "failed" && (REJECTED_BEFORE_WITHDRAWAL.has(code) || code.endsWith("_SERVICE_UNAVAILABLE"))) {
    return null;
  }
  return { status: "failed", result: null, errorCode: code, attemptedAt: entry.createdAt };
}

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/**
 * El retiro de una sanción sumando todos sus intentos, del más reciente al más viejo: `status`,
 * `errorCode`, `attemptedAt` y `failures` son del último; lo retirado y los avisos se acumulan (un
 * reintento solo encuentra lo que quedó y no repite avisos). `null` si ningún intento contó.
 */
export function accumulateWithdrawals(attempts: AdminSanctionWithdrawal[]): AdminSanctionWithdrawal | null {
  const [latest] = attempts;
  if (!latest) return null;
  let total: WithdrawOpenActivityResult | null = null;
  for (const { result } of attempts) {
    if (!result) continue;
    total = total
      ? {
          cancelledShipmentIds: union(total.cancelledShipmentIds, result.cancelledShipmentIds),
          withdrawnOfferIds: union(total.withdrawnOfferIds, result.withdrawnOfferIds),
          cancelledTripIds: union(total.cancelledTripIds, result.cancelledTripIds),
          stoppedRecurrenceTripIds: union(total.stoppedRecurrenceTripIds, result.stoppedRecurrenceTripIds),
          notifiedCounterpartyCount: total.notifiedCounterpartyCount + result.notifiedCounterpartyCount,
          failures: total.failures,
        }
      : { ...result, failures: latest.result?.failures ?? [] };
  }
  return { ...latest, result: total };
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

  /** Nombres de los admins y el retiro de cada sanción, sumando sus intentos. */
  async function enrich(userId: string, sanctions: AccountSanction[], ctx: RequestContext): Promise<AdminUserSanction[]> {
    const [nameOf, rows] = await Promise.all([
      namesOf(sanctions.flatMap((s) => [s.appliedBy, s.liftedBy]), ctx),
      auditRepository.listBySanction(
        userId,
        sanctions.map((s) => s.id),
        WITHDRAWAL_ACTIONS,
      ),
    ]);
    // Las filas vienen de la más reciente a la más vieja, y en ese orden quedan los intentos.
    const attempts = new Map<string, AdminSanctionWithdrawal[]>();
    for (const row of rows) {
      const sanctionId = row.context?.sanctionId;
      if (typeof sanctionId !== "string") continue;
      const withdrawal = withdrawalFromAudit(row);
      if (withdrawal) attempts.set(sanctionId, [...(attempts.get(sanctionId) ?? []), withdrawal]);
    }
    return sanctions.map((s) => ({
      ...s,
      appliedByName: s.appliedBy ? nameOf(s.appliedBy) : null,
      liftedByName: s.liftedBy ? nameOf(s.liftedBy) : null,
      withdrawal: accumulateWithdrawals(attempts.get(s.id) ?? []),
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
          // No es atómico con la sanción (`svc-users` no lo revalida): un envío que se compromete entre los
          // dos sigue adelante. Carrera aceptada, DD-049.
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
          let withdrawal: AdminSanctionWithdrawal;
          try {
            withdrawal = toWithdrawal(await app.shipmentsClient.withdrawOpenActivity(id, applied.id, ctx), new Date().toISOString());
          } catch (error) {
            app.log.warn(
              { err: error, event: "admin_sanction_withdrawal_failed", userId: id, sanctionId: applied.id, requestId: ctx.requestId },
              "Sanción aplicada pero no se pudo retirar la actividad abierta",
            );
            withdrawal = {
              status: "failed",
              result: null,
              errorCode: error instanceof ApiError ? error.code : "INTERNAL_ERROR",
              attemptedAt: new Date().toISOString(),
            };
          }
          return { sanction: applied, withdrawal };
        },
      );

      const nameOf = await namesOf([adminId], ctx);
      reply.code(201);
      return {
        ...sanction,
        appliedByName: sanction.appliedBy ? nameOf(sanction.appliedBy) : null,
        liftedByName: null,
        withdrawal,
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
          "`ADMIN_CONFLICT_OF_INTEREST` sobre la propia sanción. Responde la sanción cerrada de svc-users, sin " +
          "nombres ni retiro: el historial completo es `GET .../sanctions`. Bitácora: `user.sanction_lift`.",
        ...sanctionsSchemas.lift,
      },
    },
    async (request): Promise<AccountSanction> => {
      const adminId = requireAdmin(request);
      const { id, sanctionId } = request.params as SanctionParams;
      const ctx = ctxOf(request);
      const reason = requireReason((request.body as AdminLiftSanctionBody).reason);
      return app.audit.runAdminAction(
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
      return app.audit.runAdminAction(
        {
          adminId,
          action: "user.sanction_withdraw",
          target: { type: "user", id },
          context: { sanctionId },
          precheck: () => assertOpenSanction(id, sanctionId, ctx),
          resolveContext: (withdrawal) => ({ withdrawal }),
          requestId: request.requestId,
        },
        async () => toWithdrawal(await app.shipmentsClient.withdrawOpenActivity(id, sanctionId, ctx), new Date().toISOString()),
      );
    },
  );
}
