import type {
  AdminShipmentDetail,
  AdminShipmentDetailResponse,
} from "@movo/shared/src/types/admin-shipments"

/** Lo que puede faltar si el backend todavía no tiene la versión que espera el panel. */
type MaybeOld = Omit<AdminShipmentDetailResponse, "shipment" | "offers"> & {
  shipment: Omit<
    AdminShipmentDetail,
    | "requestedPickupDate"
    | "requestedPickupTimeWindowStart"
    | "requestedPickupTimeWindowEnd"
  > &
    Partial<AdminShipmentDetail>
  offers?: AdminShipmentDetailResponse["offers"]
}

/**
 * El panel sale solo a Vercel y puede llegar antes que `svc-admin`/`svc-shipments`. Sin el bloque `offers`, solo
 * esa sección muestra el error (no se cae el detalle entero); sin el retiro pedido se usa el actual, que es el
 * mismo mientras no haya una oferta aceptada.
 */
export function withDeployGaps(
  response: MaybeOld
): AdminShipmentDetailResponse {
  const { shipment } = response
  return {
    ...response,
    shipment: {
      ...shipment,
      requestedPickupDate: shipment.requestedPickupDate ?? shipment.pickupDate,
      requestedPickupTimeWindowStart:
        shipment.requestedPickupTimeWindowStart ??
        shipment.pickupTimeWindowStart,
      requestedPickupTimeWindowEnd:
        shipment.requestedPickupTimeWindowEnd ?? shipment.pickupTimeWindowEnd,
    },
    offers: response.offers ?? {
      data: null,
      error: {
        code: "SHIPMENTS_SERVICE_UNAVAILABLE",
        message: "El servicio todavía no devuelve las ofertas.",
      },
    },
  }
}
