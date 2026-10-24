/**
 * Destino del detalle de un envío en el panel (MOVO-326). Sigue tipado como `string | null` para que
 * los llamadores conserven el caso "sin link" si algún día un envío no se puede abrir.
 */
export const shipmentHref = (shipmentId: string): string | null =>
  `/shipments/${shipmentId}`
