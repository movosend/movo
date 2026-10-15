import { UserReportParties } from "@movo/shared";
import { createInternalClient, InternalClient, isRecord, isString, RequestContext } from "./internal-client";

export interface UsersClient extends InternalClient {
  /** `GET /internal/user-reports/:id/parties`. `null` si el reporte no existe. */
  getUserReportParties(reportId: string, ctx: RequestContext): Promise<UserReportParties | null>;
}

const isUserReportParties = (body: unknown): body is UserReportParties =>
  isRecord(body) && isString(body.reportId) && isString(body.reporterId) && isString(body.reportedId);

export function createUsersClient(config: { USERS_SERVICE_URL: string }): UsersClient {
  const client = createInternalClient({
    baseUrl: config.USERS_SERVICE_URL,
    serviceLabel: "usuarios",
    unavailableCode: "USERS_SERVICE_UNAVAILABLE",
  });

  return {
    ...client,
    getUserReportParties(reportId, ctx) {
      return client.request(`/internal/user-reports/${encodeURIComponent(reportId)}/parties`, ctx, {
        isValid: isUserReportParties,
        notFoundCodes: ["REPORT_NOT_FOUND"],
      });
    },
  };
}
