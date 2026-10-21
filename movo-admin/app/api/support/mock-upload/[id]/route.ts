import { NextRequest, NextResponse } from "next/server"
import { SUPPORT_ATTACHMENT_MAX_BYTES } from "@movo/shared/src/types/admin-support"
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
  const contentLength = request.headers.get("content-length")
  if (
    contentLength !== null &&
    Number(contentLength) > SUPPORT_ATTACHMENT_MAX_BYTES
  )
    return new NextResponse(null, { status: 413 })
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = request.body?.getReader()
  if (!reader) return new NextResponse(null, { status: 400 })
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > SUPPORT_ATTACHMENT_MAX_BYTES) {
      await reader.cancel()
      return new NextResponse(null, { status: 413 })
    }
    chunks.push(value)
  }
  const bytes = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    size
  )
  const ok = mockStoreUpload(
    id,
    request.headers.get("content-type") ?? "",
    bytes
  )
  return new NextResponse(null, { status: ok ? 200 : 403 })
}
