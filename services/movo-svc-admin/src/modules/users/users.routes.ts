import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import {
  AdminContactUpdateBody,
  AdminContactUpdateResult,
  AdminLedgerAdjustmentBody,
  AdminLedgerAdjustmentResult,
  AdminSessionsRevokeResult,
  AdminShipmentRole,
  AdminUserAuditPage,
  AdminUserKyc,
  AdminUserLedger,
  AdminUserNote,
  AdminUserNotePage,
  AdminUserPage,
  AdminUserProfile,
  AdminUserRatings,
  AdminUserRef,
  AdminUserShipmentPage,
  AdminUserTripPage,
  ApiError,
} from "@movo/shared";
import { AdminUserNote as AdminUserNoteRow } from "../../generated/prisma/client";
import { RequestContext } from "../../adapters/internal-client";
import { requireAdmin } from "../../utils/require-admin";
import { decodeCursor, encodeCursor } from "../audit/audit.service";
import { maskContact } from "../../utils/mask-contact";
import { createNotesRepository } from "./notes.repository";
import { createNameResolver, requireReason } from "./user-names";
import { usersSchemas } from "./users.schema";

// Reexportado: los tests de la ficha lo importan desde acá.
export { UNKNOWN_USER_NAME } from "./user-names";

interface IdParams {
  id: string;
}

interface PageQuery {
  page: number;
  pageSize: number;
}

interface CursorQuery {
  limit: number;
  cursor?: string;
}

/**
 * MOVO-294: búsqueda de usuarios y ficha del panel (MOVO-293), más las acciones de soporte sobre la
 * cuenta. Cada sección `GET /admin/users/:id/<sección>` consulta solo a su servicio dueño: si cae,
 * esa ruta responde 502 `<SERVICIO>_SERVICE_UNAVAILABLE` y las demás siguen (AC3 de MOVO-293). Las
 * lecturas no dejan bitácora; las escrituras pasan por `runAdminAction` (conflicto de interés +
 * bitácora, decisiones 4 y 5 de MOVO-286).
 */
export default async function usersRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const notes = createNotesRepository(app.db);
  const ctxOf = (request: FastifyRequest): RequestContext => ({ requestId: request.requestId });
  const idOf = (request: FastifyRequest) => (request.params as IdParams).id;

  const namesOf = createNameResolver(app);

  /** El ajuste de saldo y las notas no los decide `svc-users`: se verifica antes que el usuario exista. */
  async function assertUserExists(id: string, ctx: RequestContext, opts: { allowDeleted: boolean }): Promise<void> {
    const profile = await app.usersClient.getUserProfile(id, ctx);
    if (!opts.allowDeleted && profile.accountStatus === "deleted") {
      throw new ApiError(409, "USER_DELETED", "La cuenta está dada de baja.");
    }
  }

  const toNote = (row: AdminUserNoteRow, nameOf: (id: string) => string): AdminUserNote => ({
    id: row.id,
    body: row.body,
    adminId: row.adminId,
    adminName: nameOf(row.adminId),
    createdAt: row.createdAt.toISOString(),
  });

  // ---- Lecturas ----

  app.get(
    "/users",
    { schema: { tags: ["admin"], summary: "Buscar usuarios por nombre, email, teléfono o DNI", ...usersSchemas.search } },
    async (request): Promise<AdminUserPage> => {
      requireAdmin(request);
      const { q, page, pageSize } = request.query as { q: string } & PageQuery;
      return app.usersClient.searchUsers({ q: q.trim(), page, pageSize }, ctxOf(request));
    },
  );

  app.get(
    "/users/:id",
    { schema: { tags: ["admin"], summary: "Ficha: datos de la cuenta (svc-users)", ...usersSchemas.profile } },
    async (request): Promise<AdminUserProfile> => {
      requireAdmin(request);
      return app.usersClient.getUserProfile(idOf(request), ctxOf(request));
    },
  );

  app.get(
    "/users/:id/kyc",
    {
      schema: {
        tags: ["admin"],
        summary: "Ficha: KYC de identidad y licencia (svc-users) y cuenta de Mercado Pago (svc-payments)",
        description:
          "Si svc-users no responde, 502 `USERS_SERVICE_UNAVAILABLE`. Si el que no responde es svc-payments, " +
          "`mercadoPago` es `null` y el resto de la sección responde igual.",
        ...usersSchemas.kyc,
      },
    },
    async (request): Promise<AdminUserKyc> => {
      requireAdmin(request);
      const ctx = ctxOf(request);
      // Pagos no puede tirar el KYC de identidad (review de PR #279): su falla solo vacía su tarjeta.
      const [kyc, mercadoPago] = await Promise.all([
        app.usersClient.getUserKyc(idOf(request), ctx),
        app.paymentsClient.getUserMercadoPago(idOf(request), ctx).catch((error: unknown) => {
          app.log.warn({ err: error, event: "admin_user_mp_unavailable", requestId: ctx.requestId }, "No se pudo leer la cuenta de MP");
          return null;
        }),
      ]);
      return { ...kyc, mercadoPago };
    },
  );

  app.get(
    "/users/:id/vehicle",
    { schema: { tags: ["admin"], summary: "Ficha: vehículo (svc-users)", ...usersSchemas.vehicle } },
    async (request) => {
      requireAdmin(request);
      return app.usersClient.getUserVehicle(idOf(request), ctxOf(request));
    },
  );

  app.get(
    "/users/:id/shipments",
    { schema: { tags: ["admin"], summary: "Ficha: envíos en los que participa (svc-shipments)", ...usersSchemas.shipments } },
    async (request): Promise<AdminUserShipmentPage> => {
      requireAdmin(request);
      const ctx = ctxOf(request);
      const { role, status, page, pageSize } = request.query as { role?: AdminShipmentRole; status?: string } & PageQuery;
      const result = await app.shipmentsClient.listUserShipments(
        idOf(request),
        { page, pageSize, ...(role ? { role } : {}), ...(status ? { status } : {}) },
        ctx,
      );
      const nameOf = await namesOf(result.items.flatMap((item) => [item.senderId, item.carrierId, item.receiverId]), ctx);
      const ref = (id: string): AdminUserRef => ({ id, fullName: nameOf(id) });
      return {
        ...result,
        items: result.items.map(({ senderId, carrierId, receiverId, ...item }) => ({
          ...item,
          sender: ref(senderId),
          carrier: carrierId ? ref(carrierId) : null,
          receiver: ref(receiverId),
        })),
      };
    },
  );

  app.get(
    "/users/:id/trips",
    { schema: { tags: ["admin"], summary: "Ficha: viajes declarados como transportista (svc-shipments)", ...usersSchemas.trips } },
    async (request): Promise<AdminUserTripPage> => {
      requireAdmin(request);
      const { status, page, pageSize } = request.query as { status?: string } & PageQuery;
      return app.shipmentsClient.listUserTrips(idOf(request), { page, pageSize, ...(status ? { status } : {}) }, ctxOf(request));
    },
  );

  app.get(
    "/users/:id/ratings",
    { schema: { tags: ["admin"], summary: "Ficha: calificaciones recibidas y promedio (svc-shipments)", ...usersSchemas.ratings } },
    async (request): Promise<AdminUserRatings> => {
      requireAdmin(request);
      const ctx = ctxOf(request);
      const { page, pageSize } = request.query as PageQuery;
      const result = await app.shipmentsClient.listUserRatings(idOf(request), { page, pageSize }, ctx);
      const nameOf = await namesOf(result.items.map((item) => item.raterId), ctx);
      return {
        ...result,
        items: result.items.map(({ raterId, ...item }) => ({ ...item, rater: { id: raterId, fullName: nameOf(raterId) } })),
      };
    },
  );

  app.get(
    "/users/:id/moderation",
    { schema: { tags: ["admin"], summary: "Ficha: reportes y bloqueos en las dos direcciones (svc-users)", ...usersSchemas.moderation } },
    async (request) => {
      requireAdmin(request);
      return app.usersClient.getUserModeration(idOf(request), ctxOf(request));
    },
  );

  app.get(
    "/users/:id/ledger",
    { schema: { tags: ["admin"], summary: "Ficha: cuenta corriente (svc-payments, DD-044)", ...usersSchemas.ledger } },
    async (request): Promise<AdminUserLedger> => {
      requireAdmin(request);
      const ctx = ctxOf(request);
      const { limit, cursor } = request.query as CursorQuery;
      const result = await app.paymentsClient.getUserLedger(idOf(request), { limit, ...(cursor ? { cursor } : {}) }, ctx);
      const nameOf = await namesOf(result.items.map((item) => item.adminId), ctx);
      return {
        ...result,
        items: result.items.map(({ adminId, ...item }) => ({ ...item, adminName: adminId ? nameOf(adminId) : null })),
      };
    },
  );

  app.get(
    "/users/:id/devices",
    { schema: { tags: ["admin"], summary: "Ficha: dispositivos y clave del handshake (svc-users)", ...usersSchemas.devices } },
    async (request) => {
      requireAdmin(request);
      return app.usersClient.getUserDevices(idOf(request), ctxOf(request));
    },
  );

  app.get(
    "/users/:id/audit-log",
    { schema: { tags: ["admin"], summary: "Ficha: acciones de admins sobre este usuario (bitácora)", ...usersSchemas.auditLog } },
    async (request): Promise<AdminUserAuditPage> => {
      requireAdmin(request);
      const { limit, cursor } = request.query as CursorQuery;
      const page = await app.audit.list({ targetType: "user", targetId: idOf(request) }, limit, cursor);
      const nameOf = await namesOf(page.items.map((item) => item.adminId), ctxOf(request));
      return {
        items: page.items.map((item) => ({
          id: item.id,
          adminId: item.adminId,
          adminName: nameOf(item.adminId),
          action: item.action,
          reason: item.reason,
          outcome: item.outcome,
          errorCode: item.errorCode,
          createdAt: item.createdAt,
        })),
        nextCursor: page.nextCursor,
      };
    },
  );

  app.get(
    "/users/:id/notes",
    { schema: { tags: ["admin"], summary: "Ficha: notas internas del panel", ...usersSchemas.notes } },
    async (request): Promise<AdminUserNotePage> => {
      requireAdmin(request);
      const { limit, cursor } = request.query as CursorQuery;
      // Uno de más para saber si hay otra página sin un COUNT, igual que la bitácora.
      const rows = await notes.list(idOf(request), limit + 1, cursor ? decodeCursor(cursor) : undefined);
      const items = rows.slice(0, limit);
      const last = items[items.length - 1];
      const nameOf = await namesOf(items.map((row) => row.adminId), ctxOf(request));
      return {
        items: items.map((row) => toNote(row, nameOf)),
        nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
      };
    },
  );

  // ---- Acciones de soporte (escrituras) ----

  app.post(
    "/users/:id/sessions/revoke",
    {
      schema: {
        tags: ["admin"],
        summary: "Cerrar todas las sesiones del usuario (app y, si es admin, panel)",
        description: "No impide volver a entrar: para eso está la sanción. Bitácora: `user.sessions_revoke`.",
        ...usersSchemas.revokeSessions,
      },
    },
    async (request): Promise<AdminSessionsRevokeResult> => {
      const adminId = requireAdmin(request);
      const id = idOf(request);
      const reason = requireReason((request.body as { reason: string }).reason);
      return app.audit.runAdminAction(
        { adminId, action: "user.sessions_revoke", target: { type: "user", id }, reason, requestId: request.requestId },
        () => app.usersClient.revokeUserSessions(id, adminId, ctxOf(request)),
      );
    },
  );

  app.post(
    "/users/:id/contact",
    {
      schema: {
        tags: ["admin"],
        summary: "Cambiar el email o el teléfono del usuario",
        description:
          "El valor nuevo queda sin verificar, se cierran sus sesiones y se avisa por email. 409 `CONTACT_CHANGED` si " +
          "el valor actual ya no es `expectedCurrent`. Bitácora: `user.contact_update`, con el valor anterior y el " +
          "nuevo enmascarados.",
        ...usersSchemas.updateContact,
      },
    },
    async (request): Promise<AdminContactUpdateResult> => {
      const adminId = requireAdmin(request);
      const id = idOf(request);
      const { field, newValue, expectedCurrent, reason: rawReason } = request.body as AdminContactUpdateBody;
      const reason = requireReason(rawReason);
      const updated = await app.audit.runAdminAction(
        {
          adminId,
          action: "user.contact_update",
          target: { type: "user", id },
          reason,
          // Enmascarado: la bitácora no se puede editar y sobrevive a la baja de la cuenta.
          context: { field, previous: maskContact(field, expectedCurrent) },
          // Lo que falló después del cambio (ya aplicado): el admin lo ve en la bitácora y lo reintenta.
          resolveContext: (updated) => ({
            next: maskContact(field, updated[field]),
            noticeFailed: updated.noticeFailed,
            sessionsRevokeFailed: updated.sessionsRevokeFailed,
          }),
          requestId: request.requestId,
        },
        () => app.usersClient.updateUserContact(id, { field, newValue, expectedCurrent }, adminId, ctxOf(request)),
      );
      // `noticeFailed`/`sessionsRevokeFailed` solo van a la bitácora: el panel no los muestra.
      return {
        email: updated.email,
        emailVerified: updated.emailVerified,
        phone: updated.phone,
        phoneVerified: updated.phoneVerified,
        revokedRefreshTokens: updated.revokedRefreshTokens,
      };
    },
  );

  app.post(
    "/users/:id/ledger/adjustments",
    {
      schema: {
        tags: ["admin"],
        summary: "Ajuste manual de saldo (DD-044)",
        description:
          "`amountArs` con signo (positivo = debe), distinto de cero y dentro del tope de svc-payments (422 " +
          "`AMOUNT_OUT_OF_RANGE`). Idempotente por `idempotencyKey`: reintentar con la misma no duplica el movimiento. " +
          "Bitácora: `user.ledger_adjust`.",
        ...usersSchemas.adjustLedger,
      },
    },
    async (request): Promise<AdminLedgerAdjustmentResult> => {
      const adminId = requireAdmin(request);
      const id = idOf(request);
      const ctx = ctxOf(request);
      const body = request.body as AdminLedgerAdjustmentBody;
      const reason = requireReason(body.reason);
      const { result } = await app.audit.runAdminAction(
        {
          adminId,
          action: "user.ledger_adjust",
          target: { type: "user", id },
          reason,
          context: { amountArs: body.amountArs, idempotencyKey: body.idempotencyKey },
          precheck: () => assertUserExists(id, ctx, { allowDeleted: false }),
          // Un reintento con la misma key no crea otro movimiento: la fila lo dice, así la bitácora no
          // aparenta dos ajustes (review de PR #279).
          resolveContext: ({ created }) => ({ repeated: !created }),
          requestId: request.requestId,
        },
        async () => {
          const { entry, balanceArs, created } = await app.paymentsClient.createLedgerAdjustment(
            id,
            // Prefijo propio: la key de la cuenta corriente es única entre todos los movimientos.
            { idempotencyKey: `admin-adjustment:${body.idempotencyKey}`, amountArs: body.amountArs, reason, adminId },
            ctx,
          );
          const nameOf = await namesOf([adminId], ctx);
          const adjusted: AdminLedgerAdjustmentResult = {
            entry: {
              id: entry.id,
              type: entry.type,
              amountArs: entry.amountArs,
              status: entry.status,
              shipmentId: entry.shipmentId,
              reason: entry.reason,
              adminName: nameOf(adminId),
              createdAt: entry.createdAt,
            },
            balanceArs,
          };
          return { result: adjusted, created };
        },
      );
      return result;
    },
  );

  app.post(
    "/users/:id/notes",
    {
      schema: {
        tags: ["admin"],
        summary: "Agregar una nota interna (no se edita ni se borra; el usuario nunca la ve)",
        description: "Se puede sobre una cuenta dada de baja. Bitácora: `user.note_add`.",
        ...usersSchemas.addNote,
      },
    },
    async (request, reply): Promise<AdminUserNote> => {
      const adminId = requireAdmin(request);
      const id = idOf(request);
      const ctx = ctxOf(request);
      const body = (request.body as { body: string }).body.trim();
      if (!body) throw new ApiError(400, "VALIDATION_FAILED", "La nota no puede estar vacía.");
      const row = await app.audit.runAdminAction(
        {
          adminId,
          action: "user.note_add",
          target: { type: "user", id },
          precheck: () => assertUserExists(id, ctx, { allowDeleted: true }),
          resolveContext: (created) => ({ noteId: created.id }),
          requestId: request.requestId,
        },
        () => notes.insert({ userId: id, adminId, body }),
      );
      reply.code(201);
      return toNote(row, await namesOf([adminId], ctx));
    },
  );
}
