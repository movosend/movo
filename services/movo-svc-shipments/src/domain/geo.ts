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

/**
 * MOVO-179: port a JS de `haversineSegmentDistanceKm` (`shipment-repository.ts`,
 * MOVO-142/50) -- distancia perpendicular en km de un punto al segmento
 * origen->destino, con clamp a los extremos. Misma fórmula (proyección
 * equirrectangular centrada en el punto medio del segmento), reescrita en JS en vez
 * de SQL porque el matching inverso de MOVO-179 (dado un envío, encontrar viajes
 * `active` cuyo corredor lo contiene) filtra en memoria, no con `$queryRaw` -- el
 * segmento cambia por cada `Trip` candidato, a diferencia del matching directo donde
 * el segmento es fijo (el viaje del caller) y solo la columna varía por fila.
 */
export function distanceToSegmentKm(
  pointLat: number,
  pointLng: number,
  segStartLat: number,
  segStartLng: number,
  segEndLat: number,
  segEndLng: number
): number {
  const midLatRad = toRadians((segStartLat + segEndLat) / 2);
  const kx = 111.32 * Math.cos(midLatRad);
  const ky = 110.574;
  const bx = (segEndLng - segStartLng) * kx;
  const by = (segEndLat - segStartLat) * ky;
  const ab2 = bx * bx + by * by;

  const px = (pointLng - segStartLng) * kx;
  const py = (pointLat - segStartLat) * ky;

  if (ab2 === 0) {
    // Origen y destino del viaje coinciden (trayecto degenerado) -- distancia punto a
    // punto contra el origen, mismo caso límite que `haversineSegmentDistanceKm`.
    return Math.sqrt(px * px + py * py);
  }

  const t = Math.max(0, Math.min(1, (px * bx + py * by) / ab2));
  const projX = px - t * bx;
  const projY = py - t * by;
  return Math.sqrt(projX * projX + projY * projY);
}
