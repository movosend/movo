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
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ]
  },
  turbopack: { root: path.resolve(process.cwd(), "..") },
}
export default nextConfig
