import type { BlockedUserSummary, ReportReason, UserReportSummary } from "@movo/shared/dist/types/user";
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
  /** `POST /users/:id/report` — 409 `REPORT_ALREADY_PENDING` si ya hay uno en revisión. */
  reportUser(userId: string, input: ReportUserInput): Promise<UserReportSummary> {
    return httpClient.post<UserReportSummary>(`/users/${userId}/report`, input);
  },
  /** `GET /users/:id/report` — el reporte propio en revisión sobre ese usuario, o `null`. */
  getPendingReport(userId: string): Promise<UserReportSummary | null> {
    return httpClient.get<UserReportSummary | null>(`/users/${userId}/report`);
  },
  /** `POST /users/:id/report/entries` — suma información sin editar lo ya enviado. */
  addReportEntry(userId: string, details: string): Promise<UserReportSummary> {
    return httpClient.post<UserReportSummary>(`/users/${userId}/report/entries`, { details });
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
