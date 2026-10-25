import {
  ApiError,
  SupportAttachmentCreateResult,
  SupportInternalActor,
  SupportInternalAgentLoad,
  SupportInternalAttachmentBody,
  SupportInternalCounts,
  SupportInternalCountsQuery,
  SupportInternalListPage,
  SupportInternalListQuery,
  SupportInternalMessage,
  SupportInternalMessagesPage,
  SupportInternalParties,
  SupportInternalPatchBody,
  SupportInternalRow,
  SupportInternalSendBody,
  SupportInternalSendResult,
  SupportInternalUserConversations,
} from "@movo/shared";
import {
  createInternalClient,
  InternalClient,
  InternalRequestOptions,
  isNullableString,
  isRecord,
  isString,
  RequestContext,
} from "./internal-client";

const NOT_FOUND = "SUPPORT_CONVERSATION_NOT_FOUND";

/**
 * MOVO-322: cliente de `/internal/admin/support/*` de `svc-shipments` (dueño del modelo de soporte). Aparte de
 * `shipments-client.ts` porque un fallo responde `SUPPORT_SERVICE_UNAVAILABLE` (el código del contrato de la bandeja,
 * MOVO-323) en vez de `SHIPMENTS_SERVICE_UNAVAILABLE`. Un 404 de una consulta inexistente se relanza tal cual
 * (`SUPPORT_CONVERSATION_NOT_FOUND`), salvo en `getParties`, que devuelve `null` para la regla de conflicto.
 */
export interface SupportClient extends InternalClient {
  list(query: SupportInternalListQuery, ctx: RequestContext): Promise<SupportInternalListPage>;
  counts(query: SupportInternalCountsQuery, ctx: RequestContext): Promise<SupportInternalCounts>;
  get(id: string, ctx: RequestContext): Promise<SupportInternalRow>;
  messages(id: string, cursor: string | undefined, ctx: RequestContext): Promise<SupportInternalMessagesPage>;
  send(id: string, body: SupportInternalSendBody, ctx: RequestContext): Promise<SupportInternalSendResult>;
  patch(id: string, body: SupportInternalPatchBody, ctx: RequestContext): Promise<SupportInternalRow>;
  resolve(id: string, actor: SupportInternalActor, ctx: RequestContext): Promise<SupportInternalRow>;
  reopen(id: string, actor: SupportInternalActor, ctx: RequestContext): Promise<SupportInternalRow>;
  read(id: string, ctx: RequestContext): Promise<void>;
  getParties(id: string, ctx: RequestContext): Promise<SupportInternalParties | null>;
  userConversations(id: string, ctx: RequestContext): Promise<SupportInternalUserConversations>;
  agentLoads(ctx: RequestContext): Promise<SupportInternalAgentLoad[]>;
  createAttachment(id: string, body: SupportInternalAttachmentBody, ctx: RequestContext): Promise<SupportAttachmentCreateResult>;
}

const isNumber = (value: unknown): value is number => typeof value === "number";

export const isSupportRow = (value: unknown): value is SupportInternalRow =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.code) &&
  isString(value.userId) &&
  isString(value.status) &&
  isString(value.priority) &&
  isNullableString(value.assignedTo) &&
  isNumber(value.unread) &&
  isNumber(value.waitMinutes) &&
  Array.isArray(value.tags);

export const isSupportMessage = (value: unknown): value is SupportInternalMessage =>
  isRecord(value) && isString(value.id) && isString(value.kind) && isString(value.body) && Array.isArray(value.attachments);

const isListPage = (body: unknown): body is SupportInternalListPage =>
  isRecord(body) && Array.isArray(body.items) && body.items.every(isSupportRow) && isNullableString(body.nextCursor);

const isMessagesPage = (body: unknown): body is SupportInternalMessagesPage =>
  isRecord(body) && Array.isArray(body.items) && body.items.every(isSupportMessage) && isNullableString(body.nextCursor);

const isCounts = (body: unknown): body is SupportInternalCounts =>
  isRecord(body) && isRecord(body.byStatus) && isRecord(body.byOwner) && isNumber(body.unreadTotal);

const isSendResult = (body: unknown): body is SupportInternalSendResult =>
  isRecord(body) && isSupportMessage(body.message) && isSupportRow(body.conversation);

const isParties = (body: unknown): body is SupportInternalParties => isRecord(body) && isString(body.userId);

const isUserConversations = (body: unknown): body is SupportInternalUserConversations =>
  isRecord(body) && Array.isArray(body.items) && body.items.every((i) => isRecord(i) && isString(i.conversationId) && isString(i.code));

const isAgentLoads = (body: unknown): body is SupportInternalAgentLoad[] =>
  Array.isArray(body) && body.every((i) => isRecord(i) && isString(i.agentId) && isNumber(i.activeCount));

const isAttachmentResult = (body: unknown): body is SupportAttachmentCreateResult =>
  isRecord(body) && isString(body.attachmentId) && isString(body.uploadUrl) && isString(body.expiresAt);

const isNoContent = (body: unknown): body is undefined => body === undefined;

function listParams(query: Omit<SupportInternalListQuery, "cursor"> & { cursor?: string; viewerId?: string }): string {
  const params = new URLSearchParams({ status: query.status });
  if (query.assignee) params.set("assignee", query.assignee);
  if (query.q) params.set("q", query.q);
  if (query.userIds && query.userIds.length > 0) params.set("userIds", query.userIds.join(","));
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.viewerId) params.set("viewerId", query.viewerId);
  return params.toString();
}

export function createSupportClient(config: { SHIPMENTS_SERVICE_URL: string }): SupportClient {
  const client = createInternalClient({
    baseUrl: config.SHIPMENTS_SERVICE_URL,
    serviceLabel: "soporte",
    unavailableCode: "SUPPORT_SERVICE_UNAVAILABLE",
  });
  const path = (id: string, rest = "") => `/internal/admin/support/conversations/${encodeURIComponent(id)}${rest}`;

  /**
   * Una consulta inexistente (404 `SUPPORT_CONVERSATION_NOT_FOUND`) llega al panel como 404 con ese código; cualquier
   * otro 404 es una ruta que svc-shipments todavía no tiene y el cliente base lo trata como caída (502).
   */
  async function required<T>(
    url: string,
    ctx: RequestContext,
    opts: Omit<InternalRequestOptions<T>, "notFoundCodes">
  ): Promise<T> {
    const result = await client.request<T>(url, ctx, { ...opts, notFoundCodes: [NOT_FOUND] });
    if (result === null) throw new ApiError(404, NOT_FOUND, "La consulta no existe.");
    return result;
  }

  return {
    ...client,
    list: (query, ctx) => required(`/internal/admin/support/conversations?${listParams(query)}`, ctx, { isValid: isListPage }),
    counts: (query, ctx) => required(`/internal/admin/support/counts?${listParams(query)}`, ctx, { isValid: isCounts }),
    get: (id, ctx) => required(path(id), ctx, { isValid: isSupportRow }),
    messages: (id, cursor, ctx) =>
      required(path(id, `/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`), ctx, { isValid: isMessagesPage }),
    send: (id, body, ctx) => required(path(id, "/messages"), ctx, { method: "POST", body, isValid: isSendResult }),
    patch: (id, body, ctx) => required(path(id), ctx, { method: "PATCH", body, isValid: isSupportRow }),
    resolve: (id, actor, ctx) => required(path(id, "/resolve"), ctx, { method: "POST", body: actor, isValid: isSupportRow }),
    reopen: (id, actor, ctx) => required(path(id, "/reopen"), ctx, { method: "POST", body: actor, isValid: isSupportRow }),
    async read(id, ctx) {
      await required(path(id, "/read"), ctx, { method: "POST", isValid: isNoContent });
    },
    getParties: (id, ctx) => client.request(path(id, "/parties"), ctx, { isValid: isParties, notFoundCodes: [NOT_FOUND] }),
    userConversations: (id, ctx) => required(path(id, "/user-conversations"), ctx, { isValid: isUserConversations }),
    agentLoads: (ctx) => required("/internal/admin/support/agents/load", ctx, { isValid: isAgentLoads }),
    createAttachment: (id, body, ctx) =>
      required(path(id, "/attachments"), ctx, { method: "POST", body, isValid: isAttachmentResult }),
  };
}
