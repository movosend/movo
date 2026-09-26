import type {
  BlockedUserSummary,
  ReportPhotoUploadUrl,
  ReportReason,
  UserReportSummary,
} from "@movo/shared/dist/types/user";
import { httpClient } from "./http-client";

export interface ReportUserInput {
  reason: ReportReason;
  details?: string;
  /** Keys de fotos ya subidas con `presignReportPhoto` (MOVO-256). */
  photoKeys?: string[];
}

/** Texto, fotos o ambos (MOVO-256). */
export interface AddReportEntryInput {
  details?: string;
  photoKeys?: string[];
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
  addReportEntry(userId: string, input: AddReportEntryInput): Promise<UserReportSummary> {
    return httpClient.post<UserReportSummary>(`/users/${userId}/report/entries`, input);
  },
  /** `POST /users/:id/report/photos/presign` (MOVO-256) — presigned PUT de una foto de
   * evidencia. El PUT a S3 va fuera de `httpClient` (ver `s3-upload.ts`). */
  presignReportPhoto(userId: string, contentLength: number): Promise<ReportPhotoUploadUrl> {
    return httpClient.post<ReportPhotoUploadUrl>(`/users/${userId}/report/photos/presign`, {
      contentType: "image/jpeg",
      contentLength,
    });
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
