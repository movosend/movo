import { HandshakeStage } from "../generated/prisma/client";
import { InvalidEnumValueError } from "./shipment";

export { HandshakeStage };

/**
 * Modelo de dominio de un evento de handshake CONFIRMADO (MOVO-158 AC3) -- fila
 * inmutable de `shipments.handshake_events`. `actorId` es quien confirmó (llamó a
 * `/confirm`, el receptor de la custodia); `counterpartyId` es quien generó el QR (el
 * cedente, llamó a `/generate`).
 */
export interface HandshakeEvent {
  id: string;
  shipmentId: string;
  stage: HandshakeStage;
  actorId: string;
  counterpartyId: string;
  nonceHash: string;
  counterpartyLat: number;
  counterpartyLng: number;
  actorLat: number;
  actorLng: number;
  distanceM: number;
  createdAt: Date;
}

const HANDSHAKE_STAGE_VALUES: ReadonlySet<string> = new Set(Object.values(HandshakeStage));

/** Mismo patrón que `parseShipmentStatus`/`parseOfferStatus`/`parseRatingRole`. */
export function parseHandshakeStage(value: string, column = "stage"): HandshakeStage {
  if (!HANDSHAKE_STAGE_VALUES.has(value)) {
    throw new InvalidEnumValueError(column, value);
  }
  return value as HandshakeStage;
}
