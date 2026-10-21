import { NextRequest, NextResponse } from "next/server"
import { mockEnabled, mockReadUpload } from "@/lib/support/mock"
import { adminForApi } from "@/lib/support/session-api"

/** Imagen de un adjunto en el modo fixtures: lo subido, o una "foto" generada para los de ejemplo. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!mockEnabled()) return new NextResponse(null, { status: 404 })
  const session = await adminForApi(request)
  if (session instanceof NextResponse) return session
  const { id } = await params
  const upload = mockReadUpload(id)
  if (upload)
    return new NextResponse(new Uint8Array(upload.bytes), {
      headers: {
        "Content-Type": upload.contentType,
        "Cache-Control": "private, max-age=60",
      },
    })
  const odd = /-(\d+)$/.test(id) && Number(id.match(/-(\d+)$/)?.[1]) % 2 === 1
  const [w, h] = odd ? [480, 640] : [640, 480]
  const hue = [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 7)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 30% 78%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 26% 58%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect x="${w * 0.22}" y="${h * 0.3}" width="${w * 0.56}" height="${h * 0.4}" rx="10" fill="rgba(255,255,255,.55)"/><path d="M${w * 0.22} ${h * 0.7} l${w * 0.18} -${h * 0.2} l${w * 0.14} ${h * 0.12} l${w * 0.12} -${h * 0.1} l${w * 0.12} ${h * 0.18} z" fill="rgba(0,0,0,.18)"/></svg>`
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "private, max-age=300",
    },
  })
}
