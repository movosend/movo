import { AdminSummary, UserReportParties } from "@movo/shared";
import { ApiError } from "@movo/shared";
import { createInternalClient, InternalClient, isRecord, isString, RequestContext } from "./internal-client";

export interface UsersClient extends InternalClient {
  /** `GET /internal/admins`: los usuarios con el rol `admin`. */
  listAdmins(ctx: RequestContext): Promise<AdminSummary[]>;
  /** `POST /internal/admins`. Idempotente: si ya era admin, devuelve el mismo resumen. 404 `USER_NOT_FOUND` si el email no tiene cuenta. */
  grantAdmin(email: string, actorId: string, ctx: RequestContext): Promise<AdminSummary>;
  /** `DELETE /internal/admins/:userId`. 404 `ADMIN_NOT_FOUND` si no era admin; 409 `ADMIN_LAST_ADMIN` si era el último. */
  revokeAdmin(userId: string, actorId: string, ctx: RequestContext): Promise<void>;
  /** `GET /internal/user-reports/:id/parties`. `null` si el reporte no existe. */
  getUserReportParties(reportId: string, ctx: RequestContext): Promise<UserReportParties | null>;
}

const isUserReportParties = (body: unknown): body is UserReportParties =>
  isRecord(body) && isString(body.reportId) && isString(body.reporterId) && isString(body.reportedId);

const isAdminSummary = (body: unknown): body is AdminSummary =>
  isRecord(body) &&
  isString(body.id) &&
  isString(body.fullName) &&
  isString(body.email) &&
  isString(body.status) &&
  isString(body.grantedAt);

const isAdminSummaryList = (body: unknown): body is AdminSummary[] => Array.isArray(body) && body.every(isAdminSummary);

const isNoContent = (body: unknown): body is undefined => body === undefined;

export function createUsersClient(config: { USERS_SERVICE_URL: string }): UsersClient {
  const client = createInternalClient({
    baseUrl: config.USERS_SERVICE_URL,
    serviceLabel: "usuarios",
    unavailableCode: "USERS_SERVICE_UNAVAILABLE",
  });

  /** Un 404 de negocio que el panel debe ver con su código: se convierte en `ApiError` en vez de `null`. */
  const orNotFound = <T>(result: T | null, code: "USER_NOT_FOUND" | "ADMIN_NOT_FOUND", message: string): T => {
    if (result === null) throw new ApiError(404, code, message);
    return result;
  };

  return {
    ...client,
    async listAdmins(ctx) {
      const admins = await client.request("/internal/admins", ctx, { isValid: isAdminSummaryList, notFoundCodes: [] });
      return admins ?? [];
    },
    async grantAdmin(email, actorId, ctx) {
      const admin = await client.request("/internal/admins", ctx, {
        method: "POST",
        body: { email },
        actorId,
        isValid: isAdminSummary,
        notFoundCodes: ["USER_NOT_FOUND"],
      });
      return orNotFound(admin, "USER_NOT_FOUND", "No existe un usuario con ese email.");
    },
    async revokeAdmin(userId, actorId, ctx) {
      const result = await client.request(`/internal/admins/${encodeURIComponent(userId)}`, ctx, {
        method: "DELETE",
        actorId,
        isValid: isNoContent,
        notFoundCodes: ["ADMIN_NOT_FOUND"],
      });
      // `undefined` es el éxito (204); `null`, el 404 de negocio.
      if (result === null) throw new ApiError(404, "ADMIN_NOT_FOUND", "El usuario no es admin.");
    },
    getUserReportParties(reportId, ctx) {
      return client.request(`/internal/user-reports/${encodeURIComponent(reportId)}/parties`, ctx, {
        isValid: isUserReportParties,
        notFoundCodes: ["REPORT_NOT_FOUND"],
      });
    },
  };
}
