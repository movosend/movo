import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import {
  AdminChatPage,
  AdminDisputeDetail,
  AdminDisputeHandshakeEvent,
  AdminDisputeNote,
  AdminDisputeNotePage,
  AdminDisputePage,
  AdminDisputePhotos,
  AdminDisputeResolutionPreview,
  AdminDisputeTrace,
  ApiError,
  DISPUTE_REASONING_MAX_LENGTH,
  DISPUTE_REASONING_MIN_LENGTH,
  DisputeStatus,
  ResolveDisputeRequest,
  ResolveDisputeResponse,
  splitDisputeStake,
} from "@movo/shared";
import { AdminDisputeNote as AdminDisputeNoteRow } from "../../generated/prisma/client";
import { RequestContext } from "../../adapters/internal-client";
import { requireAdmin } from "../../utils/require-admin";
import { decodeCursor, encodeCursor } from "../audit/audit.service";
import { UNKNOWN_USER_NAME } from "../users/users.routes";
import { createDisputeNotesRepository } from "./dispute-notes.repository";
import { disputesSchemas } from "./disputes.schema";

const toQuery = (raw: object): URLSearchParams => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw as Record<string, string | number | boolean | undefined>)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return query;
};

/**
 * MOVO-337 (backend de MOVO-34): disputas para el panel. `svc-shipments` es el dueño del expediente y de la
 * resolución (`/internal/admin/disputes*`); acá van el rol admin, la regla de conflicto de interés, la bitácora, las
 * notas internas (nunca llegan a las partes) y la validación previa del mínimo de una captura parcial (AC6).
 *
 * Las lecturas no dejan bitácora ni regla de conflicto; las escrituras (`dispute.resolve`, `dispute.note_add`) pasan por
 * `runAdminAction`. El objetivo de la bitácora es la disputa (`targetType: dispute`).
 */
export default async function disputesRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const notes = createDisputeNotesRepository(app.db);
  const ctxOf = (request: FastifyRequest): RequestContext => ({ requestId: request.requestId });
  const idOf = (request: FastifyRequest) => (request.params as { id: string }).id;
  const notFound = () => new ApiError(404, "DISPUTE_NOT_FOUND", "Disputa no encontrada.");

  /** Nombres de los admins de las notas: best-effort, una sección no se cae por un nombre. */
  async function adminNames(ids: string[], ctx: RequestContext): Promise<(id: string) => string> {
    let found: Array<{ id: string; fullName: string }> = [];
    try {
      found = await app.usersClient.getUserNames([...new Set(ids)], ctx);
    } catch (error) {
      app.log.warn({ err: error, event: "admin_user_names_unavailable", requestId: ctx.requestId }, "No se pudieron resolver los nombres");
    }
    const byId = new Map(found.map((user) => [user.id, user.fullName]));
    return (id) => byId.get(id) ?? UNKNOWN_USER_NAME;
  }

  const toNote = (row: AdminDisputeNoteRow, nameOf: (id: string) => string): AdminDisputeNote => ({
    id: row.id,
    disputeId: row.disputeId,
    adminId: row.adminId,
    adminName: nameOf(row.adminId),
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  });

  /** El `shipmentId` de la disputa, para los bloques que salen del envío (fotos, chat). */
  async function shipmentIdOf(disputeId: string, ctx: RequestContext): Promise<string> {
    const parties = await app.shipmentsClient.getDisputeParties(disputeId, ctx);
    if (!parties) throw notFound();
    return parties.shipmentId;
  }

  // ---- Lecturas (una ruta por bloque del expediente, para que cada uno cargue por separado) ----

  app.get(
    "/disputes",
    {
      schema: {
        tags: ["admin"],
        summary: "Disputas de la plataforma",
        description:
          "Más reciente primero, paginado por cursor y filtrable por `status` (`open`, `resolving`, `resolved`), motivo, " +
          "resultado, fecha de apertura y `q` (código del envío o nombre de una parte). Cada fila trae las partes, el " +
          "motivo, la fecha de apertura y el estado del envío al abrirse; `statusCounts` son los totales por estado con " +
          "los mismos filtros, sin `status`.",
        ...disputesSchemas.list,
      },
    },
    async (request): Promise<AdminDisputePage> => {
      requireAdmin(request);
      return app.shipmentsClient.listAdminDisputes(toQuery(request.query as object), ctxOf(request));
    },
  );

  app.get(
    "/disputes/:id",
    {
      schema: {
        tags: ["admin"],
        summary: "Expediente de una disputa: apertura, descargos y resolución",
        description:
          "La disputa con su descripción, las fotos de la apertura, los descargos y la ampliación de cada parte, y la " +
          "resolución (resultado, monto, razonamiento, admin) si ya la tiene. Las fotos son URLs firmadas de vida corta. " +
          "Los demás bloques tienen su propia ruta: `/photos`, `/handshake`, `/trace`, `/chat`, `/notes`.",
        ...disputesSchemas.detail,
      },
    },
    async (request): Promise<AdminDisputeDetail> => {
      requireAdmin(request);
      const dispute = await app.shipmentsClient.getAdminDispute(idOf(request), ctxOf(request));
      if (!dispute) throw notFound();
      return dispute;
    },
  );

  app.get(
    "/disputes/:id/photos",
    {
      schema: {
        tags: ["admin"],
        summary: "Fotos de retiro y entrega del envío disputado",
        description: "Las fotos de evidencia del envío (URL firmada de vida corta), las mismas de `GET /admin/shipments/:id/photos`.",
        ...disputesSchemas.photos,
      },
    },
    async (request): Promise<AdminDisputePhotos> => {
      requireAdmin(request);
      const ctx = ctxOf(request);
      const shipmentId = await shipmentIdOf(idOf(request), ctx);
      const photos = await app.shipmentsClient.getAdminShipmentPhotos(shipmentId, ctx);
      if (!photos) throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      return photos;
    },
  );

  app.get(
    "/disputes/:id/handshake",
    {
      schema: {
        tags: ["admin"],
        summary: "Eventos del handshake de custodia",
        description: "Retiro y entrega: quién confirmó, quién generó el QR, cuándo y a qué distancia estaban.",
        ...disputesSchemas.handshake,
      },
    },
    async (request): Promise<AdminDisputeHandshakeEvent[]> => {
      requireAdmin(request);
      const events = await app.shipmentsClient.getDisputeHandshake(idOf(request), ctxOf(request));
      if (!events) throw notFound();
      return events;
    },
  );

  app.get(
    "/disputes/:id/trace",
    {
      schema: {
        tags: ["admin"],
        summary: "Traza GPS disponible",
        description:
          "La traza que se guarda con custodia (desde el retiro hasta la entrega, retención de 30 días). `available: false` " +
          "si nunca hubo retiro o ya se purgó. No se cachea.",
        ...disputesSchemas.trace,
      },
    },
    async (request, reply): Promise<AdminDisputeTrace> => {
      requireAdmin(request);
      const trace = await app.shipmentsClient.getDisputeTrace(idOf(request), ctxOf(request));
      if (!trace) throw notFound();
      reply.header("Cache-Control", "no-store");
      return trace;
    },
  );

  app.get(
    "/disputes/:id/chat",
    {
      schema: {
        tags: ["admin"],
        summary: "Chat del envío disputado, en solo lectura",
        description: "Lo mismo que `GET /admin/shipments/:id/chat/messages` del envío de la disputa.",
        ...disputesSchemas.chat,
      },
    },
    async (request): Promise<AdminChatPage> => {
      requireAdmin(request);
      const ctx = ctxOf(request);
      const shipmentId = await shipmentIdOf(idOf(request), ctx);
      const page = await app.shipmentsClient.getAdminShipmentChat(shipmentId, toQuery(request.query as object), ctx);
      if (!page) throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      return page;
    },
  );

  app.get(
    "/disputes/:id/resolution-preview",
    {
      schema: {
        tags: ["admin"],
        summary: "Qué pasaría con cada resultado",
        description:
          "Con lo que hay hoy en `svc-payments` (hold autorizado o cobro acreditado): el monto en juego, la acción de pago " +
          "y el estado final del envío de cada resultado, el reparto de cada porcentaje predefinido y el piso de una " +
          "captura parcial (`minimumPartialArs`, solo con el hold sin capturar).",
        ...disputesSchemas.preview,
      },
    },
    async (request, reply): Promise<AdminDisputeResolutionPreview> => {
      requireAdmin(request);
      const preview = await app.shipmentsClient.getDisputeResolutionPreview(idOf(request), ctxOf(request));
      if (!preview) throw notFound();
      reply.header("Cache-Control", "no-store");
      return preview;
    },
  );

  app.get(
    "/disputes/:id/notes",
    {
      schema: {
        tags: ["admin"],
        summary: "Notas internas de la disputa",
        description: "Solo las ve el panel: nunca se exponen a las partes.",
        ...disputesSchemas.notes,
      },
    },
    async (request): Promise<AdminDisputeNotePage> => {
      requireAdmin(request);
      const ctx = ctxOf(request);
      const id = idOf(request);
      const { limit, cursor } = request.query as { limit: number; cursor?: string };
      await shipmentIdOf(id, ctx);
      // Uno de más para saber si hay otra página sin un COUNT, igual que la bitácora.
      const rows = await notes.list(id, limit + 1, cursor ? decodeCursor(cursor) : undefined);
      const items = rows.slice(0, limit);
      const last = items[items.length - 1];
      const nameOf = await adminNames(items.map((row) => row.adminId), ctx);
      return {
        items: items.map((row) => toNote(row, nameOf)),
        nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
      };
    },
  );

  // ---- Escrituras (regla de conflicto de interés + bitácora) ----

  app.post(
    "/disputes/:id/notes",
    {
      schema: {
        tags: ["admin"],
        summary: "Agregar una nota interna (no se edita ni se borra; las partes nunca la ven)",
        description: "Bitácora: `dispute.note_add`. Un admin que es parte del envío recibe 403 `ADMIN_CONFLICT_OF_INTEREST`.",
        ...disputesSchemas.addNote,
      },
    },
    async (request, reply): Promise<AdminDisputeNote> => {
      const adminId = requireAdmin(request);
      const id = idOf(request);
      const ctx = ctxOf(request);
      const body = (request.body as { body: string }).body.trim();
      if (!body) throw new ApiError(400, "VALIDATION_FAILED", "La nota no puede estar vacía.");
      const row = await app.audit.runAdminAction(
        {
          adminId,
          action: "dispute.note_add",
          target: { type: "dispute", id },
          resolveContext: (created) => ({ noteId: created.id }),
          requestId: request.requestId,
        },
        () => notes.insert({ disputeId: id, adminId, body }),
      );
      reply.code(201);
      return toNote(row, await adminNames([adminId], ctx));
    },
  );

  app.post(
    "/disputes/:id/resolve",
    {
      schema: {
        tags: ["admin"],
        summary: "Resolver una disputa",
        description:
          "Regla de conflicto de interés (403 `ADMIN_CONFLICT_OF_INTEREST` si el admin es parte del envío), bitácora " +
          "`dispute.resolve` (incluidos los rechazos) y llamada a `svc-shipments`, que ejecuta la acción de pago de la " +
          "matriz de resolución (liberar el hold, capturar total o parcial, reembolsar total o parcial, o acreditar al " +
          "transportista en su cuenta corriente), pasa el envío a su estado final (`cancelled` si gana el emisor, " +
          "`completed` si gana el transportista o es parcial), levanta el bloqueo del transportista y avisa a las tres " +
          "partes (`dispute_resolved`). `reasoning` es obligatorio; `partial` lleva `percentage` (del set predefinido) o " +
          "`amountArs` (lo que conserva el transportista), no ambos. Una captura parcial por debajo de la comisión del " +
          "hold más la de Mercado Pago es 422 `DISPUTE_PARTIAL_BELOW_MINIMUM` con `details.minimumArs`. Si la acción de " +
          "pago falla, la disputa NO queda resuelta: queda `resolving`, con alerta, y se reintenta con los mismos datos " +
          "(502 `DISPUTE_PAYMENT_FAILED`). Es idempotente: resolver dos veces no mueve plata dos veces (`replayed: true`); " +
          "con otros datos es 409 `DISPUTE_RESOLUTION_MISMATCH`.",
        ...disputesSchemas.resolve,
      },
    },
    async (request): Promise<ResolveDisputeResponse> => {
      const adminId = requireAdmin(request);
      const id = idOf(request);
      const ctx = ctxOf(request);
      const body = request.body as ResolveDisputeRequest;
      const reasoning = body.reasoning.trim();
      let adminName = "";

      return app.audit.runAdminAction(
        {
          adminId,
          action: "dispute.resolve",
          target: { type: "dispute", id },
          reason: reasoning,
          context: {
            outcome: body.outcome,
            ...(body.percentage !== undefined ? { percentage: body.percentage } : {}),
            ...(body.amountArs !== undefined ? { amountArs: body.amountArs } : {}),
          },
          resolveContext: (result) => ({
            paymentAction: result.paymentAction,
            carrierAmountArs: result.carrierAmountArs,
            senderAmountArs: result.senderAmountArs,
            shipmentStatus: result.shipmentStatus,
            replayed: result.replayed,
          }),
          requestId: request.requestId,
          // Lecturas previas, después de la regla de conflicto: si fallan la fila es `failed` (nada se aplicó).
          precheck: async () => {
            if (reasoning.length < DISPUTE_REASONING_MIN_LENGTH || reasoning.length > DISPUTE_REASONING_MAX_LENGTH) {
              throw new ApiError(
                400,
                "VALIDATION_FAILED",
                `El razonamiento tiene que tener entre ${DISPUTE_REASONING_MIN_LENGTH} y ${DISPUTE_REASONING_MAX_LENGTH} caracteres.`,
              );
            }
            if (body.outcome !== "partial" && (body.percentage !== undefined || body.amountArs !== undefined)) {
              throw new ApiError(400, "DISPUTE_PARTIAL_INVALID", "El porcentaje y el monto solo aplican a un resultado parcial.");
            }
            if (body.outcome === "partial" && (body.percentage === undefined) === (body.amountArs === undefined)) {
              throw new ApiError(
                400,
                "DISPUTE_PARTIAL_INVALID",
                "Un resultado parcial lleva un porcentaje del set predefinido o un monto libre, no ambos ni ninguno.",
              );
            }

            const dispute = await app.shipmentsClient.getAdminDispute(id, ctx);
            if (!dispute) throw notFound();
            // Con el resultado ya guardado (`resolving`, o `resolved` en un reintento) el hold puede estar capturado ya:
            // lo valida `svc-shipments` contra lo guardado, y un monto distinto es 409 `DISPUTE_RESOLUTION_MISMATCH`.
            if (dispute.status === DisputeStatus.OPEN && body.outcome === "partial") {
              const preview = await app.shipmentsClient.getDisputeResolutionPreview(id, ctx);
              if (!preview) throw notFound();
              const split = splitDisputeStake(preview.stakeArs, body.outcome, {
                ...(body.percentage !== undefined && { percentage: body.percentage }),
                ...(body.amountArs !== undefined && { amountArs: body.amountArs }),
              });
              if ("error" in split) {
                if (split.error === "below_minimum") {
                  throw new ApiError(422, "DISPUTE_PARTIAL_BELOW_MINIMUM", "El monto parcial es demasiado chico: no llega a un centavo para el transportista.", {
                    minimumArs: 0.01,
                    stakeArs: preview.stakeArs,
                  });
                }
                if (split.error === "above_maximum") {
                  throw new ApiError(422, "DISPUTE_PARTIAL_ABOVE_MAXIMUM", "El monto parcial tiene que ser menor al total en juego.", {
                    maximumArs: Math.round((preview.stakeArs - 0.01) * 100) / 100,
                    stakeArs: preview.stakeArs,
                  });
                }
                throw new ApiError(400, "DISPUTE_PARTIAL_INVALID", "El porcentaje no es uno de los predefinidos o el monto no es válido.");
              }
              // AC6: la captura parcial no puede quedar por debajo de la comisión del hold más la de MP.
              if (preview.minimumPartialArs !== null && split.carrierAmountArs < preview.minimumPartialArs) {
                throw new ApiError(
                  422,
                  "DISPUTE_PARTIAL_BELOW_MINIMUM",
                  "El monto parcial no cubre la comisión de Movo más la de Mercado Pago.",
                  { minimumArs: preview.minimumPartialArs, holdAmountArs: preview.stakeArs },
                );
              }
            }

            // Falla cerrado: `svc-shipments` guarda el nombre del admin en el evento inmutable del envío.
            const names = await app.usersClient.getUserNames([adminId], ctx);
            const name = names.find((candidate) => candidate.id === adminId)?.fullName;
            if (!name) throw new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "No se pudo identificar al admin.");
            adminName = name;
          },
        },
        () =>
          app.shipmentsClient.resolveDispute(
            id,
            {
              outcome: body.outcome,
              reasoning,
              ...(body.percentage !== undefined && { percentage: body.percentage }),
              ...(body.amountArs !== undefined && { amountArs: body.amountArs }),
              adminId,
              adminName,
            },
            ctx,
          ),
      );
    },
  );
}
