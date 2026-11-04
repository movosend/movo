import { NextRequest, NextResponse } from "next/server"
import {
  ADMIN_OVERVIEW_BLOCKS,
  type AdminOverviewBlockName,
} from "@movo/shared/src/types/admin-reports"
import { getOverview } from "@/lib/reports/api"
import { adminForApi, noStore } from "@/lib/support/session-api"

/** Reintento de una tarjeta de la home (`?blocks=kyc`): pide solo esas bandejas. */
export async function GET(request: NextRequest) {
  const session = await adminForApi(request)
  if (session instanceof NextResponse) return session
  const blocks = (request.nextUrl.searchParams.get("blocks") ?? "")
    .split(",")
    .filter((b): b is AdminOverviewBlockName =>
      ADMIN_OVERVIEW_BLOCKS.includes(b as AdminOverviewBlockName)
    )
  // Ningún id válido no es "todas": `getOverview([])` pediría las ocho bandejas.
  if (blocks.length === 0)
    return NextResponse.json(
      { error: "invalid_blocks" },
      { status: 400, headers: noStore }
    )
  try {
    return NextResponse.json(await getOverview(blocks), { headers: noStore })
  } catch {
    return NextResponse.json(
      { error: "unavailable" },
      { status: 503, headers: noStore }
    )
  }
}
