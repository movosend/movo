/**
 * MOVO-202: posición GPS del transportista durante un envío `in_transit`, tal como
 * queda persistida en `shipments.carrier_positions` (append-only, AC9).
 */
export interface CarrierPosition {
  id: string;
  shipmentId: string;
  lat: number;
  lng: number;
  accuracyM: number;
  /** Timestamp del DISPOSITIVO al capturar la posición (AC1). */
  capturedAt: Date;
  /** Timestamp del SERVIDOR al persistirla -- ancla real de cadencia/retención. */
  recordedAt: Date;
}

export interface CreateCarrierPositionInput {
  shipmentId: string;
  lat: number;
  lng: number;
  accuracyM: number;
  capturedAt: Date;
}

/**
 * MOVO-202/AC3: última posición conocida de un envío, cacheada en Redis -- se
 * actualiza con CADA reporte recibido (no solo los que se persisten en Postgres,
 * AC4), para que un suscriptor que recién conecta la reciba sin tocar Postgres.
 * Timestamps como ISO string: es tal cual se guarda/lee del hash de Redis y tal cual
 * viaja en el mensaje del canal de tiempo real (AC5).
 */
export interface LastKnownCarrierPosition {
  lat: number;
  lng: number;
  accuracyM: number;
  capturedAt: string;
  recordedAt: string;
}
