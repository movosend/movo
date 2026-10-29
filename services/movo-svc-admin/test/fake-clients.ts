import { randomUUID } from "node:crypto";
import {
  AdminDisputeCounts,
  AdminDisputeDetail,
  DisputeStatus,
  AdminDisputeHandshakeEvent,
  AdminDisputePage,
  AdminDisputeResolutionPreview,
  AdminDisputeTrace,
  InternalResolveDisputeRequest,
  ResolveDisputeResponse,
  AccountSanction,
  AdminCandidate,
  AdminSummary,
  AdminUserLedgerRowPage,
  AdminUserMercadoPago,
  AdminUserProfile,
  AdminUserRatingRowPage,
  AdminUserShipmentRowPage,
  AdminUserTripPage,
  ApiError,
  ChatReportParties,
  ForceShipmentStatusRequest,
  ForceShipmentStatusResponse,
  AdminChatPage,
  AdminShipmentTracking,
  AdminShipmentDetail,
  AdminShipmentEvent,
  AdminShipmentOffer,
  AdminShipmentPage,
  AdminShipmentPhoto,
  HoldDetailResponse,
  InProgressShipment,
  OpenActivitySummary,
  ShipmentParties,
  ShipmentStatus,
  SupportInternalActor,
  SupportInternalAgentLoad,
  SupportInternalAttachmentBody,
  SupportInternalCounts,
  SupportInternalCountsQuery,
  SupportInternalListQuery,
  SupportInternalMessage,
  SupportInternalPatchBody,
  SupportInternalRow,
  SupportInternalSendBody,
  SupportInternalUserConversations,
  UserReportParties,
  WithdrawOpenActivityResult,
} from "@movo/shared";
import { InternalClient } from "../src/adapters/internal-client";
import { ShipmentsClient } from "../src/adapters/shipments-client";
import { PartyCard, UsersClient } from "../src/adapters/users-client";
import { LedgerAdjustmentRequest, PaymentsClient } from "../src/adapters/payments-client";
import { SupportClient } from "../src/adapters/support-client";

const unusedRequest: InternalClient["request"] = async () => {
  throw new Error("request genérico fuera de alcance de este fake");
};

/** Servicio dueño caído: cada llamada falla con el 502 que daría el cliente real. */
export const shipmentsDown = () => new ApiError(502, "SHIPMENTS_SERVICE_UNAVAILABLE", "El servicio de envíos no responde.");
export const usersDown = () => new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "El servicio de usuarios no responde.");
export const paymentsDown = () => new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "El servicio de pagos no responde.");

const userNotFound = () => new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");

export const emptyWithdrawal = (): WithdrawOpenActivityResult => ({
  cancelledShipmentIds: [],
  withdrawnOfferIds: [],
  cancelledTripIds: [],
  stoppedRecurrenceTripIds: [],
  notifiedCounterpartyCount: 0,
  failures: [],
});

export function createFakeShipmentsClient(data: {
  shipments?: Record<string, ShipmentParties>;
  chatReports?: Record<string, ChatReportParties>;
  /** MOVO-294: secciones de la ficha, por id de usuario. */
  userShipments?: Record<string, AdminUserShipmentRowPage>;
  userTrips?: Record<string, AdminUserTripPage>;
  userRatings?: Record<string, AdminUserRatingRowPage>;
  /** MOVO-325 */
  page?: AdminShipmentPage;
  details?: Record<string, AdminShipmentDetail>;
  events?: Record<string, AdminShipmentEvent[]>;
  photos?: Record<string, AdminShipmentPhoto[]>;
  offers?: Record<string, AdminShipmentOffer[]>;
  /** Solo el endpoint de ofertas falla (deploy en serie: svc-shipments todavía sin la ruta). */
  offersDown?: boolean;
  chats?: Record<string, AdminChatPage>;
  /** MOVO-327 */
  trackings?: Record<string, AdminShipmentTracking>;
  /** Últimos query strings recibidos, para comprobar que se reenvían. */
  seen?: { list?: string; chat?: string };
  /** MOVO-299: efectos de una sanción, por id de usuario. */
  inProgress?: Record<string, InProgressShipment[]>;
  openActivity?: Record<string, Omit<OpenActivitySummary, "inProgressShipments">>;
  /** Respuestas del retiro, en orden; un `ApiError` se lanza. Agotadas, el retiro no encuentra nada. */
  withdrawResults?: Array<WithdrawOpenActivityResult | ApiError>;
  withdrawCalls?: Array<{ userId: string; sanctionId: string }>;
  /**
   * MOVO-332: `POST .../force-status`. `calls` guarda lo recibido; `error` hace que svc-shipments rechace;
   * `unavailable` simula que no responde (la bitácora lo toma por "pudo haberse aplicado").
   */
  force?: { calls: ForceShipmentStatusRequest[]; error?: ApiError; unavailable?: boolean };
  /**
   * MOVO-337: disputas, por id. `resolve.calls` guarda lo recibido; `error` hace que svc-shipments rechace;
   * `unavailable` simula que no responde; `response` pisa campos de la respuesta.
   */
  disputes?: {
    page?: AdminDisputePage;
    details?: Record<string, AdminDisputeDetail>;
    parties?: Record<string, ShipmentParties & { shipmentId: string }>;
    previews?: Record<string, AdminDisputeResolutionPreview>;
    handshakes?: Record<string, AdminDisputeHandshakeEvent[]>;
    traces?: Record<string, AdminDisputeTrace>;
    resolve?: {
      calls: InternalResolveDisputeRequest[];
      error?: ApiError;
      unavailable?: boolean;
      response?: Partial<ResolveDisputeResponse>;
    };
    seen?: { list?: string };
    counts?: AdminDisputeCounts;
  };
  down?: boolean;
} = {}): ShipmentsClient {
  return {
    request: unusedRequest,
    async listInProgressShipments(userId) {
      if (data.down) throw shipmentsDown();
      return data.inProgress?.[userId] ?? [];
    },
    async getOpenActivity(userId) {
      if (data.down) throw shipmentsDown();
      const open = data.openActivity?.[userId] ?? { shipments: 0, offers: 0, trips: 0, recurringSeries: 0 };
      return { ...open, inProgressShipments: data.inProgress?.[userId] ?? [] };
    },
    async withdrawOpenActivity(userId, sanctionId) {
      data.withdrawCalls?.push({ userId, sanctionId });
      if (data.down) throw shipmentsDown();
      const next = data.withdrawResults?.shift();
      if (next instanceof ApiError) throw next;
      return next ?? emptyWithdrawal();
    },
    async listUserShipments(userId, query) {
      if (data.down) throw shipmentsDown();
      return (
        data.userShipments?.[userId] ?? { items: [], page: query.page, pageSize: query.pageSize, total: 0, counts: { sender: 0, carrier: 0, receiver: 0 } }
      );
    },
    async listUserTrips(userId, query) {
      if (data.down) throw shipmentsDown();
      return data.userTrips?.[userId] ?? { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
    },
    async listUserRatings(userId, query) {
      if (data.down) throw shipmentsDown();
      return data.userRatings?.[userId] ?? { average: null, count: 0, items: [], page: query.page, pageSize: query.pageSize };
    },
    async listAdminShipments(query) {
      if (data.down) throw shipmentsDown();
      if (data.seen) data.seen.list = query.toString();
      return (
        data.page ?? {
          items: [],
          nextCursor: null,
          counts: { all: 0, unassigned: 0, assigning: 0, in_progress: 0, closed: 0, disputes: 0 },
          statusCounts: Object.fromEntries(Object.values(ShipmentStatus).map((status) => [status, 0])) as AdminShipmentPage["statusCounts"],
          alertCounts: { all: 0, unassigned: 0, assigning: 0, in_progress: 0, closed: 0, disputes: 0 },
        }
      );
    },
    async getAdminShipment(id) {
      if (data.down) throw shipmentsDown();
      return data.details?.[id] ?? null;
    },
    async getAdminShipmentEvents(id) {
      if (data.down) throw shipmentsDown();
      return data.events?.[id] ?? [];
    },
    async getAdminShipmentOffers(id) {
      if (data.down || data.offersDown) throw shipmentsDown();
      return data.offers?.[id] ?? [];
    },
    async getAdminShipmentPhotos(id) {
      if (data.down) throw shipmentsDown();
      return data.photos?.[id] ?? [];
    },
    async getAdminShipmentChat(id, query) {
      if (data.down) throw shipmentsDown();
      if (data.seen) data.seen.chat = query.toString();
      return data.chats?.[id] ?? null;
    },
    async getAdminShipmentTracking(id) {
      if (data.down) throw shipmentsDown();
      return data.trackings?.[id] ?? null;
    },
    async forceShipmentStatus(id, body): Promise<ForceShipmentStatusResponse> {
      if (data.down || data.force?.unavailable) throw shipmentsDown();
      data.force?.calls.push(body);
      if (data.force?.error) throw data.force.error;
      const kind = body.targetStatus === "cancelled" && body.expectedStatus === "assigned" ? "forced" : "manual";
      return { shipmentId: id, fromStatus: body.expectedStatus, toStatus: body.targetStatus, kind, replayed: false };
    },
    async listAdminDisputes(query) {
      if (data.down) throw shipmentsDown();
      if (data.disputes?.seen) data.disputes.seen.list = query.toString();
      return data.disputes?.page ?? { items: [], nextCursor: null, statusCounts: { open: 0, resolving: 0, resolved: 0 } };
    },
    async getDisputeCounts() {
      if (data.down) throw shipmentsDown();
      return data.disputes?.counts ?? { open: 0, resolving: 0, openOlderThan3Days: 0, openOlderThan7Days: 0 };
    },
    async getAdminDispute(id) {
      if (data.down) throw shipmentsDown();
      return data.disputes?.details?.[id] ?? null;
    },
    async getDisputeParties(id) {
      if (data.down) throw shipmentsDown();
      const detail = data.disputes?.details?.[id];
      return (
        data.disputes?.parties?.[id] ??
        (detail ? { shipmentId: detail.shipmentId, senderId: "", carrierId: null, receiverId: null, formerReceiverIds: [] } : null)
      );
    },
    async getDisputeHandshake(id) {
      if (data.down) throw shipmentsDown();
      return data.disputes?.handshakes?.[id] ?? (data.disputes?.details?.[id] ? [] : null);
    },
    async getDisputeTrace(id) {
      if (data.down) throw shipmentsDown();
      return data.disputes?.traces?.[id] ?? (data.disputes?.details?.[id] ? { available: false, points: [] } : null);
    },
    async getDisputeResolutionPreview(id) {
      if (data.down) throw shipmentsDown();
      return data.disputes?.previews?.[id] ?? null;
    },
    async resolveDispute(id, body): Promise<ResolveDisputeResponse> {
      if (data.down || data.disputes?.resolve?.unavailable) throw shipmentsDown();
      data.disputes?.resolve?.calls.push(body);
      if (data.disputes?.resolve?.error) throw data.disputes.resolve.error;
      return {
        disputeId: id,
        shipmentId: data.disputes?.parties?.[id]?.shipmentId ?? randomUUID(),
        outcome: body.outcome,
        reasoning: body.reasoning,
        carrierAmountArs: body.outcome === "sender" ? 0 : 1150,
        senderAmountArs: body.outcome === "carrier" ? 0 : 1150,
        paymentAction: "none",
        status: DisputeStatus.RESOLVED,
        shipmentStatus: body.outcome === "sender" ? "cancelled" : "completed",
        replayed: false,
        resolvedAt: new Date().toISOString(),
        ...data.disputes?.resolve?.response,
      };
    },
    async getShipmentParties(id) {
      if (data.down) throw shipmentsDown();
      return data.shipments?.[id] ?? null;
    },
    async getChatReportParties(id) {
      if (data.down) throw shipmentsDown();
      return data.chatReports?.[id] ?? null;
    },
  };
}

export function createFakeUsersClient(
  data: {
    userReports?: Record<string, UserReportParties>;
    admins?: AdminSummary[];
    candidates?: AdminCandidate[];
    /** MOVO-294: perfiles de la ficha; sus nombres son los que resuelve `getUserNames`. */
    profiles?: AdminUserProfile[];
    /** Solo la resolución de nombres falla (el resto de `svc-users` responde). */
    namesDown?: boolean;
    /** MOVO-322: solo el KYC falla (las insignias del contexto de soporte fallan abierto). */
    kycDown?: boolean;
    cards?: PartyCard[];
    /** MOVO-299: historial de sanciones de todos los usuarios; se muta como en `svc-users`. */
    sanctions?: AccountSanction[];
    /**
     * MOVO-332: el segundo factor. `consumed` guarda los tokens gastados; `consumeError` hace que `svc-users`
     * rechace el token (`STEP_UP_INVALID`); `verifyError` rechaza el código.
     */
    stepUp?: {
      requested: Array<{ adminId: string; shipmentId: string; targetStatus: string }>;
      validated?: Array<{ adminId: string; shipmentId: string; targetStatus: string; stepUpToken: string }>;
      consumed: Array<{ adminId: string; shipmentId: string; targetStatus: string; stepUpToken: string }>;
      verifyError?: ApiError;
      validateError?: ApiError;
      consumeError?: ApiError;
    };
    down?: boolean;
  } = {},
): UsersClient {
  const admins = data.admins ?? [];
  const sanctions = data.sanctions ?? [];
  const profiles = data.profiles ?? [];
  const profileOf = (id: string) => {
    if (data.down) throw usersDown();
    const profile = profiles.find((p) => p.id === id);
    if (!profile) throw userNotFound();
    return profile;
  };
  const assertNotDeleted = (profile: AdminUserProfile) => {
    if (profile.accountStatus === "deleted") throw new ApiError(409, "USER_DELETED", "La cuenta está dada de baja.");
  };
  return {
    request: unusedRequest,
    async searchUsers({ q, page, pageSize }) {
      if (data.down) throw usersDown();
      const found = profiles.filter((p) => !q || p.fullName.toLowerCase().includes(q.toLowerCase()));
      return {
        items: found.slice((page - 1) * pageSize, page * pageSize).map((p) => ({
          id: p.id,
          fullName: p.fullName,
          email: p.email,
          phone: p.phone,
          dni: p.dni,
          photoUrl: p.photoUrl,
          roles: p.roles.map((r) => r.role),
          accountStatus: p.accountStatus,
          bannedUntil: p.bannedUntil,
          kycIdentity: "approved" as const,
          kycLicense: "not_started" as const,
          createdAt: p.createdAt,
          matchedBy: q ? ("name" as const) : null,
        })),
        page,
        pageSize,
        total: found.length,
      };
    },
    async getUserProfile(id) {
      return profileOf(id);
    },
    async getUserKyc(id) {
      profileOf(id);
      if (data.kycDown) throw usersDown();
      return {
        identity: { status: "approved" as const, lastSessionId: "s-1", attempts: [] },
        license: { status: "not_started" as const, lastSessionId: null, expiresAt: null, attempts: [] },
      };
    },
    async getUserVehicle(id) {
      profileOf(id);
      return { vehicle: null };
    },
    async getUserModeration(id) {
      profileOf(id);
      return {
        reports: { received: [], made: [] },
        blocks: { made: [], received: [] },
        totals: { reportsReceived: 0, reportsMade: 0, blocksMade: 0, blocksReceived: 0 },
      };
    },
    async getUserDevices(id) {
      profileOf(id);
      return { devices: [], handshakeKey: null };
    },
    async getUserNames(ids) {
      if (data.down || data.namesDown) throw usersDown();
      return profiles.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, fullName: p.fullName, roles: (p.roles ?? []).map((r) => r.role) }));
    },
    async requestStepUp(adminId, body) {
      if (data.down) throw usersDown();
      data.stepUp?.requested.push({ adminId, ...body });
      return { challengeId: "challenge-1", maskedEmail: "a***@movo.test", cooldownSeconds: 60, expiresInSeconds: 300 };
    },
    async verifyStepUp() {
      if (data.down) throw usersDown();
      if (data.stepUp?.verifyError) throw data.stepUp.verifyError;
      return { stepUpToken: "step-up-token-".padEnd(43, "x"), expiresInSeconds: 300 };
    },
    async validateStepUp(adminId, body) {
      if (data.down) throw usersDown();
      if (data.stepUp?.validateError) throw data.stepUp.validateError;
      data.stepUp?.validated?.push({ adminId, ...body });
    },
    async consumeStepUp(adminId, body) {
      if (data.down) throw usersDown();
      if (data.stepUp?.consumeError) throw data.stepUp.consumeError;
      data.stepUp?.consumed.push({ adminId, ...body });
    },
    async revokeUserSessions(id) {
      assertNotDeleted(profileOf(id));
      return { revokedRefreshTokens: 2 };
    },
    async updateUserContact(id, body) {
      const profile = profileOf(id);
      assertNotDeleted(profile);
      const current = body.field === "email" ? profile.email : profile.phone;
      if (body.expectedCurrent !== current) throw new ApiError(409, "CONTACT_CHANGED", "El dato cambió.");
      if (body.field === "email") Object.assign(profile, { email: body.newValue, emailVerified: false });
      else Object.assign(profile, { phone: body.newValue, phoneVerified: false });
      return {
        email: profile.email,
        emailVerified: profile.emailVerified,
        phone: profile.phone,
        phoneVerified: profile.phoneVerified,
        revokedRefreshTokens: 1,
        noticeFailed: false,
        sessionsRevokeFailed: false,
      };
    },
    async listAdmins() {
      if (data.down) throw usersDown();
      return [...admins];
    },
    async searchAdminCandidates(query) {
      if (data.down) throw usersDown();
      const term = query.toLowerCase();
      return (data.candidates ?? []).filter((c) => c.fullName.toLowerCase().includes(term) || c.email.toLowerCase().includes(term));
    },
    async grantAdmin(email) {
      if (data.down) throw usersDown();
      const existing = admins.find((a) => a.email === email);
      if (existing) return existing;
      throw new ApiError(404, "USER_NOT_FOUND", "No existe un usuario con ese email.");
    },
    async revokeAdmin(userId) {
      if (data.down) throw usersDown();
      const index = admins.findIndex((a) => a.id === userId);
      if (index === -1) throw new ApiError(404, "ADMIN_NOT_FOUND", "El usuario no es admin.");
      if (admins.length === 1) throw new ApiError(409, "ADMIN_LAST_ADMIN", "No se puede revocar el rol al último admin.");
      admins.splice(index, 1);
    },
    async getPartyCards(ids) {
      if (data.down) throw usersDown();
      return (data.cards ?? []).filter((card) => ids.includes(card.id));
    },
    async getUserReportParties(id) {
      if (data.down) throw usersDown();
      return data.userReports?.[id] ?? null;
    },
    async listSanctions(userId) {
      profileOf(userId);
      return sanctions.filter((s) => s.userId === userId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },
    async applySanction(userId, body, actorId) {
      const profile = profileOf(userId);
      const open = sanctions.filter((s) => s.userId === userId && !s.liftedAt);
      if (open.some((s) => s.type === "disable")) throw new ApiError(409, "ACCOUNT_ALREADY_DISABLED", "La cuenta ya está inhabilitada.");
      const now = new Date().toISOString();
      for (const s of open) Object.assign(s, { liftedAt: now, closedCause: body.type === "disable" ? "escalated" : "replaced" });
      const created: AccountSanction = {
        id: randomUUID(),
        userId,
        type: body.type,
        reason: body.reason,
        internalNote: body.internalNote ?? null,
        startedAt: now,
        endsAt: body.endsAt ?? null,
        appliedBy: actorId,
        liftedAt: null,
        liftedBy: null,
        liftReason: null,
        closedCause: null,
      };
      sanctions.push(created);
      Object.assign(profile, { accountStatus: body.type === "disable" ? "banned" : "suspended", bannedUntil: body.endsAt ?? null });
      return created;
    },
    async liftSanction(userId, sanctionId, reason, actorId) {
      const profile = profileOf(userId);
      const sanction = sanctions.find((s) => s.id === sanctionId && s.userId === userId);
      if (!sanction) throw new ApiError(404, "SANCTION_NOT_FOUND", "La sanción no existe.");
      if (sanction.liftedAt) throw new ApiError(409, "SANCTION_ALREADY_CLOSED", "La sanción ya está cerrada.");
      Object.assign(sanction, { liftedAt: new Date().toISOString(), liftedBy: actorId, liftReason: reason, closedCause: "lifted" });
      Object.assign(profile, { accountStatus: "active", bannedUntil: null });
      return sanction;
    },
  };
}

/** MOVO-294: cuenta corriente y Mercado Pago. El ajuste es idempotente por key, como el real. */
export function createFakePaymentsClient(
  data: { holds?: Record<string, HoldDetailResponse>; ledgers?: Record<string, AdminUserLedgerRowPage>; mercadoPago?: Record<string, AdminUserMercadoPago>; down?: boolean } = {},
) {
  const adjustments = new Map<string, { body: LedgerAdjustmentRequest; id: string; createdAt: string }>();
  const client: PaymentsClient = {
    request: unusedRequest,
    async findHoldByShipment(id) {
      if (data.down) throw paymentsDown();
      return data.holds?.[id] ?? null;
    },
    async getUserMercadoPago(userId) {
      if (data.down) throw paymentsDown();
      return data.mercadoPago?.[userId] ?? { status: "not_linked", nickname: null, connectedAt: null, unlinkedAt: null };
    },
    async getUserLedger(userId) {
      if (data.down) throw paymentsDown();
      return data.ledgers?.[userId] ?? { balanceArs: 0, items: [], nextCursor: null };
    },
    async createLedgerAdjustment(_userId, body) {
      if (data.down) throw paymentsDown();
      if (body.amountArs === 0) throw new ApiError(422, "AMOUNT_OUT_OF_RANGE", "Fuera de rango.");
      const existing = adjustments.get(body.idempotencyKey);
      if (existing && existing.body.amountArs !== body.amountArs) {
        throw new ApiError(409, "LEDGER_IDEMPOTENCY_CONFLICT", "La idempotencyKey ya se usó con otro movimiento.");
      }
      const saved = existing ?? { body, id: randomUUID(), createdAt: new Date().toISOString() };
      adjustments.set(body.idempotencyKey, saved);
      const balanceArs = [...adjustments.values()].reduce((sum, a) => sum + a.body.amountArs, 0);
      return {
        entry: {
          id: saved.id,
          type: "manual_adjustment",
          amountArs: body.amountArs,
          status: "pending",
          shipmentId: null,
          reason: body.reason,
          createdAt: saved.createdAt,
        },
        created: !existing,
        balanceArs,
      };
    },
  };
  return { client, adjustments };
}

export const supportDown = () => new ApiError(502, "SUPPORT_SERVICE_UNAVAILABLE", "El servicio de soporte no responde.");
const supportNotFound = () => new ApiError(404, "SUPPORT_CONVERSATION_NOT_FOUND", "La consulta no existe.");

/**
 * MOVO-322: `/internal/admin/support/*` de svc-shipments. Guarda lo que recibe (`seen`) para comprobar qué resolvió
 * svc-admin (`assignee=me`, `userIds`, el actor) sin repetir las reglas del modelo, que prueba svc-shipments.
 */
export function createFakeSupportClient(
  data: {
    rows?: Record<string, SupportInternalRow>;
    messages?: Record<string, SupportInternalMessage[]>;
    userConversations?: Record<string, SupportInternalUserConversations>;
    loads?: SupportInternalAgentLoad[];
    counts?: SupportInternalCounts;
    down?: boolean;
  } = {},
) {
  const seen: {
    list?: SupportInternalListQuery;
    counts?: SupportInternalCountsQuery;
    send?: SupportInternalSendBody;
    patch?: SupportInternalPatchBody;
    actor?: SupportInternalActor;
    attachment?: SupportInternalAttachmentBody;
    read?: string;
  } = {};
  const rowOf = (id: string) => {
    if (data.down) throw supportDown();
    const row = data.rows?.[id];
    if (!row) throw supportNotFound();
    return row;
  };
  const client: SupportClient = {
    request: unusedRequest,
    async list(query) {
      if (data.down) throw supportDown();
      seen.list = query;
      return { items: Object.values(data.rows ?? {}).filter((r) => r.status === query.status), nextCursor: null };
    },
    async counts(query) {
      if (data.down) throw supportDown();
      seen.counts = query;
      return data.counts ?? { byStatus: { open: 0, awaiting_user: 0, resolved: 0 }, byOwner: { all: 0, mine: 0, none: 0 }, unreadTotal: 0 };
    },
    async get(id) {
      return rowOf(id);
    },
    async messages(id) {
      rowOf(id);
      return { items: data.messages?.[id] ?? [], nextCursor: null };
    },
    async send(id, body) {
      const row = rowOf(id);
      seen.send = body;
      const message: SupportInternalMessage = {
        id: randomUUID(),
        conversationId: id,
        kind: body.internal ? "note" : "agent",
        authorId: body.actorId,
        authorName: body.actorFirstName,
        body: body.body,
        clientMessageId: body.clientMessageId,
        attachments: [],
        createdAt: new Date().toISOString(),
      };
      return { message, conversation: row };
    },
    async patch(id, body) {
      const row = rowOf(id);
      seen.patch = body;
      return { ...row, ...(body.assignedTo !== undefined ? { assignedTo: body.assignedTo } : {}), ...(body.priority ? { priority: body.priority } : {}) };
    },
    async resolve(id, actor) {
      seen.actor = actor;
      return { ...rowOf(id), status: "resolved" };
    },
    async reopen(id, actor) {
      seen.actor = actor;
      return { ...rowOf(id), status: "open" };
    },
    async read(id) {
      rowOf(id);
      seen.read = id;
    },
    async getParties(id) {
      if (data.down) throw supportDown();
      const row = data.rows?.[id];
      return row ? { userId: row.userId } : null;
    },
    async userConversations(id) {
      rowOf(id);
      return data.userConversations?.[id] ?? { items: [] };
    },
    async agentLoads() {
      if (data.down) throw supportDown();
      return data.loads ?? [];
    },
    async createAttachment(id, body) {
      rowOf(id);
      seen.attachment = body;
      return { attachmentId: randomUUID(), uploadUrl: "https://bucket/put", expiresAt: new Date(Date.now() + 300_000).toISOString() };
    },
  };
  return { client, seen };
}
