"use client"
import Link from "next/link"
import { startTransition, useActionState } from "react"
import { useTheme } from "next-themes"
import {
  Activity,
  BadgeCheck,
  ChevronDown,
  Flag,
  Home,
  LogOut,
  MessagesSquare,
  Moon,
  Package,
  ScrollText,
  ShieldCheck,
  Sun,
  Users,
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
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Brand, BrandMark } from "@/components/brand"
import { UserAvatar } from "@/components/user-avatar"
import { Skeleton } from "@/components/ui/skeleton"
import type { ReactNode, CSSProperties } from "react"

const SOON = [
  { label: "KYC", icon: BadgeCheck },
  { label: "Envíos", icon: Package },
  { label: "Reportes", icon: Flag },
  { label: "Disputas", icon: MessagesSquare },
  { label: "Métricas", icon: Activity },
  { label: "Bitácora", icon: ScrollText },
]
const LIVE = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/admins", label: "Admins", icon: ShieldCheck },
  { href: "/users", label: "Usuarios", icon: Users },
] as const

function ShellTrigger() {
  const { isMobile, open } = useSidebar()
  const label = isMobile
    ? "Abrir navegación"
    : open
      ? "Contraer navegación"
      : "Expandir navegación"
  return <SidebarTrigger aria-label={label} title={`${label} (Ctrl/⌘ + B)`} />
}

/**
 * Sin `fullName` el shell queda en modo carga (avatar y nombre como skeleton): lo usan
 * los `loading.tsx` para mostrar el mismo marco que la pantalla real sin saltos.
 */
export function AdminShell({
  fullName,
  email,
  photoUrl,
  current = "/",
  defaultOpen = true,
  crumb: detailCrumb,
  children,
}: {
  fullName?: string
  email?: string
  photoUrl?: string | null
  current?: "/" | "/admins" | "/users"
  defaultOpen?: boolean
  /** Último tramo del breadcrumb (p. ej. el nombre en la ficha); la sección pasa a ser un link. */
  crumb?: string
  children: ReactNode
}) {
  const [state, action, pending] = useActionState(logout, {})
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === "dark"
  const section = LIVE.find((item) => item.href === current)
  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      style={{ "--sidebar-width": "240px" } as CSSProperties}
    >
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <Sidebar collapsible="icon">
        <SidebarHeader className="h-14 justify-center border-b px-5 py-0 group-data-[collapsible=icon]:px-0">
          <Link
            href="/"
            aria-label="Ir al inicio"
            className="flex h-full items-center group-data-[collapsible=icon]:justify-center"
          >
            <span className="flex items-center group-data-[collapsible=icon]:hidden">
              <Brand />
            </span>
            <span className="hidden items-center group-data-[collapsible=icon]:flex">
              <BrandMark />
            </span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <nav
            aria-label="Secciones del panel"
            className="flex flex-col gap-0.5 p-3 group-data-[collapsible=icon]:px-2"
          >
            <SidebarMenu>
              {LIVE.map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    className="h-9 px-2.5 text-fg2 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center"
                    isActive={current === href}
                    tooltip={label}
                    render={
                      <Link
                        href={href}
                        aria-current={current === href ? "page" : undefined}
                      />
                    }
                  >
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
            <SidebarGroup className="p-0 pt-5">
              <SidebarGroupLabel className="h-auto px-2.5 pb-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                Próximamente
              </SidebarGroupLabel>
              <SidebarMenu>
                {SOON.map(({ label, icon: Icon }) => (
                  <SidebarMenuItem key={label}>
                    <div
                      aria-disabled="true"
                      title="Llega en una próxima versión"
                      className="flex h-9 cursor-not-allowed items-center gap-2.5 rounded-md px-2.5 text-sm text-fg-disabled select-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 [&_svg]:size-4"
                    >
                      <Icon />
                      <span className="group-data-[collapsible=icon]:hidden">
                        {label}
                      </span>
                    </div>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </nav>
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="bg-background">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-card px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2 text-sm text-fg2">
            <ShellTrigger />
            <span>Panel</span>
            <span className="text-muted-foreground">/</span>
            {detailCrumb && section ? (
              <>
                <Link
                  href={section.href}
                  className="hover:text-foreground"
                >
                  {section.label}
                </Link>
                <span className="text-muted-foreground">/</span>
                <span className="truncate font-medium text-foreground">
                  {detailCrumb}
                </span>
              </>
            ) : (
              <span className="truncate font-medium text-foreground">
                {section?.label ?? "Inicio"}
              </span>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex h-11 items-center gap-2.5 rounded-lg py-0 pr-2 pl-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Menú de la cuenta"
            >
              {fullName ? (
                <UserAvatar name={fullName} photoUrl={photoUrl} />
              ) : (
                <Skeleton className="size-8 rounded-full" />
              )}
              <span className="hidden min-w-0 flex-col leading-tight md:flex">
                {fullName ? (
                  <span className="truncate text-[13px] font-medium">
                    {fullName}
                  </span>
                ) : (
                  <Skeleton className="my-0.5 h-3.5 w-24" />
                )}
                <span className="text-xs text-muted-foreground">
                  Administrador
                </span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <div className="flex flex-col gap-0.5 px-2.5 pt-2 pb-2.5">
                <span className="text-[13px] font-medium">{fullName}</span>
                {email && (
                  <span className="truncate text-xs text-muted-foreground">
                    {email}
                  </span>
                )}
                <span className="pt-1.5 text-xs leading-snug text-muted-foreground">
                  Por seguridad, la sesión del panel dura 8 horas.
                </span>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setTheme(dark ? "light" : "dark")}
              >
                {dark ? <Sun /> : <Moon />}
                {dark ? "Tema claro" : "Tema oscuro"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={pending}
                onClick={() => startTransition(() => action())}
              >
                <LogOut />
                {pending ? "Cerrando…" : "Cerrar sesión"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        {state.error && (
          <Alert variant="destructive" className="m-4 w-auto">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        <main id="contenido" className="w-full flex-1 overflow-auto">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
