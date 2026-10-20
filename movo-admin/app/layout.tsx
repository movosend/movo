import type { Metadata } from "next"
import localFont from "next/font/local"

import { TooltipProvider } from "@/components/ui/tooltip"
import "./globals.css"
import { SupportProvider } from "@/components/support/support-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

const inter = localFont({
  src: "../public/fonts/inter.ttf",
  variable: "--font-inter",
  display: "swap",
})

export const metadata: Metadata = {
  title: { default: "Movo Admin", template: "%s · Movo Admin" },
  description: "Panel de administración de Movo",
  icons: {
    icon: [
      {
        url: "/brand/favicon-light.png",
        type: "image/png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/brand/favicon-dark.png",
        type: "image/png",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    apple: "/brand/favicon-light.png",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={cn("antialiased", "font-sans", inter.variable)}
    >
      <body>
        <ThemeProvider>
          <TooltipProvider>
            <SupportProvider>{children}</SupportProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
