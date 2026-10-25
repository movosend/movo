import type { NextConfig } from "next"
import path from "node:path"
const nextConfig: NextConfig = {
  transpilePackages: ["@movo/shared"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Con "same-origin" el navegador no manda Referer a otros orígenes y ArcGIS rechaza (498) la key
          // restringida por referrer del mapa. Cross-origin solo sale el origen, nunca la ruta.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ]
  },
  turbopack: { root: path.resolve(process.cwd(), "..") },
}
export default nextConfig
