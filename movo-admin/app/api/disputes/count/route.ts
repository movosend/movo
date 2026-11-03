import { NextRequest, NextResponse } from "next/server"
import { openDisputeCount } from "@/lib/disputes/api"
import { adminForApi, noStore } from "@/lib/support/session-api"

/**
 * Disputas abiertas para el menú lateral. Una lectura por carga de página (sin tiempo real): el
 * número es un aviso, no un contador de trabajo.
 */
export async function GET(request: NextRequest) {
  const session = await adminForApi(request)
  if (session instanceof NextResponse) return session
  const open = await openDisputeCount()
  if (open === null)
    return NextResponse.json(
      { error: "unavailable" },
      { status: 503, headers: noStore }
    )
  return NextResponse.json({ open }, { headers: noStore })
}
