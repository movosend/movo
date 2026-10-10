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
  /** Monto acordado (bruto que paga el emisor). */
  amountArs: number;
  /** Hasta cuándo puede pagar el emisor (ISO 8601). Pasado ese instante el envío vuelve a `published`. */
  payUntil: string;
}

export interface ShipmentFundingRequest {
  /** Token de un solo uso generado con la `public_key` del transportista. */
  cardToken: string;
  /** `visa`, `master`, etc., tal como lo devuelve el formulario de MP junto al token. */
  paymentMethodId?: string;
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
