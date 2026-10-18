import type { HoldFailureReason } from "./hold";
import type { ShipmentStatus } from "./shipment";

/**
 * MOVO-210: contrato de la saga de asignación entre `movo-mobile` y `movo-svc-shipments`
 * (`GET`/`POST /shipments/:id/funding`) y el aviso interno de `svc-payments` cuando MP
 * cancela o vence un hold (MOVO-268). Montos en ARS con 2 decimales.
 */

/**
 * Ruta de la saga según la anticipación del retiro (MOVO-12):
 * - `near`: retiro dentro de N días, el emisor paga en el mismo flujo en que acepta.
 * - `far`: retiro a más de N días, el pago se confirma en una ventana que abre al entrar en N.
 */
export type FundingRoute = "near" | "far";

export interface ShipmentFundingResponse {
  shipmentId: string;
  route: FundingRoute;
  /** `public_key` del transportista: con ella el mobile tokeniza la tarjeta. */
  carrierPublicKey: string;
  /** Lo que paga el emisor (= `totalArs`). */
  amountArs: number;
  /** MOVO-311: precio acordado del envío. */
  priceArs: number;
  /**
   * MOVO-311: deuda de la cuenta corriente del emisor que se suma a este pago (con el tope por envío; lo
   * que no entra queda para la próxima operación). 0 si no debe.
   */
  pendingBalanceArs: number;
  /** MOVO-311: `priceArs` + `pendingBalanceArs`. */
  totalArs: number;
  /** Hasta cuándo puede pagar el emisor (ISO 8601). Pasado ese instante el envío vuelve a `published`. */
  payUntil: string;
}

export interface ShipmentFundingRequest {
  /** Token de un solo uso generado con la `public_key` del transportista. */
  cardToken: string;
  /**
   * MOVO-282 (ADR-039): id de la tarjeta guardada (`GET /payments/cards`) con la que se generó el
   * token (`card_id` + CVV). El `cardToken` sigue siendo obligatorio. Sin este campo, el camino de
   * siempre (tarjeta completa).
   */
  savedCardId?: string;
  /** `visa`, `master`, etc., tal como lo devuelve el formulario de MP junto al token. */
  paymentMethodId?: string;
  /**
   * MOVO-311: el `totalArs` que el emisor vio en `GET /shipments/:id/funding`. Si su deuda cambió y el total
   * ya no coincide, 409 `HOLD_AMOUNT_CHANGED` (con `details.totalArs`) en vez de cobrar distinto de lo confirmado.
   */
  expectedTotalArs?: number;
}

/**
 * Resultado de `POST /shipments/:id/funding`. Un rechazo de la tarjeta NO es un error HTTP:
 * responde 200 con `funded: false` y el motivo, y el envío conserva su estado (el emisor
 * reintenta con otra tarjeta mientras no venza el plazo).
 */
export interface ShipmentFundingResult {
  shipmentId: string;
  funded: boolean;
  /** Estado del envío después del intento (`assigned` si se reservó). */
  shipmentStatus: ShipmentStatus;
  failureReason: HoldFailureReason | null;
  payUntil: string | null;
}

/** MOVO-210/MOVO-268: `svc-payments` avisa que MP canceló o venció un hold del envío. */
export type HoldProviderEventKind = "cancelled" | "expired" | "rejected";

export interface HoldProviderEventRequest {
  holdId: string;
  event: HoldProviderEventKind;
  /** Detalle crudo de MP, solo para el motivo en `shipment_events`. */
  statusDetail?: string | null;
}

/**
 * MOVO-211: estado de la reserva de fondos que ve cada parte en el detalle del envío
 * (`GET /shipments/:id` → `funding`). Lo calcula `svc-shipments` por rol, así el mobile
 * solo mapea la fase a una card y no reimplementa N días ni los plazos de la saga.
 * El receptor recibe `null` (AC3); el transportista nunca ve montos, tarjeta ni motivos
 * de rechazo del emisor (AC2).
 */

/** Tarjeta del último intento: marca de MP (`visa`, `master`, ...) y últimos 4 dígitos. */
export interface FundingCard {
  brand: string;
  lastFour: string;
}

/**
 * Último intento de reserva del emisor:
 * - `none`: no hay intento, o quedó en `creating` sin respuesta (pago sin terminar).
 * - `in_process`: MP lo dejó en revisión.
 * - `rejected`: MP no lo autorizó (`failureReason` dice por qué).
 */
export type FundingAttempt = "none" | "in_process" | "rejected";

/**
 * Por qué un envío asignado volvió a `published`:
 * - `payment_timeout`: ruta cercana, el emisor no completó el pago en el plazo.
 * - `window_expired`: ruta lejana, venció la ventana de confirmación (T-24h del retiro).
 */
export type FundingLapseReason = "payment_timeout" | "window_expired";

export type SenderFundingView =
  /** `assigned_unfunded` con la ventana todavía cerrada: no hay nada que hacer hasta `windowOpensAt`. */
  | { viewer: "sender"; phase: "awaiting_window"; windowOpensAt: string; payUntil: string; amountArs: number }
  /** `assignment_pending`, o `assigned_unfunded` con la ventana abierta: el emisor tiene que pagar. */
  | {
      viewer: "sender";
      phase: "payment_due";
      route: FundingRoute;
      payUntil: string;
      amountArs: number;
      /** `null` si `svc-payments` no respondió: la card muestra el estado genérico. */
      lastAttempt: FundingAttempt | null;
      failureReason: HoldFailureReason | null;
      card: FundingCard | null;
      /** La reserva confirmada se perdió (`assigned → assigned_unfunded`) y hay que reconfirmarla. */
      holdLost: boolean;
    }
  /** `assigned`, `in_transit` o `delivered`: fondos retenidos, todavía sin cobrar. */
  | { viewer: "sender"; phase: "held"; amountArs: number; card: FundingCard | null }
  /** `completed`: la reserva se cobró al entregar (MOVO-212). */
  | { viewer: "sender"; phase: "captured"; amountArs: number; at: string }
  /** `cancelled` con una reserva que llegó a autorizarse y se liberó. */
  | { viewer: "sender"; phase: "released"; amountArs: number }
  /** `published` después de que la asignación se cayera por falta de pago. */
  | { viewer: "sender"; phase: "lapsed"; reason: FundingLapseReason; at: string };

export type CarrierFundingView =
  | { viewer: "carrier"; phase: "sender_payment_pending"; payUntil: string }
  | { viewer: "carrier"; phase: "held" }
  /** Transportista cuya asignación se cayó (oferta `assignment_lapsed`, AC6). */
  | { viewer: "former_carrier"; phase: "lapsed"; reason: FundingLapseReason; at: string };

export type ShipmentFundingView = SenderFundingView | CarrierFundingView;

/** MOVO-211 AC4: desenlace de aceptar una oferta, para elegir el mensaje de éxito. */
export interface OfferAcceptanceAssignment {
  /** `assignment_pending` (ruta cercana) o `assigned_unfunded` (ruta lejana). */
  shipmentStatus: ShipmentStatus;
  fundingRoute: FundingRoute;
  /** Ruta lejana: cuándo se abre la ventana para confirmar el pago. `null` en la cercana. */
  fundingWindowOpensAt: string | null;
}
