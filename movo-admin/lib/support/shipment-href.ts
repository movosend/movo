/**
 * Destino del detalle de un envío en el panel. Hoy no hay pantalla de envíos (MOVO-33, prototipo
 * `Movo Admin Envios.dc.html`), así que devuelve `null` y la bandeja muestra solo el código. Es el
 * único lugar a completar cuando exista: `return `/shipments/${id}``.
 */
export const shipmentHref = (shipmentId: string): string | null => {
  void shipmentId
  return null
}
