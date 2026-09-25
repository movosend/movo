import type { BlockedUserSummary, ReportReason } from "@movo/shared/dist/types/user";
import { httpClient } from "./http-client";

export interface ReportUserInput {
  reason: ReportReason;
  details?: string;
}

/**
 * Reportar/bloquear usuarios (MOVO-175, ADR-026). Mismo patrón cliente que
 * `ratings-client.ts`.
 */
export const moderationClient = {
  /** `POST /users/:id/report` */
  reportUser(userId: string, input: ReportUserInput): Promise<void> {
    return httpClient.post<void>(`/users/${userId}/report`, input);
  },
  /** `POST /users/:id/block` */
  blockUser(userId: string): Promise<void> {
    return httpClient.post<void>(`/users/${userId}/block`);
  },
  /** `DELETE /users/:id/block` */
  unblockUser(userId: string): Promise<void> {
    return httpClient.delete<void>(`/users/${userId}/block`);
  },
  /** `GET /users/me/blocked` — solo los bloqueos propios, del más reciente al más viejo. */
  listBlocked(): Promise<BlockedUserSummary[]> {
    return httpClient.get<BlockedUserSummary[]>("/users/me/blocked");
  },
};
