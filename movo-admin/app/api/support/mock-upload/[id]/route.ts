import { NextRequest, NextResponse } from "next/server"
import { mockEnabled, mockStoreUpload } from "@/lib/support/mock"
import { adminForApi } from "@/lib/support/session-api"

/** Hace de S3 en el modo fixtures: recibe el PUT del `uploadUrl` presignado (MOVO-321 AC1). */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!mockEnabled()) return new NextResponse(null, { status: 404 })
  const session = await adminForApi(request)
  if (session instanceof NextResponse) return session
  const { id } = await params
  const bytes = Buffer.from(await request.arrayBuffer())
  const ok = mockStoreUpload(id, request.headers.get("content-type") ?? "", bytes)
  return new NextResponse(null, { status: ok ? 200 : 403 })
}
