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
  /** `banned` con `bannedUntil` es una suspensión; sin fecha, un baneo permanente. */
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
  status: "linked" | "not_linked" | "revoked";
  nickname: string | null;
  connectedAt: string | null;
  unlinkedAt: string | null;
}

/** `GET /admin/users/:id/kyc`. */
export interface AdminUserKyc {
  identity: AdminKycCard;
  license: AdminKycCard;
  /** `svc-payments` responde aparte: si falla, el panel muestra el error solo en esta tarjeta. */
  mercadoPago: AdminUserMercadoPago;
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
  counterpart: AdminUserRef;
  details: string | null;
  createdAt: string;
  extraEntries: number;
  photos: number;
}

export interface AdminUserBlock {
  user: AdminUserRef;
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

export interface AdminUserSanction {
  type: "temporary" | "permanent";
  days?: number;
  reason: string;
  adminId: string;
  adminName: string;
  createdAt: string;
  status: "active" | "lifted";
  liftedAt?: string;
  liftedBy?: string;
}

/** `GET /admin/users/:id/suspensions`. Vacío hasta MOVO-36. */
export interface AdminUserSanctions {
  items: AdminUserSanction[];
}

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
