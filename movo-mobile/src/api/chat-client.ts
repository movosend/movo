import type {
  ChatListResponse,
  ChatMessage,
  ChatMessagesPage,
  ChatParticipantsResponse,
} from "@movo/shared/dist/types/chat";
import { httpClient } from "./http-client";

/**
 * MOVO-284 (ADR-023): chat del envío. Se envía por HTTP y se recibe por WebSocket
 * (`use-chat-channel.ts`); el historial, los integrantes y la lista salen de acá.
 */
export const chatClient = {
  /** La lista "Chats": uno por envío con transportista, el más reciente primero. */
  listChats(): Promise<ChatListResponse> {
    return httpClient.get<ChatListResponse>("/shipments/chats");
  },

  /** Historial del más reciente al más antiguo, paginado por cursor opaco. */
  listMessages(shipmentId: string, params: { cursor?: string; limit?: number } = {}): Promise<ChatMessagesPage> {
    return httpClient.get<ChatMessagesPage>(`/shipments/${shipmentId}/chat/messages`, {
      cursor: params.cursor,
      limit: params.limit,
    });
  },

  /** Idempotente por `clientMessageId`: reenviar el mismo mensaje no lo duplica. */
  sendMessage(shipmentId: string, body: string, clientMessageId: string): Promise<ChatMessage> {
    return httpClient.post<ChatMessage>(`/shipments/${shipmentId}/chat/messages`, { body, clientMessageId });
  },

  getParticipants(shipmentId: string): Promise<ChatParticipantsResponse> {
    return httpClient.get<ChatParticipantsResponse>(`/shipments/${shipmentId}/chat/participants`);
  },

  /** Leí todo hasta ahora: baja mi contador y les avisa a los demás. */
  markRead(shipmentId: string): Promise<{ readAt: string }> {
    return httpClient.post<{ readAt: string }>(`/shipments/${shipmentId}/chat/read`, {});
  },

  /** "Reportar conversación": una por persona y envío, idempotente. */
  reportConversation(shipmentId: string): Promise<{ reported: boolean }> {
    return httpClient.post<{ reported: boolean }>(`/shipments/${shipmentId}/chat/report`, {});
  },
};
