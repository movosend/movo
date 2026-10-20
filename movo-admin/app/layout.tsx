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
