import type { AdminShipmentTracking } from "./types"

/** Lectura del seguimiento desde el navegador, por `app/api/shipments/[id]/tracking`. */
export class TrackingFetchError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code)
  }
}

export async function fetchTracking(
  shipmentId: string,
  signal?: AbortSignal
): Promise<AdminShipmentTracking> {
  const response = await fetch(
    `/api/shipments/${encodeURIComponent(shipmentId)}/tracking`,
    { cache: "no-store", credentials: "same-origin", signal }
  )
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new TrackingFetchError(
      response.status,
      body?.error ?? "INTERNAL_ERROR"
    )
  }
  return response.json() as Promise<AdminShipmentTracking>
}
