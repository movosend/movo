import {
  Cake,
  CalendarDays,
  Car,
  Fingerprint,
  IdCard,
  Mail,
  PackageOpen,
  Phone,
  ShieldCheck,
  UserRound,
} from "lucide-react"
import type { AdminUserProfile } from "@movo/shared/src/types/admin-users"
import { ageFrom, formatDate, ROLE_LABEL } from "@/lib/users/format"
import { ReportSection } from "../ficha-status"
import { SectionShell } from "../ui"
import { cn } from "@/lib/utils"

const ROLE_ICON = { sender: PackageOpen, carrier: Car, admin: ShieldCheck }

function Fact({
  icon: Icon,
  label,
  value,
  mono,
  tag,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  mono?: boolean
  tag?: { label: string; ok: boolean }
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-[13px]" />
        {label}
      </span>
      <span
        className={cn(
          "flex flex-wrap items-center gap-2 text-sm [overflow-wrap:anywhere]",
          mono && "font-mono"
        )}
      >
        {value}
        {tag && (
          <span
            className={cn(
              "inline-flex h-5 items-center rounded-full px-2 font-sans text-[11px] font-medium",
              tag.ok
                ? "bg-success-soft text-success-fg"
                : "bg-warn-soft text-warn-fg"
            )}
          >
            {tag.label}
          </span>
        )}
      </span>
    </div>
  )
}

/** Datos personales y roles. Viene del perfil que ya cargó la página: no tiene estado de carga propio. */
export function ProfileSection({ profile }: { profile: AdminUserProfile }) {
  return (
    <SectionShell id="perfil">
      <ReportSection id="perfil" status="ready" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-6 gap-y-[18px] p-[18px]">
        <Fact icon={UserRound} label="Nombre" value={profile.fullName} />
        <Fact
          icon={Mail}
          label="Email"
          value={profile.email}
          tag={{
            label: profile.emailVerified ? "Verificado" : "Sin verificar",
            ok: profile.emailVerified,
          }}
        />
        <Fact
          icon={Phone}
          label="Teléfono"
          value={profile.phone}
          mono
          tag={{
            label: profile.phoneVerified ? "Verificado" : "Sin verificar",
            ok: profile.phoneVerified,
          }}
        />
        <Fact icon={IdCard} label="DNI" value={profile.dni ?? "—"} mono />
        <Fact
          icon={Cake}
          label="Nacimiento"
          value={
            profile.birthdate
              ? `${formatDate(profile.birthdate)} · ${ageFrom(profile.birthdate)} años`
              : "—"
          }
        />
        <Fact
          icon={CalendarDays}
          label="Alta"
          value={formatDate(profile.createdAt)}
        />
        <Fact icon={Fingerprint} label="ID" value={profile.id} mono />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-[18px] py-3.5">
        <span className="mr-1 text-xs text-muted-foreground">Roles</span>
        {profile.roles.map(({ role, grantedAt }) => {
          const Icon = ROLE_ICON[role]
          return (
            <span
              key={role}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border-strong px-[11px] text-[13px]"
            >
              <Icon aria-hidden className="size-3.5" />
              {ROLE_LABEL[role]}
              <span className="text-muted-foreground">
                desde {formatDate(grantedAt)}
              </span>
            </span>
          )
        })}
      </div>
    </SectionShell>
  )
}
