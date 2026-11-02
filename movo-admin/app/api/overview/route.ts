import { NextRequest, NextResponse } from "next/server"
import {
  ADMIN_OVERVIEW_BLOCKS,
  type AdminOverviewBlockId,
} from "@movo/shared/src/types/admin-reports"
import { getOverview } from "@/lib/reports/api"
import { adminForApi, noStore } from "@/lib/support/session-api"

/** Reintento de una tarjeta de la home (`?blocks=kyc`): pide solo esas bandejas. */
export async function GET(request: NextRequest) {
  const session = await adminForApi(request)
  if (session instanceof NextResponse) return session
  const blocks = (request.nextUrl.searchParams.get("blocks") ?? "")
    .split(",")
    .filter((b): b is AdminOverviewBlockId =>
      ADMIN_OVERVIEW_BLOCKS.includes(b as AdminOverviewBlockId)
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
