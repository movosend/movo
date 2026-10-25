import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import {
  AdminShipmentStatus,
  AdminUserKyc,
  AdminUserProfile,
  ApiError,
  SupportAgent,
  SupportAttachmentCreateBody,
  SupportAttachmentCreateResult,
  SupportConversation,
  SupportCounts,
  SupportEventsPage,
  SupportInternalActor,
  SupportInternalRow,
  SupportListPage,
  SupportListQuery,
  SupportMessage,
  SupportMessagesPage,
  SupportPatchBody,
  SupportSendBody,
  SupportUserContext,
  SupportUserShipment,
  SupportVerificationBadge,
  SUPPORT_QUICK_REPLIES,
  supportShipmentCode,
} from "@movo/shared";
import { RequestContext } from "../../adapters/internal-client";
import { requireAdmin } from "../../utils/require-admin";
import { UNKNOWN_USER_NAME } from "../users/users.routes";
import { entryNameIds, readStream, toPanelEvents } from "./support-events";
import { messageNameIds, NameDirectory, rowNameIds, toConversation, toMessage, toRow } from "./support.presenter";
import { supportSchemas } from "./support.schema";

/** Nombre con el que firma un agente si `svc-users` no responde (el mensaje igual sale). */
const FALLBACK_AGENT_NAME = "Equipo de Movo";
/** Mínimo de caracteres para buscar usuarios por nombre en `svc-users` (el resto de la búsqueda la hace svc-shipments). */
const NAME_SEARCH_MIN_LENGTH = 2;
const NAME_SEARCH_MAX_USERS = 50;
const RECENT_SHIPMENTS = 5;

const SHIPMENT_STATUS_VIEW: Record<AdminShipmentStatus, { label: string; tone: SupportUserShipment["tone"] }> = {
  awaiting_receiver_confirmation: { label: "Esperando al receptor", tone: "info" },
  rejected_by_receiver: { label: "Rechazado por el receptor", tone: "danger" },
  published: { label: "Publicado", tone: "info" },
  assignment_pending: { label: "Asignando", tone: "info" },
  assigned_unfunded: { label: "Asignado sin pago", tone: "warning" },
  assigned: { label: "Asignado", tone: "info" },
  in_transit: { label: "En viaje", tone: "info" },
  delivered: { label: "Entregado", tone: "success" },
  completed: { label: "Completado", tone: "success" },
  cancelled: { label: "Cancelado", tone: "neutral" },
  disputed: { label: "En disputa", tone: "danger" },
};

/** "Av. Colón 1234, Córdoba" → "Av. Colón 1234": la ruta del contexto es corta. */
const shortAddress = (address: string) => address.split(",")[0]?.trim() || address;

/** Insignias de verificación (AC10): contacto verificado, KYC de identidad y licencia vigente. */
export function verificationBadges(profile: AdminUserProfile, kyc: Omit<AdminUserKyc, "mercadoPago">, now: Date): SupportVerificationBadge[] {
  const badges: SupportVerificationBadge[] = [];
  if (profile.emailVerified && profile.phoneVerified) badges.push("identity");
  if (kyc.identity.status === "approved") badges.push("kyc_approved");
  else if (kyc.identity.status === "pending" || kyc.identity.status === "manual_review") badges.push("kyc_pending");
  const licenseExpiry = kyc.license.expiresAt ? new Date(kyc.license.expiresAt) : null;
  if (kyc.license.status === "approved" && (!licenseExpiry || licenseExpiry > now)) badges.push("license_valid");
  return badges;
}

/** Acción de la bitácora de un `PATCH`: la específica si cambia un solo campo, `support.update` si cambian varios. */
function patchAction(body: SupportPatchBody): string {
  const keys = Object.keys(body);
  if (keys.length !== 1) return "support.update";
  switch (keys[0]) {
    case "assignedTo":
      return "support.assign";
    case "priority":
      return "support.priority";
    case "topic":
      return "support.topic";
    case "tags":
      return "support.tags";
    default:
      return body.shipmentId === null ? "support.unlink_shipment" : "support.link_shipment";
  }
}

/**
 * MOVO-322: la bandeja de soporte del panel (`/admin/support/*`, rol admin). `svc-shipments` es dueño del modelo
 * (`/internal/admin/support/*`); acá se completan los nombres (`svc-users`, best-effort), se arma el contexto del
 * usuario y toda escritura pasa por `runAdminAction` (regla de conflicto: un admin no actúa sobre su propia consulta, y
 * bitácora). Leer, marcar como leída y pedir eventos no se registran.
 */
export default async function supportRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const ctxOf = (request: FastifyRequest): RequestContext => ({ requestId: request.requestId });
  const idOf = (request: FastifyRequest) => (request.params as { id: string }).id;
  const target = (id: string) => ({ type: "support_conversation" as const, id });

  /** Nombres y roles best-effort: si `svc-users` no responde se muestra `UNKNOWN_USER_NAME` (como la ficha). */
  async function directory(ids: string[], ctx: RequestContext): Promise<NameDirectory> {
    const unique = [...new Set(ids)];
    let found: Array<{ id: string; fullName: string; roles: string[] }> = [];
    if (unique.length > 0) {
      try {
        found = await app.usersClient.getUserNames(unique, ctx);
      } catch (error) {
        app.log.warn({ err: error, event: "support_names_unavailable", requestId: ctx.requestId }, "No se pudieron resolver los nombres");
      }
    }
    const byId = new Map(found.map((user) => [user.id, user]));
    return { nameOf: (id) => byId.get(id)?.fullName ?? UNKNOWN_USER_NAME, rolesOf: (id) => byId.get(id)?.roles ?? [] };
  }

  /** Quién actúa, con su nombre para los eventos ("Lucía Bustos tomó la conversación") y el de pila para el usuario. */
  async function actorOf(adminId: string, ctx: RequestContext): Promise<SupportInternalActor & { actorFirstName: string }> {
    const names = await directory([adminId], ctx);
    const fullName = names.nameOf(adminId);
    if (fullName === UNKNOWN_USER_NAME) return { actorId: adminId, actorFullName: FALLBACK_AGENT_NAME, actorFirstName: FALLBACK_AGENT_NAME };
    return { actorId: adminId, actorFullName: fullName, actorFirstName: fullName.split(" ")[0] ?? fullName };
  }

  /** Usuarios cuyo nombre coincide con la búsqueda (best-effort: sin `svc-users` se busca solo por código y texto). */
  async function userIdsMatching(q: string | undefined, ctx: RequestContext): Promise<string[]> {
    const text = q?.trim();
    if (!text || text.length < NAME_SEARCH_MIN_LENGTH) return [];
    try {
      const page = await app.usersClient.searchUsers({ q: text, page: 1, pageSize: NAME_SEARCH_MAX_USERS }, ctx);
      return page.items.map((user) => user.id);
    } catch (error) {
      app.log.warn({ err: error, event: "support_user_search_unavailable", requestId: ctx.requestId }, "Búsqueda por nombre no disponible");
      return [];
    }
  }

  async function filtersOf(query: Omit<SupportListQuery, "cursor">, adminId: string, ctx: RequestContext) {
    const userIds = await userIdsMatching(query.q, ctx);
    return {
      status: query.status,
      ...(query.assignee ? { assignee: query.assignee === "me" ? adminId : query.assignee } : {}),
      ...(query.q?.trim() ? { q: query.q.trim() } : {}),
      ...(userIds.length > 0 ? { userIds } : {}),
    };
  }

  async function presentConversation(row: SupportInternalRow, ctx: RequestContext): Promise<SupportConversation> {
    return toConversation(row, await directory(rowNameIds(row), ctx));
  }

  async function countsFor(adminId: string, ctx: RequestContext): Promise<SupportCounts> {
    return app.supportClient.counts({ status: "open", viewerId: adminId }, ctx);
  }

  app.get(
    "/support/conversations",
    {
      schema: {
        tags: ["admin"],
        summary: "Bandeja de soporte",
        description:
          "MOVO-322 AC2: por estado, agente (`me`, `none` o un id) y búsqueda (nombre del usuario, `SOP-NNNN`, código del " +
          "envío o texto de los mensajes). Abiertas y esperando: prioridad y después mayor espera; resueltas: última " +
          "actividad. `waitMinutes` lo calcula el servidor. Páginas de 30.",
        ...supportSchemas.list,
      },
    },
    async (request): Promise<SupportListPage> => {
      const adminId = requireAdmin(request);
      const ctx = ctxOf(request);
      const query = request.query as SupportListQuery;
      const page = await app.supportClient.list({ ...(await filtersOf(query, adminId, ctx)), ...(query.cursor ? { cursor: query.cursor } : {}) }, ctx);
      const names = await directory(page.items.flatMap(rowNameIds), ctx);
      return { items: page.items.map((row) => toRow(row, names)), nextCursor: page.nextCursor };
    }
  );

  app.get(
    "/support/counts",
    {
      schema: {
        tags: ["admin"],
        summary: "Contadores de la bandeja",
        description:
          "MOVO-322 AC3: `byStatus` respeta agente y búsqueda; `byOwner` (todos/míos/sin asignar) respeta estado y búsqueda; " +
          "`unreadTotal` es global (badge del menú).",
        ...supportSchemas.counts,
      },
    },
    async (request): Promise<SupportCounts> => {
      const adminId = requireAdmin(request);
      const ctx = ctxOf(request);
      const filters = await filtersOf(request.query as SupportListQuery, adminId, ctx);
      return app.supportClient.counts({ ...filters, viewerId: adminId }, ctx);
    }
  );

  app.get(
    "/support/conversations/:id",
    { schema: { tags: ["admin"], summary: "Una consulta de soporte", ...supportSchemas.conversation } },
    async (request): Promise<SupportConversation> => {
      requireAdmin(request);
      const ctx = ctxOf(request);
      return presentConversation(await app.supportClient.get(idOf(request), ctx), ctx);
    }
  );

  app.get(
    "/support/conversations/:id/messages",
    {
      schema: {
        tags: ["admin"],
        summary: "Historial de una consulta",
        description: "MOVO-322 AC4: todos los mensajes, incluidas las notas internas y los eventos, más recientes primero, de a 50.",
        ...supportSchemas.messages,
      },
    },
    async (request): Promise<SupportMessagesPage> => {
      requireAdmin(request);
      const ctx = ctxOf(request);
      const page = await app.supportClient.messages(idOf(request), (request.query as { cursor?: string }).cursor, ctx);
      const names = await directory(page.items.flatMap(messageNameIds), ctx);
      return { items: page.items.map((m) => toMessage(m, names)), nextCursor: page.nextCursor };
    }
  );

  app.post(
    "/support/conversations/:id/messages",
    {
      schema: {
        tags: ["admin"],
        summary: "Responder o dejar una nota interna",
        description:
          "MOVO-322 AC5: `internal: true` es una nota (nunca llega al usuario). Responder pasa la consulta a esperando al " +
          "usuario, la toma si estaba sin asignar y reabre una resuelta. Idempotente por `clientMessageId`. 403 " +
          "`ADMIN_CONFLICT_OF_INTEREST` sobre una consulta propia. Bitácora: `support.reply` / `support.note`.",
        ...supportSchemas.send,
      },
    },
    async (request): Promise<SupportMessage> => {
      const adminId = requireAdmin(request);
      const ctx = ctxOf(request);
      const id = idOf(request);
      const body = request.body as SupportSendBody;
      const result = await app.audit.runAdminAction(
        {
          adminId,
          action: body.internal ? "support.note" : "support.reply",
          target: target(id),
          context: { clientMessageId: body.clientMessageId, attachments: body.attachmentIds?.length ?? 0 },
          requestId: request.requestId,
          resolveContext: (sent) => ({ messageId: sent.message.id }),
        },
        async () => app.supportClient.send(id, { ...(await actorOf(adminId, ctx)), ...body }, ctx)
      );
      return toMessage(result.message, await directory(messageNameIds(result.message), ctx));
    }
  );

  app.patch(
    "/support/conversations/:id",
    {
      schema: {
        tags: ["admin"],
        summary: "Asignar, priorizar, cambiar tema, etiquetar o vincular un envío",
        description:
          "MOVO-322 AC6/AC7: `assignedTo: null` desasigna y `shipmentId: null` desvincula. Cada cambio (salvo etiquetas) deja " +
          "un evento. Vincular un envío del que el usuario no es parte: 422 `SUPPORT_SHIPMENT_NOT_PARTY`. Bitácora: " +
          "`support.assign|priority|topic|tags|link_shipment|unlink_shipment` (o `support.update` si cambian varios).",
        ...supportSchemas.patch,
      },
    },
    async (request): Promise<SupportConversation> => {
      const adminId = requireAdmin(request);
      const ctx = ctxOf(request);
      const id = idOf(request);
      const body = request.body as SupportPatchBody;
      const row = await app.audit.runAdminAction(
        {
          adminId,
          action: patchAction(body),
          target: target(id),
          context: { ...body },
          requestId: request.requestId,
          // Que el asignado sea un admin se verifica tras la regla de conflicto: si no, la fila es `failed`.
          precheck: async () => {
            if (typeof body.assignedTo !== "string" || body.assignedTo === adminId) return;
            const admins = await app.usersClient.listAdmins(ctx);
            if (!admins.some((admin) => admin.id === body.assignedTo)) {
              throw new ApiError(400, "VALIDATION_FAILED", "Solo se puede asignar a un administrador.");
            }
          },
        },
        async () => {
          const actor = await actorOf(adminId, ctx);
          const assignee =
            typeof body.assignedTo === "string" && body.assignedTo !== adminId
              ? (await directory([body.assignedTo], ctx)).nameOf(body.assignedTo)
              : undefined;
          return app.supportClient.patch(
            id,
            { actorId: actor.actorId, actorFullName: actor.actorFullName, ...body, ...(assignee ? { assigneeFullName: assignee } : {}) },
            ctx
          );
        }
      );
      return presentConversation(row, ctx);
    }
  );

  for (const [path, resolved] of [
    ["/support/conversations/:id/resolve", true],
    ["/support/conversations/:id/reopen", false],
  ] as const) {
    app.post(
      path,
      {
        schema: {
          tags: ["admin"],
          summary: resolved ? "Resolver una consulta" : "Reabrir una consulta",
          description: `MOVO-322 AC8: con su evento; el usuario ve el cambio de estado. Idempotente. Bitácora: \`support.${resolved ? "resolve" : "reopen"}\`.`,
          ...supportSchemas.action,
        },
      },
      async (request): Promise<SupportConversation> => {
        const adminId = requireAdmin(request);
        const ctx = ctxOf(request);
        const id = idOf(request);
        const row = await app.audit.runAdminAction(
          { adminId, action: resolved ? "support.resolve" : "support.reopen", target: target(id), requestId: request.requestId },
          async () => {
            const { actorId, actorFullName } = await actorOf(adminId, ctx);
            return resolved
              ? app.supportClient.resolve(id, { actorId, actorFullName }, ctx)
              : app.supportClient.reopen(id, { actorId, actorFullName }, ctx);
          }
        );
        return presentConversation(row, ctx);
      }
    );
  }

  app.post(
    "/support/conversations/:id/read",
    {
      schema: {
        tags: ["admin"],
        summary: "Marcar una consulta como leída",
        description: "Los no leídos son compartidos por conversación: abrirla la marca leída para todos los agentes. Es una lectura: sin bitácora.",
        ...supportSchemas.read,
      },
    },
    async (request, reply) => {
      requireAdmin(request);
      await app.supportClient.read(idOf(request), ctxOf(request));
      reply.code(204);
    }
  );

  app.get(
    "/support/conversations/:id/context",
    {
      schema: {
        tags: ["admin"],
        summary: "Contexto del usuario de la consulta",
        description:
          "MOVO-322 AC10: perfil, insignias, envíos recientes y demás consultas. Falla abierto en las insignias: si el KYC " +
          "de `svc-users` no responde, `badges` es `null` y el resto se devuelve igual.",
        ...supportSchemas.context,
      },
    },
    async (request): Promise<SupportUserContext> => {
      requireAdmin(request);
      const ctx = ctxOf(request);
      const id = idOf(request);
      const row = await app.supportClient.get(id, ctx);
      const userId = row.userId;
      const [profile, kyc, shipments, trips, ratings, others] = await Promise.all([
        app.usersClient.getUserProfile(userId, ctx),
        app.usersClient.getUserKyc(userId, ctx).catch((error: unknown) => {
          app.log.warn({ err: error, event: "support_context_badges_unavailable", requestId: ctx.requestId }, "Insignias no disponibles");
          return null;
        }),
        app.shipmentsClient.listUserShipments(userId, { page: 1, pageSize: RECENT_SHIPMENTS }, ctx),
        app.shipmentsClient.listUserTrips(userId, { page: 1, pageSize: 1 }, ctx),
        app.shipmentsClient.listUserRatings(userId, { page: 1, pageSize: 1 }, ctx),
        app.supportClient.userConversations(id, ctx),
      ]);
      if (!profile) throw new ApiError(404, "USER_NOT_FOUND", "El usuario de la consulta no existe.");
      return {
        profile: {
          id: profile.id,
          fullName: profile.fullName,
          roles: profile.roles.map((grant) => grant.role),
          memberSince: profile.createdAt,
          email: profile.email,
          phone: profile.phone,
          ratingAverage: ratings.average,
          ratingCount: ratings.count,
          shipmentCount: shipments.total,
          tripCount: trips.total,
        },
        badges: kyc ? verificationBadges(profile, kyc, new Date()) : null,
        recentShipments: shipments.items.map((shipment) => ({
          id: shipment.id,
          code: supportShipmentCode(shipment.id),
          status: shipment.status,
          route: `${shortAddress(shipment.pickupAddress)} → ${shortAddress(shipment.deliveryAddress)}`,
          ...(SHIPMENT_STATUS_VIEW[shipment.status]
            ? { tone: SHIPMENT_STATUS_VIEW[shipment.status].tone, statusLabel: SHIPMENT_STATUS_VIEW[shipment.status].label }
            : { tone: "neutral" as const, statusLabel: shipment.status }),
          createdAt: shipment.createdAt,
        })),
        otherConversations: others.items,
      };
    }
  );

  app.get(
    "/support/agents",
    {
      schema: {
        tags: ["admin"],
        summary: "Agentes para asignar, con su carga",
        description: "Los admins con la cantidad de consultas no resueltas asignadas (`activeCount`). Sin presencia.",
        ...supportSchemas.agents,
      },
    },
    async (request): Promise<SupportAgent[]> => {
      requireAdmin(request);
      const ctx = ctxOf(request);
      const [admins, loads] = await Promise.all([app.usersClient.listAdmins(ctx), app.supportClient.agentLoads(ctx)]);
      const loadBy = new Map(loads.map((load) => [load.agentId, load.activeCount]));
      return admins.map((admin) => ({ id: admin.id, fullName: admin.fullName, activeCount: loadBy.get(admin.id) ?? 0 }));
    }
  );

  app.get(
    "/support/quick-replies",
    {
      schema: {
        tags: ["admin"],
        summary: "Respuestas rápidas",
        description: "AC11: la lista fija de `@movo/shared` (`{nombre}` y `{agente}` son variables). El panel también la usa directo.",
        ...supportSchemas.quickReplies,
      },
    },
    async (request) => {
      requireAdmin(request);
      return SUPPORT_QUICK_REPLIES;
    }
  );

  app.get(
    "/support/events",
    {
      schema: {
        tags: ["admin"],
        summary: "Eventos de la bandeja (respaldo del WebSocket)",
        description:
          "MOVO-322 AC9: lo que cambió desde `since` (cursor opaco). Sin `since` devuelve `{ events: [], cursor }` y arranca " +
          "desde ahora. `reset: true` si ya no se guardan los eventos desde ese cursor: el panel vuelve a pedir todo. Los " +
          "agentes reciben todo, notas incluidas.",
        ...supportSchemas.events,
      },
    },
    async (request): Promise<SupportEventsPage> => {
      const adminId = requireAdmin(request);
      const ctx = ctxOf(request);
      const { entries, cursor, reset } = await readStream(app.redis, (request.query as { since?: string }).since);
      if (entries.length === 0) return { events: [], cursor, reset };
      const hasCounts = entries.some((entry) => entry.event.type === "counts_changed");
      const [names, counts] = await Promise.all([directory(entryNameIds(entries), ctx), hasCounts ? countsFor(adminId, ctx) : null]);
      return { events: toPanelEvents(entries, names, counts), cursor, reset };
    }
  );

  app.post(
    "/support/attachments",
    {
      schema: {
        tags: ["admin"],
        summary: "Pedir una URL para subir una imagen a una consulta",
        description:
          "MOVO-321 desde el panel: JPEG, PNG o WebP de hasta 5 MB (si no, 422 `SUPPORT_ATTACHMENT_INVALID`). El navegador hace " +
          "`PUT uploadUrl` con el mismo `Content-Type`. Bitácora: `support.attachment_request`.",
        ...supportSchemas.attachments,
      },
    },
    async (request, reply): Promise<SupportAttachmentCreateResult> => {
      const adminId = requireAdmin(request);
      const ctx = ctxOf(request);
      const body = request.body as SupportAttachmentCreateBody & { width?: number; height?: number };
      const result = await app.audit.runAdminAction(
        {
          adminId,
          action: "support.attachment_request",
          target: target(body.conversationId),
          context: { contentType: body.contentType, sizeBytes: body.sizeBytes },
          requestId: request.requestId,
          resolveContext: (created) => ({ attachmentId: created.attachmentId }),
        },
        async () => {
          const { actorId, actorFullName } = await actorOf(adminId, ctx);
          const { conversationId, ...rest } = body;
          return app.supportClient.createAttachment(conversationId, { actorId, actorFullName, ...rest }, ctx);
        }
      );
      reply.code(201);
      return result;
    }
  );
}
