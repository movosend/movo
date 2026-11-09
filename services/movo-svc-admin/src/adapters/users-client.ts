import {
  AccountSanction,
  AdminApplySanctionBody,
  AdminCandidate,
  AdminContactUpdateBody,
  AdminContactUpdateResult,
  AdminKycCard,
  AdminKycDecision,
  AdminKycDecisionResponse,
  AdminKycEvidence,
  AdminKycReviewDetail,
  AdminKycReviewPage,
  AdminKycVerificationType,
  AdminSessionsRevokeResult,
  AdminShipmentPartyCard,
  AdminSummary,
  AdminUserDevices,
  AdminUserKyc,
  AdminUserListItem,
  AdminUserModeration,
  AdminUserNameRef,
  AdminUserPage,
  AdminUserProfile,
  AdminUserVehicle,
  StepUpChallenge,
  StepUpRequest,
  StepUpToken,
  StepUpVerifyRequest,
  UserReportParties,
  OverviewInboxSource,
  OverviewKycExtra,
  OverviewUserReportsExtra,
} from "@movo/shared";
import { ApiError } from "@movo/shared";
import {
  createInternalClient,
  InternalClient,
  isNullableString,
  isOverviewInboxSource,
  isRecord,
  isString,
  isStringArray,
  RequestContext,
} from "./internal-client";

export interface UsersClient extends InternalClient {
  /** `GET /internal/admins`: los usuarios con el rol `admin`. */
  listAdmins(ctx: RequestContext): Promise<AdminSummary[]>;
  /** `GET /internal/admins/candidates?q=`: usuarios por nombre o email para el autocompletado del alta. */
  searchAdminCandidates(query: string, ctx: RequestContext): Promise<AdminCandidate[]>;
  /** `POST /internal/admins`. Idempotente: si ya era admin, devuelve el mismo resumen. 404 `USER_NOT_FOUND` si el email no tiene cuenta. */
  grantAdmin(email: string, actorId: string, ctx: RequestContext): Promise<AdminSummary>;
  /** `DELETE /internal/admins/:userId`. 404 `ADMIN_NOT_FOUND` si no era admin; 409 `ADMIN_LAST_ADMIN` si era el último. */
  revokeAdmin(userId: string, actorId: string, ctx: RequestContext): Promise<void>;
  /** `GET /internal/user-reports/:id/parties`. `null` si el reporte no existe. */
  getUserReportParties(reportId: string, ctx: RequestContext): Promise<UserReportParties | null>;

  // MOVO-294: búsqueda, ficha y acciones de soporte. Todas responden 404 `USER_NOT_FOUND` como
  // `ApiError` (no `null`): el panel muestra ese código tal cual.
  searchUsers(query: { q: string; page: number; pageSize: number }, ctx: RequestContext): Promise<AdminUserPage>;
  getUserProfile(userId: string, ctx: RequestContext): Promise<AdminUserProfile>;
  getUserKyc(userId: string, ctx: RequestContext): Promise<Omit<AdminUserKyc, "mercadoPago">>;
  getUserVehicle(userId: string, ctx: RequestContext): Promise<AdminUserVehicle>;
  getUserModeration(userId: string, ctx: RequestContext): Promise<AdminUserModeration>;
  getUserDevices(userId: string, ctx: RequestContext): Promise<AdminUserDevices>;
  /** Nombres de los ids que existen; los demás no vuelven. */
  /** Con los roles de la cuenta (MOVO-322: la bandeja de soporte distingue transportistas). */
  getUserNames(userIds: string[], ctx: RequestContext): Promise<AdminUserNameRef[]>;
  // MOVO-342: bandejas de la home del panel y el reportado de un reporte para la bitácora.
  getOverviewKyc(ctx: RequestContext): Promise<OverviewInboxSource<OverviewKycExtra>>;
  getOverviewUserReports(ctx: RequestContext): Promise<OverviewInboxSource<OverviewUserReportsExtra>>;
  getOverviewSanctionsEndingToday(ctx: RequestContext): Promise<OverviewInboxSource>;
  getReportedUsers(reportIds: string[], ctx: RequestContext): Promise<Array<{ id: string; reportedId: string }>>;
  revokeUserSessions(userId: string, actorId: string, ctx: RequestContext): Promise<AdminSessionsRevokeResult>;
  updateUserContact(
    userId: string,
    body: Omit<AdminContactUpdateBody, "reason">,
    actorId: string,
    ctx: RequestContext,
  ): Promise<AdminContactUpdateOutcome>;
  /**
   * `GET /internal/users/party-cards?ids=` (MOVO-325): verificación y reputación de las partes de un
   * envío. Una cuenta inexistente queda afuera de la lista.
   */
  getPartyCards(userIds: string[], ctx: RequestContext): Promise<PartyCard[]>;

  // MOVO-299 sobre los internos de MOVO-296 (`/internal/users/:id/sanctions`). 404 `USER_NOT_FOUND` como `ApiError`.
  /** Historial, de la más reciente a la más vieja. */
  listSanctions(userId: string, ctx: RequestContext): Promise<AccountSanction[]>;
  /** 409 `ACCOUNT_ALREADY_DISABLED` si ya estaba inhabilitada. Reemplaza o escala la sanción vigente. */
  applySanction(userId: string, body: AdminApplySanctionBody, actorId: string, ctx: RequestContext): Promise<AccountSanction>;
  /**
   * 409 `SANCTION_ALREADY_CLOSED`. Un 404 se informa como `SANCTION_NOT_FOUND`: quien llama ya
   * comprobó que el usuario existe al leer el historial.
   */
  liftSanction(userId: string, sanctionId: string, reason: string, actorId: string, ctx: RequestContext): Promise<AccountSanction>;
  // Cola de revisión manual de KYC (`/internal/admin/kyc/reviews`). Solo lista los intentos en `manual_review`.
  listKycReviews(
    query: { type?: AdminKycVerificationType | undefined; q: string; page: number; pageSize: number },
    ctx: RequestContext,
  ): Promise<AdminKycReviewPage>;
  /** 404 `KYC_SESSION_NOT_FOUND`. También devuelve un intento ya resuelto, con `decidable: false`. */
  getKycReview(sessionId: string, ctx: RequestContext): Promise<AdminKycReviewDetail>;
  /**
   * Lo que tiene Didit de la sesión (datos del documento, puntuaciones, IP, alertas e imágenes como links temporales). Didit
   * lo entrega cada vez y Movo no lo guarda. 404 `KYC_SESSION_NOT_FOUND`; 422 `KYC_EVIDENCE_NOT_FOUND` (Didit no conoce la sesión); 502 `KYC_PROVIDER_ERROR`
   * si Didit no responde.
   */
  getKycEvidence(sessionId: string, ctx: RequestContext): Promise<AdminKycEvidence>;
  /**
   * Aprueba o rechaza un intento en revisión: `svc-users` se lo pide a Didit y aplica el resultado. 404
   * `KYC_SESSION_NOT_FOUND`; 409 `KYC_REVIEW_STATUS_CHANGED` / `KYC_REVIEW_SUPERSEDED`; 502 `KYC_PROVIDER_ERROR`
   * (Didit rechazó el pedido: no se aplicó nada, a diferencia de `USERS_SERVICE_UNAVAILABLE`).
   */
  decideKycReview(
    sessionId: string,
    body: { decision: AdminKycDecision; reason: string },
    actorId: string,
    ctx: RequestContext,
  ): Promise<AdminKycDecisionResponse>;
  // MOVO-332 (DD-055): segundo factor por acción del cambio de estado de un envío.
  /** `POST /internal/admin/step-up/request`: manda el código al email del admin, atado a (envío, destino). */
  requestStepUp(adminId: string, body: StepUpRequest, ctx: RequestContext): Promise<StepUpChallenge>;
  /** `POST /internal/admin/step-up/verify`: canjea el código por un `stepUpToken` de un solo uso. 401 `STEP_UP_INVALID`. */
  verifyStepUp(adminId: string, body: StepUpVerifyRequest, ctx: RequestContext): Promise<StepUpToken>;
  /** `POST /internal/admin/step-up/validate`: comprueba el token sin gastarlo. 401 `STEP_UP_INVALID` si es inválido, usado o de otra acción. */
  validateStepUp(adminId: string, body: StepUpRequest & { stepUpToken: string }, ctx: RequestContext): Promise<void>;
  /** `POST /internal/admin/step-up/consume`: gasta el token. 401 `STEP_UP_INVALID` si es inválido, usado o de otra acción. */
  consumeStepUp(adminId: string, body: StepUpRequest & { stepUpToken: string }, ctx: RequestContext): Promise<void>;
}

const isNumber = (value: unknown): value is number => typeof value === "number";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isArrayOf = <T>(value: unknown, guard: (item: unknown) => item is T): value is T[] => Array.isArray(value) && value.every(guard);

const isListItem = (value: unknown): value is AdminUserListItem =>
  isRecord(value) && isString(value.id) && isString(value.fullName) && isString(value.email) && isStringArray(value.roles) && isString(value.accountStatus);

const isUserPage = (body: unknown): body is AdminUserPage =>
  isRecord(body) && isArrayOf(body.items, isListItem) && isNumber(body.page) && isNumber(body.pageSize) && isNumber(body.total);

const isProfile = (body: unknown): body is AdminUserProfile =>
  isRecord(body) &&
  isString(body.id) &&
  isString(body.fullName) &&
  isString(body.email) &&
  isString(body.phone) &&
  isString(body.accountStatus) &&
  isNullableString(body.deletedAt) &&
  Array.isArray(body.roles);

const isKycCard = (value: unknown): value is AdminKycCard => isRecord(value) && isString(value.status) && Array.isArray(value.attempts);
const isKyc = (body: unknown): body is Omit<AdminUserKyc, "mercadoPago"> => isRecord(body) && isKycCard(body.identity) && isKycCard(body.license);

const isVehicle = (body: unknown): body is AdminUserVehicle =>
  isRecord(body) && (body.vehicle === null || (isRecord(body.vehicle) && isString(body.vehicle.licensePlate)));

const isModeration = (body: unknown): body is AdminUserModeration =>
  isRecord(body) &&
  isRecord(body.reports) &&
  Array.isArray(body.reports.received) &&
  Array.isArray(body.reports.made) &&
  isRecord(body.blocks) &&
  Array.isArray(body.blocks.made) &&
  Array.isArray(body.blocks.received) &&
  isRecord(body.totals);

const isDevices = (body: unknown): body is AdminUserDevices =>
  isRecord(body) && Array.isArray(body.devices) && (body.handshakeKey === null || isRecord(body.handshakeKey));

// `roles` llegó con MOVO-322: una versión de svc-users que todavía no lo manda (deploy en serie) no es una respuesta
// inválida, sino una sin roles; el cliente lo completa con `[]`.
type WireNameRef = Omit<AdminUserNameRef, "roles"> & { roles?: string[] };
const isNameRef = (value: unknown): value is WireNameRef =>
  isRecord(value) && isString(value.id) && isString(value.fullName) && (value.roles === undefined || isStringArray(value.roles));
const isReportedUsers = (body: unknown): body is { reports: Array<{ id: string; reportedId: string }> } =>
  isRecord(body) && Array.isArray(body.reports);

const isNames = (body: unknown): body is { users: WireNameRef[] } => isRecord(body) && isArrayOf(body.users, isNameRef);
/** Tope de `POST /internal/admin/users/names` (el `maxItems` del schema de `svc-users`). */
export const USER_NAMES_MAX_IDS = 200;

const isStepUpChallenge = (body: unknown): body is StepUpChallenge =>
  isRecord(body) &&
  isString(body.challengeId) &&
  isString(body.maskedEmail) &&
  isNumber(body.cooldownSeconds) &&
  isNumber(body.expiresInSeconds);
const isStepUpToken = (body: unknown): body is StepUpToken =>
  isRecord(body) && isString(body.stepUpToken) && isNumber(body.expiresInSeconds);
const isReviewRow = (value: unknown): value is AdminKycReviewPage["items"][number] =>
  isRecord(value) &&
  isString(value.sessionId) &&
  isString(value.userId) &&
  isString(value.fullName) &&
  isNullableString(value.photoUrl) &&
  isString(value.verificationType) &&
  isNullableString(value.reason) &&
  isString(value.requestedAt);
const isReviewPage = (body: unknown): body is AdminKycReviewPage =>
  isRecord(body) && isArrayOf(body.items, isReviewRow) && isNumber(body.page) && isNumber(body.pageSize) && isNumber(body.total);
const isReviewDetail = (body: unknown): body is AdminKycReviewDetail =>
  isReviewRow(body) &&
  isString((body as unknown as Record<string, unknown>).email) &&
  isString((body as unknown as Record<string, unknown>).phone) &&
  isNullableString((body as unknown as Record<string, unknown>).expirationDate) &&
  isBoolean((body as unknown as Record<string, unknown>).decidable) &&
  Array.isArray((body as unknown as Record<string, unknown>).history);
const isEvidence = (body: unknown): body is AdminKycEvidence =>
  isRecord(body) &&
  isString(body.fetchedAt) &&
  isString(body.imagesExpireAt) &&
  isRecord(body.images) &&
  Array.isArray(body.warnings) &&
  Array.isArray(body.reviews);
const isDecisionResponse = (body: unknown): body is AdminKycDecisionResponse =>
  isRecord(body) && isString(body.sessionId) && isString(body.userId) && isString(body.verificationType) && isString(body.status);
const isRevokeResult = (body: unknown): body is AdminSessionsRevokeResult => isRecord(body) && isNumber(body.revokedRefreshTokens);

/** Además del resultado público, qué falló después del cambio ya aplicado (solo para la bitácora). */
export type AdminContactUpdateOutcome = AdminContactUpdateResult & { noticeFailed: boolean; sessionsRevokeFailed: boolean };

const isContactResult = (body: unknown): body is AdminContactUpdateOutcome =>
  isRecord(body) &&
  isString(body.email) &&
  isBoolean(body.emailVerified) &&
  isString(body.phone) &&
  isBoolean(body.phoneVerified) &&
  isNumber(body.revokedRefreshTokens) &&
  isBoolean(body.noticeFailed) &&
  isBoolean(body.sessionsRevokeFailed);


/** Ficha de una persona; el rol que cumple en el envío lo agrega quien arma el detalle. */
export type PartyCard = Omit<AdminShipmentPartyCard, "role">;

const isPartyCard = (item: unknown): item is PartyCard =>
  isRecord(item) &&
  isString(item.id) &&
  isString(item.fullName) &&
  isString(item.accountStatus) &&
  typeof item.identityVerified === "boolean" &&
  typeof item.licenseVerified === "boolean" &&
  typeof item.ratingCount === "number";

const isPartyCardList = (body: unknown): body is PartyCard[] => Array.isArray(body) && body.every(isPartyCard);

const isUserReportParties = (body: unknown): body is UserReportParties =>
  isRecord(body) && isString(body.reportId) && isString(body.reporterId) && isString(body.reportedId);

const isAdminSummary = (body: unknown): body is AdminSummary =>
  isRecord(body) &&
  isString(body.id) &&
  isString(body.fullName) &&
  isString(body.email) &&
  isString(body.status) &&
  (body.photoUrl === null || isString(body.photoUrl)) &&
  isString(body.grantedAt);

const isAdminCandidate = (body: unknown): body is AdminCandidate =>
  isRecord(body) &&
  isString(body.id) &&
  isString(body.fullName) &&
  isString(body.email) &&
  isString(body.status) &&
  (body.photoUrl === null || isString(body.photoUrl)) &&
  typeof body.emailVerified === "boolean" &&
  typeof body.isAdmin === "boolean";

const isAdminCandidateList = (body: unknown): body is AdminCandidate[] => Array.isArray(body) && body.every(isAdminCandidate);

const isAdminSummaryList = (body: unknown): body is AdminSummary[] => Array.isArray(body) && body.every(isAdminSummary);

const isNoContent = (body: unknown): body is undefined => body === undefined;

const isSanction = (body: unknown): body is AccountSanction =>
  isRecord(body) &&
  isString(body.id) &&
  isString(body.userId) &&
  (body.type === "suspension" || body.type === "disable") &&
  isString(body.reason) &&
  isNullableString(body.internalNote) &&
  isString(body.startedAt) &&
  isNullableString(body.endsAt) &&
  isNullableString(body.appliedBy) &&
  isNullableString(body.liftedAt) &&
  isNullableString(body.liftedBy) &&
  isNullableString(body.liftReason) &&
  isNullableString(body.closedCause);

const isSanctionList = (body: unknown): body is AccountSanction[] => Array.isArray(body) && body.every(isSanction);

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

  async function overviewInbox<E = unknown>(path: string, ctx: RequestContext): Promise<OverviewInboxSource<E>> {
    const inbox = await client.request(`/internal/admin/overview/${path}`, ctx, { isValid: isOverviewInboxSource<E>, notFoundCodes: [] });
    if (!inbox) throw new Error(`overview ${path}: respuesta vacía`);
    return inbox;
  }

  return {
    ...client,
    async listAdmins(ctx) {
      const admins = await client.request("/internal/admins", ctx, { isValid: isAdminSummaryList, notFoundCodes: [] });
      return admins ?? [];
    },
    async searchAdminCandidates(query, ctx) {
      const found = await client.request(`/internal/admins/candidates?q=${encodeURIComponent(query)}`, ctx, {
        isValid: isAdminCandidateList,
        notFoundCodes: [],
      });
      return found ?? [];
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
    async getPartyCards(userIds, ctx) {
      const ids = userIds.map(encodeURIComponent).join(",");
      const cards = await client.request(`/internal/users/party-cards?ids=${ids}`, ctx, {
        isValid: isPartyCardList,
        notFoundCodes: [],
      });
      return cards ?? [];
    },
    getUserReportParties(reportId, ctx) {
      return client.request(`/internal/user-reports/${encodeURIComponent(reportId)}/parties`, ctx, {
        isValid: isUserReportParties,
        notFoundCodes: ["REPORT_NOT_FOUND"],
      });
    },

    async searchUsers({ q, page, pageSize }, ctx) {
      const query = new URLSearchParams({ q, page: String(page), pageSize: String(pageSize) });
      const result = await client.request(`/internal/admin/users?${query}`, ctx, { isValid: isUserPage, notFoundCodes: [] });
      return result ?? { items: [], page, pageSize, total: 0 };
    },
    getUserProfile: (userId, ctx) => userSection(userId, "", ctx, isProfile),
    getUserKyc: (userId, ctx) => userSection(userId, "/kyc", ctx, isKyc),
    getUserVehicle: (userId, ctx) => userSection(userId, "/vehicle", ctx, isVehicle),
    getUserModeration: (userId, ctx) => userSection(userId, "/moderation", ctx, isModeration),
    getUserDevices: (userId, ctx) => userSection(userId, "/devices", ctx, isDevices),

    getOverviewKyc: (ctx) => overviewInbox<OverviewKycExtra>("kyc", ctx),
    getOverviewUserReports: (ctx) => overviewInbox<OverviewUserReportsExtra>("user-reports", ctx),
    getOverviewSanctionsEndingToday: (ctx) => overviewInbox("sanctions-ending-today", ctx),
    async getReportedUsers(reportIds, ctx) {
      const result = await client.request("/internal/admin/user-reports/reported", ctx, {
        method: "POST",
        body: { ids: reportIds },
        isValid: isReportedUsers,
        notFoundCodes: [],
      });
      return result?.reports ?? [];
    },

    async getUserNames(userIds, ctx) {
      const ids = [...new Set(userIds)];
      // `svc-users` acepta hasta 200 ids por pedido (`maxItems`); un lote más grande (p. ej. `GET /admin/support/events`)
      // se parte, si no el 400 dejaría todo el lote sin nombres.
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += USER_NAMES_MAX_IDS) chunks.push(ids.slice(i, i + USER_NAMES_MAX_IDS));
      const results = await Promise.all(
        chunks.map((chunk) =>
          client.request("/internal/admin/users/names", ctx, {
            method: "POST",
            body: { ids: chunk },
            isValid: isNames,
            notFoundCodes: [],
          })
        )
      );
      return results.flatMap((result) => (result?.users ?? []).map((user) => ({ id: user.id, fullName: user.fullName, roles: user.roles ?? [] })));
    },

    async requestStepUp(adminId, body, ctx) {
      const result = await client.request("/internal/admin/step-up/request", ctx, {
        method: "POST",
        body: { adminId, ...body },
        isValid: isStepUpChallenge,
        notFoundCodes: [],
      });
      if (!result) throw new Error("requestStepUp: respuesta vacía");
      return result;
    },

    async verifyStepUp(adminId, body, ctx) {
      const result = await client.request("/internal/admin/step-up/verify", ctx, {
        method: "POST",
        body: { adminId, ...body },
        isValid: isStepUpToken,
        notFoundCodes: [],
      });
      if (!result) throw new Error("verifyStepUp: respuesta vacía");
      return result;
    },

    async validateStepUp(adminId, body, ctx) {
      await client.request("/internal/admin/step-up/validate", ctx, {
        method: "POST",
        body: { adminId, ...body },
        isValid: (value): value is undefined => value === undefined,
        notFoundCodes: [],
      });
    },

    async consumeStepUp(adminId, body, ctx) {
      await client.request("/internal/admin/step-up/consume", ctx, {
        method: "POST",
        body: { adminId, ...body },
        isValid: (value): value is undefined => value === undefined,
        notFoundCodes: [],
      });
    },

    async revokeUserSessions(userId, actorId, ctx) {
      const result = await client.request(`${userPath(userId)}/sessions/revoke`, ctx, {
        method: "POST",
        actorId,
        isValid: isRevokeResult,
        notFoundCodes: ["USER_NOT_FOUND"],
      });
      return orNotFound(result, "USER_NOT_FOUND", USER_NOT_FOUND_MESSAGE);
    },

    async updateUserContact(userId, body, actorId, ctx) {
      const result = await client.request(`${userPath(userId)}/contact`, ctx, {
        method: "POST",
        body,
        actorId,
        isValid: isContactResult,
        notFoundCodes: ["USER_NOT_FOUND"],
      });
      return orNotFound(result, "USER_NOT_FOUND", USER_NOT_FOUND_MESSAGE);
    },

    async listSanctions(userId, ctx) {
      const result = await client.request(sanctionsPath(userId), ctx, { isValid: isSanctionList, notFoundCodes: ["USER_NOT_FOUND"] });
      return orNotFound(result, "USER_NOT_FOUND", USER_NOT_FOUND_MESSAGE);
    },

    async applySanction(userId, body, actorId, ctx) {
      const result = await client.request(sanctionsPath(userId), ctx, {
        method: "POST",
        body,
        actorId,
        isValid: isSanction,
        notFoundCodes: ["USER_NOT_FOUND"],
      });
      return orNotFound(result, "USER_NOT_FOUND", USER_NOT_FOUND_MESSAGE);
    },

    async listKycReviews(query, ctx) {
      const params = new URLSearchParams({ q: query.q, page: String(query.page), pageSize: String(query.pageSize) });
      if (query.type) params.set("type", query.type);
      const result = await client.request(`${KYC_REVIEWS_PATH}?${params.toString()}`, ctx, {
        isValid: isReviewPage,
        notFoundCodes: [],
      });
      // Sin `notFoundCodes`, un 404 ya se informó como "no tiene este endpoint": acá no hay objetivo que pueda no existir.
      if (result === null) throw new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "El servicio de usuarios devolvió una respuesta inválida.");
      return result;
    },

    async getKycReview(sessionId, ctx) {
      const result = await client.request(`${KYC_REVIEWS_PATH}/${encodeURIComponent(sessionId)}`, ctx, {
        isValid: isReviewDetail,
        notFoundCodes: ["KYC_SESSION_NOT_FOUND"],
      });
      return orKycSessionNotFound(result);
    },

    async getKycEvidence(sessionId, ctx) {
      const result = await client.request(`${KYC_REVIEWS_PATH}/${encodeURIComponent(sessionId)}/evidence`, ctx, {
        isValid: isEvidence,
        notFoundCodes: ["KYC_SESSION_NOT_FOUND"],
        // Didit tarda más que una lectura interna: se le pide la decisión completa antes de responder.
        timeoutMs: 15000,
        relayServerErrorCodes: ["KYC_PROVIDER_ERROR"],
      });
      return orKycSessionNotFound(result);
    },

    async decideKycReview(sessionId, body, actorId, ctx) {
      const result = await client.request(`${KYC_REVIEWS_PATH}/${encodeURIComponent(sessionId)}/decision`, ctx, {
        method: "POST",
        body,
        actorId,
        // Didit tarda más que una lectura interna: el pedido le pega a su API antes de responder.
        timeoutMs: 15000,
        isValid: isDecisionResponse,
        notFoundCodes: ["KYC_SESSION_NOT_FOUND"],
        // Solo el rechazo seguro de Didit. `KYC_PROVIDER_UNCONFIRMED` (red, timeout o 5xx de Didit) no se relaya a
        // propósito: cae en USERS_SERVICE_UNAVAILABLE y la bitácora lo registra como `unknown`, porque pudo aplicarse.
        relayServerErrorCodes: ["KYC_PROVIDER_ERROR"],
      });
      return orKycSessionNotFound(result);
    },

    async liftSanction(userId, sanctionId, reason, actorId, ctx) {
      const result = await client.request(`${sanctionsPath(userId)}/${encodeURIComponent(sanctionId)}/lift`, ctx, {
        method: "POST",
        body: { reason },
        actorId,
        isValid: isSanction,
        notFoundCodes: ["USER_NOT_FOUND", "SANCTION_NOT_FOUND"],
      });
      if (result === null) throw new ApiError(404, "SANCTION_NOT_FOUND", "La sanción no existe.");
      return result;
    },
  };

  async function userSection<T>(userId: string, section: string, ctx: RequestContext, isValid: (body: unknown) => body is T): Promise<T> {
    const result = await client.request(`${userPath(userId)}${section}`, ctx, { isValid, notFoundCodes: ["USER_NOT_FOUND"] });
    return orNotFound(result, "USER_NOT_FOUND", USER_NOT_FOUND_MESSAGE);
  }
}

const USER_NOT_FOUND_MESSAGE = "Usuario no encontrado.";
const KYC_REVIEWS_PATH = "/internal/admin/kyc/reviews";
function orKycSessionNotFound<T>(result: T | null): T {
  if (result === null) throw new ApiError(404, "KYC_SESSION_NOT_FOUND", "No existe esa verificación.");
  return result;
}
const userPath = (userId: string) => `/internal/admin/users/${encodeURIComponent(userId)}`;
const sanctionsPath = (userId: string) => `/internal/users/${encodeURIComponent(userId)}/sanctions`;
