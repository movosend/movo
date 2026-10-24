import { NextRequest, NextResponse } from "next/server"
import { ApiError } from "@movo/shared/src/errors/api-error"
import { getShipmentTracking } from "@/lib/shipments/tracking/api"
import { adminForApi, noStore } from "@/lib/support/session-api"

/**
 * Seguimiento de un envío para el navegador (polling del mapa, MOVO-328). Un Route Handler y no
 * una Server Action: Next ejecuta las acciones de a una y el polling bloquearía las demás.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await adminForApi(request)
  if (session instanceof NextResponse) return session
  const { id } = await params
  if (!UUID.test(id))
    return NextResponse.json(
      { error: "invalid" },
      { status: 400, headers: noStore }
    )
  try {
    return NextResponse.json(await getShipmentTracking(id), {
      headers: noStore,
    })
  } catch (error) {
    const status = error instanceof ApiError ? error.statusCode : 503
    const code = error instanceof ApiError ? error.code : "INTERNAL_ERROR"
    return NextResponse.json({ error: code }, { status, headers: noStore })
  }
}
