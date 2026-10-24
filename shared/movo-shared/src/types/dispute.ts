/**
 * MOVO-334: motivo de una disputa. Los cuatro primeros los elige una de las partes desde la
 * app; `transit_anomaly` (MOVO-278, ADR-045) y `pickup_no_show` (MOVO-270, ADR-052) los pone
 * solo el barrido del sistema.
 */
export enum DisputeReason {
  DAMAGED = "damaged",
  NOT_DELIVERED = "not_delivered",
  WRONG_DELIVERY = "wrong_delivery",
  OTHER = "other",
  TRANSIT_ANOMALY = "transit_anomaly",
  PICKUP_NO_SHOW = "pickup_no_show",
}

/** Motivos que una parte puede elegir al abrir una disputa desde la app (MOVO-334). */
export const USER_SELECTABLE_DISPUTE_REASONS: readonly DisputeReason[] = [
  DisputeReason.DAMAGED,
  DisputeReason.NOT_DELIVERED,
  DisputeReason.WRONG_DELIVERY,
  DisputeReason.OTHER,
];

/** Estado de una disputa. Los campos de resolución los agrega MOVO-34. */
export enum DisputeStatus {
  OPEN = "open",
  RESOLVED = "resolved",
}

/** Rol de una parte dentro del envío disputado (no un rol de cuenta). */
export type DisputePartyRole = "sender" | "receiver" | "carrier";

/** `statement`: descargo de una parte que no abrió la disputa. `amendment`: la única
 * ampliación de evidencia de quien la abrió. */
export type DisputeStatementKind = "statement" | "amendment";

/**
 * MOVO-334 (ADR-054): días desde el handshake de entrega (`deliveredAt`) en los que se puede
 * abrir una disputa sobre un envío `delivered` o `completed`.
 */
export const DISPUTE_WINDOW_DAYS = 7;

/** Tope de la descripción de la apertura y del texto de cada descargo. */
export const DISPUTE_TEXT_MAX_LENGTH = 2000;

/** Foto de evidencia de una disputa. `url` es una presigned GET de TTL corto (`expiresIn`
 * segundos), mismo criterio que `UserReportPhoto`. */
export interface DisputePhoto {
  id: string;
  url: string;
  expiresIn: number;
}

export interface DisputeStatement {
  id: string;
  authorId: string;
  authorRole: DisputePartyRole;
  kind: DisputeStatementKind;
  text: string;
  photos: DisputePhoto[];
  /** ISO date. */
  createdAt: string;
}

/**
 * Expediente de una disputa para las partes (`GET /disputes/:id`, respuesta de la apertura).
 * Nunca incluye notas internas del admin.
 */
export interface DisputeDetail {
  id: string;
  shipmentId: string;
  /** `null`: la abrió el sistema (barrido). */
  openedBy: string | null;
  openedByRole: DisputePartyRole | null;
  reason: DisputeReason;
  description: string;
  status: DisputeStatus;
  /** ISO date. */
  openedAt: string;
  /** Fotos de la apertura. */
  photos: DisputePhoto[];
  /** Descargos y ampliación, del más viejo al más nuevo. */
  statements: DisputeStatement[];
}

/** Respuesta de `POST /shipments/:id/disputes/photos/presign`. */
export interface DisputePhotoUploadUrl {
  uploadUrl: string;
  s3Key: string;
  expiresIn: number;
}
