import type {
  DisputeOutcome,
  DisputePartyRole,
  DisputePaymentAction,
  DisputePhoto,
  DisputeReason,
  DisputeStatement,
  DisputeStatus,
} from "./dispute";
import type { AdminShipmentPhoto } from "./admin-shipments";

/**
 * MOVO-337: disputas para el panel (`/admin/disputes*` de `svc-admin`). `svc-shipments` es el dueño de los
 * datos (`/internal/admin/disputes*`); las notas internas viven en `svc-admin` y nunca llegan a las partes.
 */

export interface AdminDisputeParty {
  id: string;
  name: string | null;
}

/** Cómo quedó resuelta una disputa. Presente desde `resolving` (el resultado se guarda antes de mover la plata). */
export interface AdminDisputeResolution {
  outcome: DisputeOutcome;
  reasoning: string;
  /** Porcentaje del preset elegido; `null` si el admin cargó un monto libre (o no es `partial`). */
  percentage: number | null;
  /** Lo que conserva el transportista; lo que vuelve al emisor es `senderAmountArs`. */
  carrierAmountArs: number;
  senderAmountArs: number;
  paymentAction: DisputePaymentAction;
  resolvedBy: string;
  /** Cuándo se confirmó la acción de pago; `null` mientras la disputa siga `resolving`. */
  resolvedAt: string | null;
}

export interface AdminDisputeRow {
  id: string;
  shipmentId: string;
  /** Código corto del envío (`shipmentConfirmationCode`). */
  shipmentCode: string;
  status: DisputeStatus;
  reason: DisputeReason;
  /** `null`: la abrió el sistema (barrido). */
  openedByRole: DisputePartyRole | null;
  openedAt: string;
  /** Estado del envío cuando se abrió la disputa: define la columna de la matriz de resolución. */
  shipmentStatusAtOpen: string;
  /** Estado actual del envío (`disputed` hasta que se resuelve). */
  shipmentStatus: string;
  sender: AdminDisputeParty;
  carrier: AdminDisputeParty | null;
  receiver: AdminDisputeParty;
  outcome: DisputeOutcome | null;
}

export interface AdminDisputePage {
  items: AdminDisputeRow[];
  nextCursor: string | null;
  /** Conteo por estado con los mismos filtros de búsqueda, sin el filtro `status`. */
  statusCounts: Record<DisputeStatus, number>;
}

/** Expediente de la disputa: apertura, descargos y resolución (primer bloque del detalle). */
export interface AdminDisputeDetail extends AdminDisputeRow {
  description: string;
  photos: DisputePhoto[];
  statements: DisputeStatement[];
  resolution: AdminDisputeResolution | null;
}

/** Fotos de retiro y entrega del envío (bloque del expediente). */
export type AdminDisputePhotos = AdminShipmentPhoto[];

/** Evento del handshake de custodia (retiro o entrega) con la distancia medida entre las partes. */
export interface AdminDisputeHandshakeEvent {
  id: string;
  stage: string;
  actorId: string;
  counterpartyId: string;
  distanceM: number;
  createdAt: string;
}

/** Punto de la traza GPS disponible (la que se guarda con custodia, DD-023). */
export interface AdminDisputeTracePoint {
  lat: number;
  lng: number;
  accuracyM: number;
  capturedAt: string;
  mocked: boolean | null;
}

export interface AdminDisputeTrace {
  /** `false`: no hay traza (nunca hubo retiro, o ya se purgó). */
  available: boolean;
  points: AdminDisputeTracePoint[];
}

export interface AdminDisputeNote {
  id: string;
  disputeId: string;
  adminId: string;
  adminName: string | null;
  body: string;
  createdAt: string;
}

export interface AdminDisputeNotePage {
  items: AdminDisputeNote[];
  nextCursor: string | null;
}

export interface AdminDisputeNoteBody {
  body: string;
}

/**
 * `GET /admin/disputes/:id/resolution-preview`: qué pasaría con cada resultado hoy, con lo que hay en `svc-payments`
 * (hold autorizado o cobro acreditado). Es lo que muestra la pantalla de resolución antes de confirmar.
 */
export interface AdminDisputeResolutionPreview {
  /** Estado del envío al abrirse la disputa: la columna de la matriz. */
  statusAtOpen: "assigned" | "in_transit" | "delivered" | "completed";
  /** Monto en juego: el hold (`in_transit`), lo reembolsable del cobro (`delivered`/`completed`) o el neto del envío (`assigned`). */
  stakeArs: number;
  /** Piso de una captura parcial (`in_transit`): comisión del hold más la de MP. `null` en las demás columnas. */
  minimumPartialArs: number | null;
  outcomes: Array<{
    outcome: DisputeOutcome;
    paymentAction: DisputePaymentAction;
    shipmentStatus: "completed" | "cancelled";
  }>;
  /** Cada porcentaje predefinido con su reparto; `belowMinimum` los deshabilita. */
  presets: Array<{ percentage: number; carrierAmountArs: number; senderAmountArs: number; belowMinimum: boolean }>;
}
