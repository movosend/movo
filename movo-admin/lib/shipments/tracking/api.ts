import "server-only"
import { cookies } from "next/headers"
import { gateway } from "@/lib/auth/api"
import { ACCESS_COOKIE } from "@/lib/auth/policy"
import { mockEnabled, mockTracking } from "./mock"
import type { AdminShipmentTracking } from "./types"

/** Seguimiento de un envío (MOVO-327, vía `svc-admin`). Con `MOVO_ADMIN_MOCK=1` cae al mock. */
export async function getShipmentTracking(
  id: string
): Promise<AdminShipmentTracking> {
  if (mockEnabled()) return mockTracking(id)
  return gateway(`/admin/shipments/${encodeURIComponent(id)}/tracking`, {
    accessToken: (await cookies()).get(ACCESS_COOKIE)?.value,
  })
}
