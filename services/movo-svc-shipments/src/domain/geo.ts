const EARTH_RADIUS_KM = 6371;

/** MOVO-158 AC4: retiro/entrega capturados a más de esta distancia entre sí
 * durante el handshake rechazan la confirmación (422 HANDSHAKE_DISTANCE_EXCEEDED). */
export const HANDSHAKE_MAX_DISTANCE_METERS = 100;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Distancia Haversine en km entre dos coordenadas. Extraída de
 * `shipments.service.ts` (MOVO-126, validación de umbral retiro/entrega) para que
 * MOVO-158 (validación de proximidad GPS del handshake, mismo tipo de cálculo) la
 * reuse en vez de duplicarla una tercera vez -- sin cambio de comportamiento.
 */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
