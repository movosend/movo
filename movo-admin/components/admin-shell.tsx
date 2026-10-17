"use client"
import Link from "next/link"
import { useActionState } from "react"
import {
  Home,
  Users,
  ShieldCheck,
  Package,
  Flag,
  MessageSquareWarning,
  ChartNoAxesCombined,
  UserCog,
  ScrollText,
  LogOut,
} from "lucide-react"
import { logout } from "@/app/login/actions"
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Brand } from "@/components/brand"
import { ThemeToggle } from "@/components/theme-toggle"
import type { ReactNode, CSSProperties } from "react"
const LIVE_SECTIONS: Record<string, string> = { Admins: "/admins" }
const sections = [
  { label: "Usuarios", icon: Users },
  { label: "KYC", icon: ShieldCheck },
  { label: "Envíos", icon: Package },
  { label: "Reportes", icon: Flag },
  { label: "Disputas", icon: MessageSquareWarning },
  { label: "Métricas", icon: ChartNoAxesCombined },
  { label: "Admins", icon: UserCog },
  { label: "Bitácora", icon: ScrollText },
]
export function AdminShell({
  fullName,
  current = "/",
  children,
}: {
  fullName: string
  current?: "/" | "/admins"
  children: ReactNode
}) {
  const [state, action, pending] = useActionState(logout, {})
  return (
    <SidebarProvider style={{ "--sidebar-width": "240px" } as CSSProperties}>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <Sidebar>
        <SidebarHeader className="h-14 justify-center px-5">
          <Brand />
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label="Secciones del panel">
            <SidebarGroup>
              <SidebarGroupLabel>Panel de administración</SidebarGroupLabel>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={current === "/"}
                    render={
                      <Link
                        href="/"
                        aria-current={current === "/" ? "page" : undefined}
                      />
                    }
                  >
                    <Home />
                    <span>Inicio</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {sections.map(({ label, icon: Icon }) => {
                  const href = LIVE_SECTIONS[label]
                  if (href)
                    return (
                      <SidebarMenuItem key={label}>
                        <SidebarMenuButton
                          isActive={current === href}
                          render={
                            <Link
                              href={href}
                              aria-current={
                                current === href ? "page" : undefined
                              }
                            />
                          }
                        >
                          <Icon />
                          <span>{label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  return (
                    <SidebarMenuItem key={label}>
                      <SidebarMenuButton disabled>
                        <Icon />
                        <span>{label}</span>
                        <span className="ml-auto text-xs">Pronto</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroup>
          </nav>
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center gap-3 p-2">
            <Avatar>
              <AvatarFallback>
                {fullName
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{fullName}</p>
              <p className="text-xs text-muted-foreground">Administrador</p>
            </div>
          </div>
          <form action={action}>
            <Button
              type="submit"
              variant="ghost"
              className="w-full justify-start"
              disabled={pending}
            >
              <LogOut data-icon="inline-start" />
              {pending ? "Cerrando…" : "Cerrar sesión"}
            </Button>
          </form>
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
          <div className="flex items-center gap-3">
            <SidebarTrigger aria-label="Abrir navegación" />
            <span className="text-sm font-medium">
              {current === "/admins" ? "Admins" : "Inicio"}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <Avatar>
              <AvatarFallback>
                {fullName
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")}
              </AvatarFallback>
            </Avatar>
            <span className="max-w-32 truncate text-sm sm:max-w-56">
              {fullName}
            </span>
            <ThemeToggle />
            <form action={action}>
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                aria-label="Cerrar sesión"
                disabled={pending}
              >
                <LogOut />
              </Button>
            </form>
          </div>
        </header>
        <main
          id="contenido"
          className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 md:p-10"
        >
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
