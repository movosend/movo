import type {
  SupportCreateBody,
  SupportCreateResult,
  SupportListResponse,
  SupportSendUserBody,
  SupportShipmentOptionsPage,
  SupportThreadMessage,
  SupportThreadPage,
  SupportUserAttachmentCreateBody,
} from "@movo/shared/dist/types/support";
import type { SupportAttachmentCreateResult } from "@movo/shared/dist/types/admin-support";
import { uploadBlobToPresignedUrl } from "../lib/s3-upload";
import { httpClient } from "./http-client";
import { supportMock } from "./support-mock";

/**
 * Se lee directo de `process.env.EXPO_PUBLIC_*` (Metro lo reemplaza en build time). Con `1` toda la capa de soporte
 * responde desde memoria (`support-mock.ts`) y no abre el WebSocket: sirve para desarrollar antes de que exista el
 * backend de MOVO-320/321.
 */
export function isSupportMock(): boolean {
  return process.env.EXPO_PUBLIC_SUPPORT_MOCK === "1";
}

export interface UploadedSupportAttachment {
  attachmentId: string;
}

/**
 * MOVO-324: soporte al usuario (MOVO-319/320/321). Se envía por HTTP y se recibe por WebSocket
 * (`use-support-channel.ts`); la lista, el historial y los adjuntos salen de acá. Contrato en
 * `docs/support/README.md` y `@movo/shared` (`types/support.ts`).
 */
const realClient = {
  /** `GET /support/conversations`: solo las del usuario, la más reciente primero. */
  list(): Promise<SupportListResponse> {
    return httpClient.get<SupportListResponse>("/support/conversations");
  },

  /** `POST /support/conversations`: crea la consulta con su primer mensaje. Idempotente por `clientMessageId`. */
  create(body: SupportCreateBody): Promise<SupportCreateResult> {
    return httpClient.post<SupportCreateResult>("/support/conversations", body);
  },

  /** Historial del más reciente al más antiguo, paginado por cursor opaco; trae la consulta para el encabezado. */
  listMessages(conversationId: string, params: { cursor?: string; limit?: number } = {}): Promise<SupportThreadPage> {
    return httpClient.get<SupportThreadPage>(`/support/conversations/${conversationId}/messages`, {
      cursor: params.cursor,
      limit: params.limit,
    });
  },

  /** Idempotente por `clientMessageId`. Sobre una consulta resuelta, la reabre. */
  sendMessage(conversationId: string, body: SupportSendUserBody): Promise<SupportThreadMessage> {
    return httpClient.post<SupportThreadMessage>(`/support/conversations/${conversationId}/messages`, body);
  },

  /** Leí todo hasta ahora: baja el contador de esa consulta. */
  markRead(conversationId: string): Promise<{ readAt: string }> {
    return httpClient.post<{ readAt: string }>(`/support/conversations/${conversationId}/read`, {});
  },

  /** Envíos de los que el usuario es parte (cualquier rol), para vincular a una consulta nueva. */
  listShipments(params: { cursor?: string; limit?: number } = {}): Promise<SupportShipmentOptionsPage> {
    return httpClient.get<SupportShipmentOptionsPage>("/support/shipments", { cursor: params.cursor, limit: params.limit });
  },

  /** `POST /support/attachments` (MOVO-321): presigned PUT de una imagen. El PUT va fuera de `httpClient`. */
  presignAttachment(body: SupportUserAttachmentCreateBody): Promise<SupportAttachmentCreateResult> {
    return httpClient.post<SupportAttachmentCreateResult>("/support/attachments", body);
  },

  /** Pide la URL y sube el binario; devuelve el id a mandar en `attachmentIds`. */
  async uploadAttachment(blob: Blob, contentType: "image/jpeg", conversationId?: string): Promise<UploadedSupportAttachment> {
    const presigned = await this.presignAttachment({ contentType, sizeBytes: blob.size, conversationId });
    await uploadBlobToPresignedUrl(presigned.uploadUrl, blob, contentType);
    return { attachmentId: presigned.attachmentId };
  },
};

export type SupportClient = typeof realClient;

/** El mock y el cliente real comparten forma; se elige en cada llamada para poder cambiarlo en tests. */
export const supportClient: SupportClient = {
  list: () => (isSupportMock() ? supportMock.list() : realClient.list()),
  create: (body) => (isSupportMock() ? supportMock.create(body) : realClient.create(body)),
  listMessages: (id, params) => (isSupportMock() ? supportMock.listMessages(id, params) : realClient.listMessages(id, params)),
  sendMessage: (id, body) => (isSupportMock() ? supportMock.sendMessage(id, body) : realClient.sendMessage(id, body)),
  markRead: (id) => (isSupportMock() ? supportMock.markRead(id) : realClient.markRead(id)),
  listShipments: (params) => (isSupportMock() ? supportMock.listShipments(params) : realClient.listShipments(params)),
  presignAttachment: (body) => (isSupportMock() ? supportMock.presignAttachment(body) : realClient.presignAttachment(body)),
  uploadAttachment: (blob, contentType, conversationId) =>
    isSupportMock() ? supportMock.uploadAttachment() : realClient.uploadAttachment(blob, contentType, conversationId),
};
