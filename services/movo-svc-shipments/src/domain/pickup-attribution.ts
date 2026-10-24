import {
  ABSENCE_MIN_DISTANCE_M,
  ARRIVAL_EARLY_MARGIN_MIN,
  ARRIVAL_MAX_ACCURACY_M,
  ARRIVAL_RADIUS_M,
  MIN_ABSENCE_POSITIONS,
  ShipmentStatus,
  TripStatus,
} from "@movo/shared";
import { Shipment } from "../models/shipment";
import { haversineKm } from "./geo";
import { pickupWindowEndInstant, pickupWindowInstant } from "./pickup-window";

/**
 * MOVO-270 (ADR-052): cómo cuenta una posición del transportista como evidencia del retiro de
 * un envío `assigned`:
 * - `arrival`: dentro del radio de llegada (restando la precisión informada);
 * - `far`: claramente en otro lado (más de `ABSENCE_MIN_DISTANCE_M`, también restando la precisión);
 * - `gray`: en el medio -- no prueba ni la llegada ni la ausencia;
 * - `null`: no cuenta para nada (simulada, poco precisa o fuera de [inicio − margen, fin] de la ventana).
 */
export type PickupPositionEvidence = "arrival" | "far" | "gray";

export interface PickupEvidencePosition {
  lat: number;
  lng: number;
  accuracyM: number;
  capturedAt: Date;
  mocked?: boolean;
}

type PickupWindowShipment = Pick<
  Shipment,
  "pickupLat" | "pickupLng" | "pickupDate" | "pickupTimeWindowStart" | "pickupTimeWindowEnd"
>;

/** Ventana en la que una posición cuenta como evidencia del retiro. */
export function pickupEvidenceWindow(shipment: PickupWindowShipment): { from: Date; to: Date } {
  const start = pickupWindowInstant(shipment.pickupDate, shipment.pickupTimeWindowStart);
  return {
    from: new Date(start.getTime() - ARRIVAL_EARLY_MARGIN_MIN * 60 * 1000),
    to: pickupWindowEndInstant(shipment.pickupDate, shipment.pickupTimeWindowEnd),
  };
}

export function classifyPickupPosition(
  shipment: PickupWindowShipment,
  position: PickupEvidencePosition
): PickupPositionEvidence | null {
  if (position.mocked === true) return null;
  if (position.accuracyM > ARRIVAL_MAX_ACCURACY_M) return null;
  const { from, to } = pickupEvidenceWindow(shipment);
  const capturedMs = position.capturedAt.getTime();
  if (capturedMs < from.getTime() || capturedMs > to.getTime()) return null;

  const distanceM = haversineKm(position.lat, position.lng, shipment.pickupLat, shipment.pickupLng) * 1000;
  // La incertidumbre del dispositivo siempre juega a favor del transportista: acerca para la
  // llegada y también acerca para la ausencia (una lectura que podría estar cerca no es "lejos").
  const nearestPossibleM = distanceM - position.accuracyM;
  if (nearestPossibleM <= ARRIVAL_RADIUS_M) return "arrival";
  if (nearestPossibleM > ABSENCE_MIN_DISTANCE_M) return "far";
  return "gray";
}

export interface PickupEvidenceSummary {
  arrivedAt: Date | null;
  farPositionsInWindow: number;
  grayPositionsInWindow: number;
}

export interface PickupMissContext {
  shipmentStatus: ShipmentStatus;
  /** Viaje de la oferta aceptada; `null` si la oferta no quedó asociada a ninguno. */
  trip: { status: TripStatus; startedAt: Date | null } | null;
  evidence: PickupEvidenceSummary | null;
  pickupWindowEnd: Date;
}

/**
 * - `carrier_no_show`: no llegó -- el viaje nunca se inició antes del cierre de la ventana, o su
 *   GPS lo ubicó lejos (≥ `MIN_ABSENCE_POSITIONS` posiciones lejanas, ninguna en zona gris).
 * - `carrier_arrived`: hay llegada registrada y no hubo handshake.
 * - `no_evidence`: cualquier otro caso. La falta de datos nunca prueba que no llegó.
 */
export type PickupMissAttribution = "carrier_no_show" | "carrier_arrived" | "no_evidence";

/** MOVO-270 (AC8-AC10): a quién se le atribuye un retiro no realizado. Función pura. */
export function attributePickupMiss(ctx: PickupMissContext): PickupMissAttribution {
  // Sin hold confirmado el retiro era imposible (MOVO-210): no hay a quién culpar.
  if (ctx.shipmentStatus !== ShipmentStatus.ASSIGNED) return "no_evidence";
  if (ctx.evidence?.arrivedAt) return "carrier_arrived";

  const trip = ctx.trip;
  if (!trip) return "carrier_no_show";
  if (trip.status === TripStatus.DECLARED || trip.status === TripStatus.CANCELLED || trip.status === TripStatus.EXPIRED) {
    return "carrier_no_show";
  }
  // `active`/`completed` con `startedAt` NULL: viaje iniciado antes de MOVO-270, sin saber cuándo.
  if (trip.startedAt && trip.startedAt.getTime() > ctx.pickupWindowEnd.getTime()) return "carrier_no_show";

  const evidence = ctx.evidence;
  if (evidence && evidence.grayPositionsInWindow === 0 && evidence.farPositionsInWindow >= MIN_ABSENCE_POSITIONS) {
    return "carrier_no_show";
  }
  return "no_evidence";
}
