/**
 * Contratos de la búsqueda de usuarios y la ficha del panel (MOVO-293). Los define MOVO-295
 * (pantallas) y los implementa MOVO-294 (`svc-admin` + endpoints internos): ver la sección
 * "Contratos propuestos por MOVO-295" de esa tarea. Cada sección de la ficha es una ruta
 * `GET /admin/users/:id/<sección>` que consulta a un solo servicio dueño, así que un servicio
 * caído (502) rompe solo su sección.
 *
 * Los enums de dominio se referencian como unión de literales (`${Enum}`) para que el panel no
 * arrastre el valor del enum al bundle.
 */
import type { AccountStatus, KycStatus, ReportReason, ReportStatus, UserRole } from "./user";
import type { ShipmentStatus } from "./shipment";
import type { TripStatus } from "./trip";
import type { AccountSanction, ApplyAccountSanctionRequest, LiftAccountSanctionRequest } from "./account-sanctions";
import type { OpenActivitySummary, WithdrawOpenActivityResult } from "./admin";

export type AdminKycStatus = `${KycStatus}`;
export type AdminAccountStatus = `${AccountStatus}`;
export type AdminUserRoleName = `${UserRole}`;
export type AdminReportReason = `${ReportReason}`;
export type AdminReportStatus = `${ReportStatus}`;
export type AdminShipmentStatus = `${ShipmentStatus}`;
export type AdminTripStatus = `${TripStatus}`;

/** Quién participa de un envío o de un reporte. */
export interface AdminUserRef {
  id: string;
  fullName: string;
}

/** `AdminUserRef` con la foto de perfil (URL pública, DD-016): la contraparte de un reporte o bloqueo se dibuja con avatar. */
export interface AdminUserRefWithPhoto extends AdminUserRef {
  photoUrl: string | null;
}

/** Por qué coincidió un resultado del buscador (`null` sin `q`). Prioridad: nombre, email, DNI, teléfono. */
export type AdminUserMatch = "name" | "email" | "dni" | "phone";

/** `GET /admin/users?q=&page=&pageSize=`. */
export interface AdminUserListItem {
  id: string;
  fullName: string;
  email: string;
  /** E.164. */
  phone: string;
  dni: string | null;
  photoUrl: string | null;
  roles: AdminUserRoleName[];
  /** `suspended` (con `bannedUntil` si es temporal) o `banned` (inhabilitada), MOVO-296. */
  accountStatus: AdminAccountStatus;
  bannedUntil: string | null;
  kycIdentity: AdminKycStatus;
  kycLicense: AdminKycStatus;
  createdAt: string;
  matchedBy: AdminUserMatch | null;
}

export interface AdminUserPage {
  items: AdminUserListItem[];
  page: number;
  pageSize: number;
  total: number;
}

/** `GET /admin/users/:id`. Una cuenta `deleted` también se devuelve. */
export interface AdminUserProfile {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  emailVerified: boolean;
  phone: string;
  phoneVerified: boolean;
  dni: string | null;
  /** `YYYY-MM-DD`. */
  birthdate: string | null;
  photoUrl: string | null;
  createdAt: string;
  deletedAt: string | null;
  roles: { role: AdminUserRoleName; grantedAt: string }[];
  accountStatus: AdminAccountStatus;
  bannedUntil: string | null;
}

export interface AdminKycAttempt {
  status: AdminKycStatus;
  requestedAt: string;
  resolvedAt: string | null;
  /** Motivo legible del resultado, si se pudo derivar del payload redactado. Nunca datos biométricos. */
  reason: string | null;
}

export interface AdminKycCard {
  status: AdminKycStatus;
  lastSessionId: string | null;
  /** Vencimiento de la licencia (solo `license`). */
  expiresAt?: string | null;
  attempts: AdminKycAttempt[];
}

export interface AdminUserMercadoPago {
  /**
   * `revoked`: el transportista revocó el acceso desde MP y tiene que volver a vincular.
   * `expired`: el token venció sin renovarse (falla del refresh de Movo, no del usuario).
   */
  status: "linked" | "not_linked" | "revoked" | "expired";
  nickname: string | null;
  connectedAt: string | null;
  unlinkedAt: string | null;
}

/** `GET /admin/users/:id/kyc`. */
export interface AdminUserKyc {
  identity: AdminKycCard;
  license: AdminKycCard;
  /** `null` si `svc-payments` no respondió: el panel muestra el error solo en esta tarjeta. */
  mercadoPago: AdminUserMercadoPago | null;
}

/** `GET /admin/users/:id/vehicle`. */
export interface AdminUserVehicle {
  vehicle: {
    brand: string;
    model: string;
    licensePlate: string;
    cargoCapacityLabel: string;
  } | null;
}

export type AdminShipmentRole = "sender" | "carrier" | "receiver";

export interface AdminUserShipment {
  id: string;
  /** 8 primeros caracteres del UUID en mayúsculas: no hay otro código de envío. */
  shortId: string;
  status: AdminShipmentStatus;
  pickupAddress: string;
  deliveryAddress: string;
  priceArs: number | null;
  createdAt: string;
  /** Rol de ESTE usuario en el envío. */
  userRole: AdminShipmentRole;
  sender: AdminUserRef;
  carrier: AdminUserRef | null;
  receiver: AdminUserRef;
}

/** `GET /admin/users/:id/shipments?role=&status=&page=&pageSize=`. */
export interface AdminUserShipmentPage {
  items: AdminUserShipment[];
  page: number;
  pageSize: number;
  total: number;
  counts: Record<AdminShipmentRole, number>;
}

export interface AdminUserTrip {
  id: string;
  originAddress: string;
  destinationAddress: string;
  departureAt: string;
  vehicleType: string;
  status: AdminTripStatus;
  recurring: boolean;
}

/** `GET /admin/users/:id/trips?status=&page=&pageSize=`. */
export interface AdminUserTripPage {
  items: AdminUserTrip[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminUserRating {
  score: number;
  comment: string | null;
  rater: AdminUserRef;
  /** Rol de la persona calificada en ese envío. */
  roleOfRated: AdminShipmentRole;
  shipmentId: string;
  createdAt: string;
}

/** `GET /admin/users/:id/ratings?page=&pageSize=`. */
export interface AdminUserRatings {
  average: number | null;
  count: number;
  items: AdminUserRating[];
  page: number;
  pageSize: number;
}

export interface AdminUserReport {
  id: string;
  reason: AdminReportReason;
  status: AdminReportStatus;
  /** Quien reportó (en `received`) o a quien se reportó (en `made`). */
  counterpart: AdminUserRefWithPhoto;
  details: string | null;
  createdAt: string;
  extraEntries: number;
  photos: number;
}

export interface AdminUserBlock {
  user: AdminUserRefWithPhoto;
  createdAt: string;
}

/**
 * `GET /admin/users/:id/moderation`. Cada lista trae a lo sumo las `ADMIN_USER_MODERATION_LIMIT`
 * más recientes; `totals` dice cuántas hay en total para que el panel avise que faltan.
 */
export interface AdminUserModeration {
  reports: { received: AdminUserReport[]; made: AdminUserReport[] };
  blocks: { made: AdminUserBlock[]; received: AdminUserBlock[] };
  totals: { reportsReceived: number; reportsMade: number; blocksMade: number; blocksReceived: number };
}

export const ADMIN_USER_MODERATION_LIMIT = 50;

/**
 * Cómo quedó el último intento de retirar la actividad abierta de una sanción (MOVO-299 AC2).
 * `partial`: `svc-shipments` respondió con `failures`. `failed`: no respondió o rechazó el pedido
 * (puede haber retirado algo igual). En los dos casos la sanción ya está aplicada y el retiro se
 * reintenta (es idempotente).
 */
export type AdminSanctionWithdrawalStatus = "complete" | "partial" | "failed";

export interface AdminSanctionWithdrawal {
  status: AdminSanctionWithdrawalStatus;
  /** Lo retirado en ese intento (vacío si `failed`). */
  result: WithdrawOpenActivityResult | null;
  /** Código del error si `failed`. */
  errorCode: string | null;
  attemptedAt: string;
}

/** Una fila del historial de sanciones de la ficha, con los nombres de los admins resueltos. */
export interface AdminUserSanction extends AccountSanction {
  appliedByName: string | null;
  liftedByName: string | null;
  /**
   * Último intento de retiro registrado en la bitácora para esta sanción. `null` si nunca se
   * intentó (sanciones migradas o aplicadas antes de MOVO-299).
   */
  withdrawal: AdminSanctionWithdrawal | null;
}

/** `GET /admin/users/:id/sanctions`, de la más reciente a la más vieja. */
export interface AdminUserSanctions {
  items: AdminUserSanction[];
}

/** `POST /admin/users/:id/sanctions`: el body de `svc-users` (`type`, `reason`, `internalNote`, `endsAt`). */
export type AdminApplySanctionBody = ApplyAccountSanctionRequest;

/** `POST /admin/users/:id/sanctions/:sanctionId/lift`. */
export type AdminLiftSanctionBody = LiftAccountSanctionRequest;

/**
 * `GET /admin/users/:id/sanctions/preview`: qué pasaría al sancionar hoy, para el texto previo a
 * confirmar (AC6). Es una foto: entre la vista previa y la confirmación algo puede cambiar.
 */
export type AdminSanctionPreview = OpenActivitySummary;

export type AdminLedgerType =
  | "cancellation_penalty"
  | "penalty_capture"
  | "cash_commission"
  | "fee_offset"
  | "payment_surcharge"
  | "voluntary_payment"
  | "manual_adjustment";
export type AdminLedgerStatus = "pending" | "reserved" | "settled" | "voided";

export interface AdminUserLedgerEntry {
  id: string;
  type: AdminLedgerType;
  /** Con signo: positivo es lo que la persona le debe a Movo. */
  amountArs: number;
  status: AdminLedgerStatus;
  shipmentId: string | null;
  reason: string | null;
  adminName: string | null;
  createdAt: string;
}

/** `GET /admin/users/:id/ledger?limit=&cursor=`. */
export interface AdminUserLedger {
  /** Suma de los movimientos no anulados. */
  balanceArs: number;
  items: AdminUserLedgerEntry[];
  nextCursor: string | null;
}

export interface AdminUserDevice {
  id: string;
  platform: "ios" | "android";
  deviceId: string;
  updatedAt: string;
}

/** `GET /admin/users/:id/devices`. Nunca el token de Expo ni la clave pública. */
export interface AdminUserDevices {
  devices: AdminUserDevice[];
  handshakeKey: { registeredAt: string } | null;
}

/** Fila de la bitácora de una persona: la de `GET /admin/audit-log` más el nombre del admin. */
export interface AdminUserAuditEntry {
  id: string;
  adminId: string;
  adminName: string;
  action: string;
  reason: string | null;
  outcome: "succeeded" | "failed" | "unknown";
  errorCode: string | null;
  createdAt: string;
}

/** `GET /admin/users/:id/audit-log?limit=&cursor=`. Acciones de admins sobre este usuario. */
export interface AdminUserAuditPage {
  items: AdminUserAuditEntry[];
  nextCursor: string | null;
}

/**
 * Acciones de soporte sobre la cuenta (sección "Acciones de soporte" de MOVO-294). Cada una es una
 * escritura de `svc-admin`: pasa por `runAdminAction`, exige motivo y deja una fila en la bitácora.
 */
export interface AdminSessionsRevokeBody {
  reason: string;
}

/** `POST /admin/users/:id/sessions/revoke`. */
export interface AdminSessionsRevokeResult {
  revokedRefreshTokens: number;
}

export type AdminContactField = "email" | "phone";

/** `expectedCurrent` es el valor que el admin vio al abrir el diálogo: si cambió, 409 `CONTACT_CHANGED`. */
export interface AdminContactUpdateBody {
  field: AdminContactField;
  newValue: string;
  expectedCurrent: string;
  reason: string;
}

/** `POST /admin/users/:id/contact`. El valor nuevo queda sin verificar. */
export interface AdminContactUpdateResult {
  email: string;
  emailVerified: boolean;
  phone: string;
  phoneVerified: boolean;
  revokedRefreshTokens: number;
}

/** `amountArs` con signo y distinto de cero: positivo es lo que la persona debe. */
export interface AdminLedgerAdjustmentBody {
  amountArs: number;
  reason: string;
  /** UUID que genera el panel al abrir el diálogo: un doble envío no duplica el movimiento. */
  idempotencyKey: string;
}

/** `POST /admin/users/:id/ledger/adjustments`. */
export interface AdminLedgerAdjustmentResult {
  entry: AdminUserLedgerEntry;
  balanceArs: number;
}

export interface AdminUserNote {
  id: string;
  body: string;
  adminId: string;
  adminName: string;
  createdAt: string;
}

/** `GET /admin/users/:id/notes?limit=&cursor=`. */
export interface AdminUserNotePage {
  items: AdminUserNote[];
  nextCursor: string | null;
}

export interface AdminUserNoteBody {
  body: string;
}

/**
 * Contratos INTERNOS (servicio dueño → `svc-admin`). Los servicios dueños solo conocen ids de
 * usuario: `svc-admin` los cambia por nombres con `POST /internal/admin/users/names` de
 * `svc-users` antes de responder al panel con los tipos de arriba.
 */

/** `GET /internal/admin/users/:id/shipments` de `svc-shipments`. */
export interface AdminUserShipmentRow extends Omit<AdminUserShipment, "sender" | "carrier" | "receiver"> {
  senderId: string;
  carrierId: string | null;
  receiverId: string;
}

export interface AdminUserShipmentRowPage extends Omit<AdminUserShipmentPage, "items"> {
  items: AdminUserShipmentRow[];
}

/** `GET /internal/admin/users/:id/ratings` de `svc-shipments`. */
export interface AdminUserRatingRow extends Omit<AdminUserRating, "rater"> {
  raterId: string;
}

export interface AdminUserRatingRowPage extends Omit<AdminUserRatings, "items"> {
  items: AdminUserRatingRow[];
}

/** `GET /internal/payments/admin/users/:id/ledger` de `svc-payments`. */
export interface AdminUserLedgerRow extends Omit<AdminUserLedgerEntry, "adminName"> {
  adminId: string | null;
}

export interface AdminUserLedgerRowPage extends Omit<AdminUserLedger, "items"> {
  items: AdminUserLedgerRow[];
}

/** `POST /internal/admin/users/names` de `svc-users`: los ids que no existen no vuelven. */
export interface AdminUserNames {
  users: AdminUserRef[];
}

/** Tope de caracteres de la nota y del motivo de una acción. */
export const ADMIN_NOTE_MAX_LENGTH = 1000;
export const ADMIN_ACTION_REASON_MAX_LENGTH = 500;
