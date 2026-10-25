/**
 * MOVO-334: motivo de una disputa. Los cuatro primeros los elige una de las partes desde la
 * app; `transit_anomaly` (MOVO-278, DD-045) y `pickup_no_show` (MOVO-270, DD-052) los pone
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

/**
 * Estado de una disputa.
 * - `resolving` (MOVO-337, AC7): un admin ya la resolvió (resultado y razonamiento guardados) pero la acción de
 *   pago todavía no se confirmó. No es una resolución: el envío sigue `disputed` y se reintenta con el mismo
 *   resultado. Las partes ya no pueden cargar descargos.
 */
export enum DisputeStatus {
  OPEN = "open",
  RESOLVING = "resolving",
  RESOLVED = "resolved",
}

/** Rol de una parte dentro del envío disputado (no un rol de cuenta). */
export type DisputePartyRole = "sender" | "receiver" | "carrier";

/** `statement`: descargo de una parte que no abrió la disputa. `amendment`: la única
 * ampliación de evidencia de quien la abrió. */
export type DisputeStatementKind = "statement" | "amendment";

/**
 * MOVO-334 (DD-054): días desde el handshake de entrega (`deliveredAt`) en los que se puede
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

/**
 * MOVO-337 (DD-056): a favor de quién se resuelve una disputa. `partial` reparte el cobro entre el emisor
 * y el transportista (porcentaje de un set predefinido, o un monto libre).
 */
export const DISPUTE_OUTCOMES = ["sender", "carrier", "partial"] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

/**
 * MOVO-337: porcentajes predefinidos del resultado `partial`. El porcentaje es lo que **conserva el
 * transportista** del monto en juego (el hold, o el neto del envío en un no-retiro); el resto vuelve al emisor.
 */
export const DISPUTE_PARTIAL_PRESETS: readonly number[] = [25, 50, 75];

/** Largo del razonamiento que escribe el admin al resolver (queda en la disputa y llega a las partes). */
export const DISPUTE_REASONING_MIN_LENGTH = 10;
export const DISPUTE_REASONING_MAX_LENGTH = 2000;

/** Largo de una nota interna del admin sobre una disputa. */
export const DISPUTE_NOTE_MIN_LENGTH = 3;
export const DISPUTE_NOTE_MAX_LENGTH = 2000;

/**
 * Cómo se mueve la plata al resolver (DD-056). Depende del estado del envío al abrirse la disputa:
 * - `release_hold`: libera el hold sin capturar (emisor, `in_transit`).
 * - `capture_hold`: captura total (transportista, `in_transit`).
 * - `capture_partial`: captura parcial del hold (parcial, `in_transit`).
 * - `refund_full` / `refund_partial`: reembolso de lo ya capturado (`delivered`/`completed`).
 * - `ledger_credit`: crédito al transportista en su cuenta corriente (`assigned`: el hold ya se liberó).
 * - `none`: no hay plata que mover (emisor en `assigned`, o transportista en `delivered`/`completed`).
 */
export const DISPUTE_PAYMENT_ACTIONS = [
  "release_hold",
  "capture_hold",
  "capture_partial",
  "refund_full",
  "refund_partial",
  "ledger_credit",
  "none",
] as const;
export type DisputePaymentAction = (typeof DISPUTE_PAYMENT_ACTIONS)[number];

/** Body de `POST /admin/disputes/:id/resolve`. */
export interface ResolveDisputeRequest {
  outcome: DisputeOutcome;
  reasoning: string;
  /** Solo `partial`: uno de `DISPUTE_PARTIAL_PRESETS`. Excluyente con `amountArs`. */
  percentage?: number;
  /** Solo `partial`: monto libre en ARS que conserva el transportista. Excluyente con `percentage`. */
  amountArs?: number;
}

/** Lo que `svc-admin` le manda a `svc-shipments` (agrega quién resuelve). */
export interface InternalResolveDisputeRequest extends ResolveDisputeRequest {
  adminId: string;
  /** Snapshot del nombre del admin para el evento del envío (inmutable aunque la cuenta cambie). */
  adminName: string;
}

export interface ResolveDisputeResponse {
  disputeId: string;
  shipmentId: string;
  outcome: DisputeOutcome;
  reasoning: string;
  /** Monto final que conserva el transportista (`0` si el resultado es a favor del emisor). */
  carrierAmountArs: number;
  /** Monto final que vuelve al emisor (`0` si es a favor del transportista). */
  senderAmountArs: number;
  paymentAction: DisputePaymentAction;
  status: DisputeStatus.RESOLVED;
  /** Estado final del envío tras la resolución. */
  shipmentStatus: "completed" | "cancelled";
  /** `true`: la disputa ya estaba resuelta con estos mismos datos; no se movió plata de nuevo. */
  replayed: boolean;
  resolvedAt: string;
}

/**
 * Piso de una captura parcial: el `application_fee` del hold más el estimado de la comisión de MP. Por debajo
 * `svc-payments` responde `422 CAPTURE_BELOW_APPLICATION_FEE` (MOVO-306); `svc-admin` lo valida antes de llamar
 * y lo manda en `details.minimumArs` para que el panel lo muestre (MOVO-337, AC6).
 */
export interface DisputePartialCaptureFloor {
  minimumArs: number;
  holdAmountArs: number;
}
