import Link from "next/link"
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Flag,
  MessagesSquare,
  Package,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react"
import { requireAdmin } from "@/lib/auth/session"
import { sidebarDefaultOpen } from "@/lib/sidebar"
import { AdminShell } from "@/components/admin-shell"

const SOON = [
  { label: "Usuarios", desc: "Cuentas y perfiles de la red", icon: Users },
  { label: "KYC", desc: "Verificaciones de identidad", icon: BadgeCheck },
  { label: "Envíos", desc: "Paquetes en curso y entregados", icon: Package },
  { label: "Reportes", desc: "Denuncias entre usuarios", icon: Flag },
  { label: "Disputas", desc: "Reclamos sobre envíos", icon: MessagesSquare },
  { label: "Métricas", desc: "Actividad de la plataforma", icon: Activity },
  {
    label: "Bitácora",
    desc: "Registro de acciones de admins",
    icon: ScrollText,
  },
]

export default async function Page() {
  const profile = await requireAdmin()
  return (
    <AdminShell
      fullName={profile.fullName}
      email={profile.email}
      photoUrl={profile.photoUrl}
      defaultOpen={await sidebarDefaultOpen()}
    >
      <div className="mx-auto flex max-w-[1080px] flex-col gap-8 px-5 pt-8 pb-16 md:px-8 md:pt-10">
        <section className="relative overflow-hidden rounded-[14px] border bg-card p-6 md:p-8">
          <div
            aria-hidden
            className="mv-halftone pointer-events-none absolute inset-0"
          />
          <div className="relative flex max-w-[560px] flex-col gap-2">
            <span className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-fg2 uppercase">
              <span className="mv-pulse-dot size-2 rounded-full" />
              Sesión activa
            </span>
            <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">
              Hola, {profile.fullName.split(" ")[0]}.
            </h1>
            <p className="text-[15px] leading-relaxed text-pretty text-fg2">
              Desde acá vas a monitorear la red y resolver problemas. Por ahora
              podés gestionar quién tiene acceso al panel; el resto de las
              secciones llega en las próximas versiones.
            </p>
          </div>
        </section>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          <Link
            href="/admins"
            className="flex flex-col gap-4 rounded-[10px] border border-border-strong bg-card p-5 transition-shadow hover:shadow-[var(--shadow-3)]"
          >
            <div className="flex items-center justify-between">
              <span className="flex size-9 items-center justify-center rounded-lg bg-lime text-[#0a0a0b]">
                <ShieldCheck className="size-[18px]" />
              </span>
              <ArrowRight className="size-4 text-fg2" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[15px] font-semibold">Admins</span>
              <span className="text-[13px] text-fg2">
                Quién puede entrar al panel
              </span>
            </div>
          </Link>
          {SOON.map(({ label, desc, icon: Icon }) => (
            <div
              key={label}
              aria-disabled="true"
              className="flex cursor-not-allowed flex-col gap-4 rounded-[10px] border border-dashed border-border-strong p-5 text-fg-disabled"
            >
              <div className="flex items-center justify-between">
                <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
                  <Icon className="size-[18px]" />
                </span>
                <span className="rounded-full bg-muted px-2 py-[3px] text-[11px] font-medium text-muted-foreground">
                  Próximamente
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[15px] font-semibold text-fg2">
                  {label}
                </span>
                <span className="text-[13px] text-muted-foreground">
                  {desc}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  )
}
