/**
 * Barrel de exports de @movo/shared.
 *
 * Convención (zona de conflicto crítica, ver MOVO-67): cada dominio tiene
 * su propio bloque de comentario. Al agregar un nuevo export, sumá una
 * línea al final del bloque de tu dominio — nunca reordenes las líneas
 * existentes ni las de otro dominio.
 */

// auth
export {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  ACCESS_TOKEN_TTL_SECONDS,
  PANEL_ACCESS_TOKEN_TTL_SECONDS,
  PANEL_SESSION_TTL_SECONDS,
} from "./auth/jwt";
export type {
  AccessTokenPayload,
  SignAccessTokenOptions,
  RefreshTokenResult,
  VerifyAccessTokenResult,
} from "./auth/jwt";
export type { AccessTokenClaims } from "./auth/claims";

// errors
export { ApiError } from "./errors/api-error";
export type { ApiErrorCode, ApiErrorDetails, SerializedApiError } from "./errors/api-error";

// types
export {
  UserRole,
  KycStatus,
  AccountStatus,
  ReportReason,
  ReportStatus,
  MAX_REPORT_PHOTOS_PER_SUBMISSION,
} from "./types/user";
export type {
  BlockedUserSummary,
  ReportPhotoUploadUrl,
  UserReportEntry,
  UserReportPhoto,
  UserReportSummary,
  AdminCandidate,
  AdminSummary,
} from "./types/user";
export { ShipmentStatus } from "./types/shipment";
export type {
  SharedHistory,
  ActiveShipmentStatus,
  ActiveShipmentCounterparty,
  ActiveShipmentSummary,
  RatingRole,
  PendingRatingShipment,
} from "./types/shipment";
export { ACCOUNT_SANCTION_REASON_MAX_LENGTH, ACCOUNT_SANCTION_NOTE_MAX_LENGTH, accountRestrictionKey } from "./types/account-sanctions";
export type {
  AccountSanctionType,
  AccountSanctionClosedCause,
  PublicAccountStatus,
  AccountSanction,
  OwnAccountSanction,
  ApplyAccountSanctionRequest,
  LiftAccountSanctionRequest,
  AccountRestrictionMark,
} from "./types/account-sanctions";
export { OfferStatus } from "./types/offer";
export { TripStatus } from "./types/trip";
export type {
  ProfileBadge,
  TransactionCounts,
  PrivateProfile,
  PublicProfile,
  ReputationBreakdown,
  ReputationCategoryScore,
  RecentRatingComment,
  MutualConnections,
  VehicleProfile,
} from "./types/user-profile";
export type { Address, CreateAddressInput, UpdateAddressInput } from "./types/address";
export type { PlacePrediction } from "./types/places";
export { PriceCalculationMethod } from "./types/pricing";
export type {
  DemandContext,
  QuoteRequest,
  QuoteResponse,
  ShipmentQuoteRequest,
  ShipmentQuoteResponse,
  QuoteBreakdown,
} from "./types/pricing";
export { OptimizationStatus } from "./types/routing";
export type {
  Coordinates,
  RouteStopType,
  RouteStopInput,
  OptimizeRouteRequest,
  RouteStopOutput,
  OptimizeRouteResponse,
  CarrierRouteStop,
  CarrierRoute,
  OptimizationObjective,
  PrecomputedMatrix,
  RouteMatrixRequest,
  RouteMatrixResponse,
} from "./types/routing";
export { MP_CONNECT_RETURN_URL } from "./types/mp-connect";
export type {
  MpConnectStatus,
  MpConnectInvalidReason,
  MpConnectAccount,
  MpConnectStatusResponse,
  MpConnectAuthorizationUrlResponse,
  MpConnectReturnResult,
  MpConnectReturnErrorCode,
} from "./types/mp-connect";

// carrier eligibility (MOVO-116)
export type {
  CarrierKycStatusResponse,
  CarrierMpAccountStatusResponse,
  CarrierRequirement,
  CarrierRequirementsErrorDetails,
} from "./types/carrier-eligibility";

// hold (MOVO-209)
export { CLOSED_HOLD_STATUSES, HOLD_STATUSES, LIVE_HOLD_STATUSES } from "./types/hold";
export type {
  CreateHoldRequest,
  HoldCheckoutDataRequest,
  HoldCheckoutDataResponse,
  HoldDebtBreakdown,
  HoldFailureReason,
  HoldDetailResponse,
  HoldResponse,
  HoldStatus,
} from "./types/hold";

// saved cards (MOVO-100)
export { MAX_SAVED_CARDS_PER_USER, SAVED_CARD_ALIAS_MAX_LENGTH } from "./types/saved-card";
export type {
  CardsCheckoutDataResponse,
  CreateSavedCardRequest,
  SavedCard,
  UpdateSavedCardRequest,
} from "./types/saved-card";

// historial de transacciones (MOVO-303)
export {
  TRANSACTION_KINDS,
  TRANSACTION_MOVEMENT_KINDS,
  TRANSACTION_RELEASE_REASONS,
  TRANSACTION_ROLES,
  TRANSACTION_STATUSES,
  TRANSACTIONS_DEFAULT_LIMIT,
  TRANSACTIONS_MAX_LIMIT,
} from "./types/transaction";
export type {
  TransactionBreakdown,
  TransactionCard,
  TransactionDetail,
  TransactionKind,
  TransactionListItem,
  TransactionListResponse,
  TransactionMovement,
  TransactionMovementKind,
  TransactionReleaseReason,
  TransactionRole,
  TransactionStatus,
} from "./types/transaction";

// liquidación: captura del hold + split (MOVO-212)
export { SETTLEMENT_ISSUE_STATUSES, SETTLEMENT_KINDS, SETTLEMENT_STATUSES } from "./types/settlement";
export type {
  CaptureHoldRequest,
  CaptureHoldResponse,
  SettlementDisplayStatus,
  SettlementEscalationReason,
  SettlementEventRequest,
  SettlementEventResponse,
  SettlementFailureReason,
  SettlementIssueItem,
  SettlementIssuesPage,
  SettlementIssueStatus,
  SettlementKind,
  SettlementResponse,
  SettlementStatus,
  ShipmentSettlementResponse,
} from "./types/settlement";
// cuenta corriente del usuario (MOVO-309)
export { USER_LEDGER_ENTRY_STATUSES, USER_LEDGER_ENTRY_TYPES, USER_LEDGER_ROLES } from "./types/user-ledger";
export type {
  BalancePayDataResponse,
  CarrierDebtDiscount,
  BalancePayRequest,
  BalancePayResponse,
  CreateManualAdjustmentRequest,
  CreateUserLedgerEntryRequest,
  CreateUserLedgerEntryResponse,
  DebtCollectionPreviewRequest,
  DebtCollectionPreviewResponse,
  UserLedgerBalanceResponse,
  UserLedgerEntry,
  UserLedgerEntryStatus,
  UserLedgerEntryType,
  UserLedgerPageResponse,
  UserLedgerRole,
} from "./types/user-ledger";
// funding (MOVO-210)
export type {
  CarrierFundingView,
  FundingAttempt,
  FundingCard,
  FundingLapseReason,
  FundingRoute,
  HoldProviderEventKind,
  OfferAcceptanceAssignment,
  SenderFundingView,
  ShipmentFundingView,
  HoldProviderEventRequest,
  ShipmentFundingRequest,
  ShipmentFundingResponse,
  ShipmentFundingResult,
} from "./types/funding";

// commission
export {
  getCommissionConfig,
  computeOfferGrossPrice,
  computeNetFromGross,
  decomposeOfferGrossPrice,
  carrierPaymentView,
  estimateMpFeeArs,
  estimateReceivedArs,
  __resetCommissionConfigForTests,
} from "./config/commission";
export type { CommissionConfig, OfferGrossPriceBreakdown } from "./config/commission";

// legal (MOVO-228)
export { LEGAL_DOCUMENT_VERSIONS } from "./config/legal";
export type { LegalDocumentKind } from "./config/legal";

// rating categories (MOVO-173)
export {
  CARRIER_RATING_CATEGORIES,
  SENDER_RATING_CATEGORIES,
  RECEIVER_RATING_CATEGORIES,
} from "./config/rating-categories";
export type { RatingCategoryDefinition, RatingCategoryScoreField } from "./config/rating-categories";

// utils
export {
  ARGENTINA_UTC_OFFSET_HOURS,
  toArgentinaCalendarDateString,
  toArgentinaTimeOfDayString,
} from "./utils/argentina-date";

// notification preferences (MOVO-239)
export {
  NOTIFICATION_CATEGORIES,
  IMPLEMENTED_NOTIFICATION_CATEGORY_IDS,
  isImplementedNotificationCategory,
  getNotificationCategory,
} from "./config/notification-categories";
export type {
  NotificationSection,
  NotificationCategoryDefinition,
  NotificationCategoryId,
} from "./config/notification-categories";
export { TOUR_IDS, TOUR_OUTCOMES, isTourId } from "./config/tours";
export type { TourId, TourOutcome, UserTourRecord } from "./config/tours";
export {
  NOTIFICATION_TRIGGERS,
  notificationTriggerCopy,
  notificationTriggerCategory,
  renderNotificationTrigger,
} from "./config/notification-templates";
export type {
  NotificationTriggerKey,
  NotificationCopy,
  NotificationTriggerDefinition,
} from "./config/notification-templates";
export { isValidTimeOfDay, isWithinQuietHours } from "./config/quiet-hours";

// trip start (MOVO-277)
export { canStartTripOn, tripStartAvailableOn } from "./config/trip-start";
export {
  PACKAGE_WEIGHT_KG_MIN,
  PACKAGE_WEIGHT_KG_STEP,
  PACKAGE_DIMENSION_CM_MIN,
  PACKAGE_DIMENSION_CM_STEP,
  PACKAGE_DIMENSION_CM_MAX,
  PACKAGE_DIMENSION_CM_OPTIONS,
  PACKAGE_INPUT_SANITY_MAX,
  roundPackageWeightKg,
} from "./config/package-dimensions";
// penalidad por cancelar un envío asignado (MOVO-307, ADR-047)
export {
  CANCELLATION_PENALTY_FREE_HOURS,
  CANCELLATION_PENALTY_RATE,
  computeCancellationPenalty,
  computeCarrierWithdrawalPenalty,
  isSenderCancellableStatus,
  SENDER_CANCELLABLE_STATUSES,
} from "./config/cancellation-penalty";
export type {
  CancellationPenaltyInput,
  CancellationPenaltyQuote,
  CancellationPenaltyReason,
  CancellationQuoteResponse,
} from "./config/cancellation-penalty";

// atribución del no-retiro (MOVO-270, ADR-052)
export {
  ARRIVAL_RADIUS_M,
  ARRIVAL_MAX_ACCURACY_M,
  ABSENCE_MIN_DISTANCE_M,
  ARRIVAL_EARLY_MARGIN_MIN,
  MIN_ABSENCE_POSITIONS,
} from "./config/pickup-attribution";
export type { PickupMissedAttribution } from "./config/pickup-attribution";

// viajes recurrentes (MOVO-265, ADR-042)
export {
  RECURRENCE_WEEKDAY,
  MAX_ACTIVE_RECURRING_SERIES,
  argentinaWeekday,
  formatArgentinaShortDay,
  nextRecurrenceOccurrence,
} from "./config/trip-recurrence";

// chat (MOVO-26)
export {
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_POST_DELIVERY_WINDOW_HOURS,
  CHAT_PAGE_MAX_LIMIT,
  CHAT_MODERATION_WARNING,
} from "./types/chat";
export type {
  ChatAccess,
  ChatDeliveryStatus,
  ChatListItem,
  ChatListResponse,
  ChatMessage,
  ChatMessagesPage,
  ChatParticipant,
  ChatParticipantRole,
  ChatParticipantsResponse,
  ChatRealtimeEvent,
} from "./types/chat";

// receiver transfer (MOVO-275)
export {
  RECEIVER_TRANSFER_STATUSES,
  RECEIVER_TRANSFER_ALLOWED_SHIPMENT_STATUSES,
} from "./types/receiver-transfer";
export type {
  ReceiverTransferStatus,
  ReceiverTransferCancelReason,
  ReceiverTransferRequest,
  ReceiverTransferInvitation,
  ReceiverTransferInvitationShipment,
  ShipmentReceiverTransferSummary,
} from "./types/receiver-transfer";

// admin: bitácora y conflicto de interés (MOVO-288)
export type {
  AuditOutcome,
  AdminTargetType,
  AuditLogEntry,
  AuditLogPage,
  ShipmentParties,
  InProgressShipment,
  WithdrawOpenActivityResult,
  ChatReportParties,
  UserReportParties,
} from "./types/admin";

// admin: envíos para el panel (MOVO-325, backend de MOVO-33)
export {
  ACTIVE_SHIPMENT_STATUSES,
  ADMIN_SHIPMENT_ALERT_STATUSES,
  ADMIN_SHIPMENT_GROUPS,
  ADMIN_SHIPMENT_GROUP_STATUSES,
  ADMIN_SHIPMENTS_DEFAULT_LIMIT,
  ADMIN_SHIPMENTS_MAX_LIMIT,
  FORCE_STATUS_REASON_MAX_LENGTH,
  FORCE_STATUS_REASON_MIN_LENGTH,
  normalizeConfirmationCode,
  shipmentConfirmationCode,
  STEP_UP_CODE_TTL_SECONDS,
  STEP_UP_TOKEN_TTL_SECONDS,
  ADMIN_TRACKING_POLL_INTERVAL_SECONDS,
  isAdminShipmentAlert,
} from "./types/admin-shipments";
export type {
  AdminShipmentGroup,
  AdminShipmentPartyRef,
  AdminShipmentRow,
  AdminShipmentCounts,
  AdminShipmentPage,
  AdminShipmentEvent,
  ForceShipmentStatusRequest,
  ForceShipmentStatusResponse,
  ChangeShipmentStatusRequest,
  ChangeShipmentStatusResponse,
  ShipmentStatusOption,
  ShipmentStatusBlocked,
  ShipmentStatusOptions,
  StepUpRequest,
  StepUpChallenge,
  StepUpVerifyRequest,
  StepUpToken,
  ShipmentEventKind,
  AdminShipmentPhoto,
  AdminShipmentOffer,
  AdminShipmentPayment,
  AdminShipmentPartyCard,
  AdminBlock,
  AdminShipmentDetail,
  AdminShipmentDetailResponse,
  AdminChatMessage,
  AdminChatReport,
  AdminChatPage,
  AdminTrackingState,
  AdminTrackingReason,
  AdminTrackingPlace,
  AdminTrackingPoint,
  AdminTrackingMetrics,
  AdminShipmentTracking,
} from "./types/admin-shipments";

// admin: cambio forzado de estado de un envío (MOVO-331, ADR-055)
export {
  FORCED_TRANSITION_MATRIX,
  blockedTransitionReason,
  forcedTransitionFriction,
  getForcedTransition,
  getForcedTransitionDetails,
  listForcedTransitionTargets,
} from "./config/forced-transition-matrix";
export type {
  ForcedTransitionCell,
  ForcedTransitionDetails,
  ForcedTransitionKind,
  ForcedTransitionRecipient,
  ForcedTransitionRisk,
  ForcedTransitionService,
} from "./config/forced-transition-matrix";

// admin: búsqueda de usuarios y ficha (MOVO-295, backend MOVO-294)
export {
  ADMIN_USER_MODERATION_LIMIT,
  ADMIN_NOTE_MAX_LENGTH,
  ADMIN_ACTION_REASON_MAX_LENGTH,
} from "./types/admin-users";
export type {
  AdminKycStatus,
  AdminAccountStatus,
  AdminUserRoleName,
  AdminReportReason,
  AdminReportStatus,
  AdminShipmentStatus,
  AdminTripStatus,
  AdminUserRef,
  AdminUserMatch,
  AdminUserListItem,
  AdminUserPage,
  AdminUserProfile,
  AdminKycAttempt,
  AdminKycCard,
  AdminUserMercadoPago,
  AdminUserKyc,
  AdminUserVehicle,
  AdminShipmentRole,
  AdminUserShipment,
  AdminUserShipmentPage,
  AdminUserTrip,
  AdminUserTripPage,
  AdminUserRating,
  AdminUserRatings,
  AdminUserReport,
  AdminUserBlock,
  AdminUserModeration,
  AdminUserSanction,
  AdminUserSanctions,
  AdminLedgerType,
  AdminLedgerStatus,
  AdminUserLedgerEntry,
  AdminUserLedger,
  AdminUserDevice,
  AdminUserDevices,
  AdminUserAuditEntry,
  AdminUserAuditPage,
  AdminSessionsRevokeBody,
  AdminSessionsRevokeResult,
  AdminContactField,
  AdminContactUpdateBody,
  AdminContactUpdateResult,
  AdminLedgerAdjustmentBody,
  AdminLedgerAdjustmentResult,
  AdminUserNote,
  AdminUserNotePage,
  AdminUserNoteBody,
  AdminUserShipmentRow,
  AdminUserShipmentRowPage,
  AdminUserRatingRow,
  AdminUserRatingRowPage,
  AdminUserLedgerRow,
  AdminUserLedgerRowPage,
  AdminUserNames,
} from "./types/admin-users";

// admin: bandeja de soporte (MOVO-323, backend MOVO-321/MOVO-322)
export {
  SUPPORT_STATUSES,
  SUPPORT_PRIORITIES,
  SUPPORT_TOPICS,
  SUPPORT_TAGS,
  SUPPORT_WAIT_ALERT_MINUTES,
  SUPPORT_MESSAGE_MAX_LENGTH,
  SUPPORT_LIST_PAGE_SIZE,
  SUPPORT_MESSAGES_PAGE_SIZE,
  SUPPORT_CODE_RE,
  SUPPORT_ATTACHMENT_TYPES,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_ATTACHMENT_MAX_PER_MESSAGE,
  SUPPORT_ATTACHMENT_MAX_PENDING,
  SUPPORT_ERROR,
  SUPPORT_QUICK_REPLIES,
  SUPPORT_WS_PROTOCOL,
  resolveQuickReply,
} from "./types/admin-support";
export type {
  SupportStatus,
  SupportPriority,
  SupportTopic,
  SupportUserRole,
  SupportTag,
  SupportAttachmentType,
  SupportUserRef,
  SupportAgentRef,
  SupportAgent,
  SupportAttachment,
  SupportUserMessage,
  SupportAgentMessage,
  SupportInternalNote,
  SupportSystemMessage,
  SupportMessage,
  SupportLastMessage,
  SupportShipmentRef,
  SupportConversationRow,
  SupportConversation,
  SupportListPage,
  SupportMessagesPage,
  SupportCounts,
  SupportCountsQuery,
  SupportListQuery,
  SupportSendBody,
  SupportPatchBody,
  SupportAttachmentCreateBody,
  SupportAttachmentCreateResult,
  SupportBadgeTone,
  SupportVerificationBadge,
  SupportUserShipment,
  SupportUserHistoryItem,
  SupportUserContext,
  SupportQuickReply,
  SupportEvent,
  SupportEventsPage,
  SupportRealtimeTicket,
} from "./types/admin-support";

// soporte del lado del usuario (MOVO-320, consumido por MOVO-324)
export {
  SUPPORT_WS_CLOSE,
  SUPPORT_REOPENED_MESSAGE,
  SUPPORT_PUSH_PREVIEW_MAX,
  supportShipmentCode,
  formatSupportCode,
} from "./types/support";
export type {
  SupportDeliveryStatus,
  SupportUserFacingMessage,
  SupportConversationLastMessage,
  SupportConversationItem,
  SupportListResponse,
  SupportMessagesPage as SupportUserMessagesPage,
  SupportCreateBody,
  SupportCreateResult,
  SupportSendUserBody,
  SupportUserAttachmentCreateBody,
  SupportShipmentRole,
  SupportShipmentOption,
  SupportShipmentOptionsPage,
  SupportReadResult,
  SupportRealtimeEvent,
  SupportRealtimeConnected,
} from "./types/support";

// disputas (MOVO-334, ADR-054)
export {
  DisputeReason,
  DisputeStatus,
  USER_SELECTABLE_DISPUTE_REASONS,
  DISPUTE_WINDOW_DAYS,
  DISPUTE_TEXT_MAX_LENGTH,
} from "./types/dispute";
export type {
  DisputePartyRole,
  DisputeStatementKind,
  DisputePhoto,
  DisputeStatement,
  DisputeDetail,
  DisputePhotoUploadUrl,
} from "./types/dispute";
