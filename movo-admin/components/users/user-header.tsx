import Link from "next/link"
import {
  ArrowLeft,
  Ban,
  CalendarDays,
  Car,
  Clock,
  Fingerprint,
  Mail,
  PackageOpen,
  Phone,
  ShieldCheck,
  UserX,
} from "lucide-react"
import type {
  AdminUserProfile,
  AdminUserSanction,
} from "@movo/shared/src/types/admin-users"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { initialsOf } from "@/lib/initials"
import {
  accountPill,
  daysUntil,
  formatDate,
  formatPhone,
  ROLE_LABEL,
} from "@/lib/users/format"
import { needsWithdrawalRetry } from "@/lib/users/sanctions"
import { cn } from "@/lib/utils"
import { AccountActions } from "./actions/account-actions"
import { RetryWithdrawalButton } from "./actions/retry-withdrawal-button"
import { StatusPill, TONE_BG } from "./ui"

const ROLE_ICON = { sender: PackageOpen, carrier: Car, admin: ShieldCheck }

/** Cabecera de la ficha: grilla y puntos de fondo, identidad, menú de acciones y los KPIs (children). */
export function UserHeader({
  user,
  activeSanction = null,
  isSelf = false,
  children,
}: {
  user: AdminUserProfile
  /** La sanción vigente, para el menú de acciones (levantar). */
  activeSanction?: AdminUserSanction | null
  /** La ficha es la del propio admin: las acciones sobre la cuenta quedan deshabilitadas. */
  isSelf?: boolean
  children: React.ReactNode
}) {
  const pill = accountPill(user.accountStatus, user.bannedUntil)
  const deleted = user.accountStatus === "deleted"
  return (
    <div className="relative overflow-hidden rounded-[14px] border bg-card">
      <div
        aria-hidden
        className="mv-grid-fade pointer-events-none absolute inset-0"
      />
      <div
        aria-hidden
        className="mv-dots-fade pointer-events-none absolute top-0 right-0 bottom-0 w-1/2"
      />
      <div className="relative flex flex-col gap-5 px-6 pt-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/users"
            className="flex items-center gap-1.5 text-[13px] font-medium text-fg2 hover:text-foreground"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Volver a usuarios
          </Link>
          <AccountActions
            user={user}
            activeSanction={activeSanction}
            isSelf={isSelf}
          />
        </div>
        <div className="flex min-w-0 items-center gap-[18px]">
          <Avatar
            aria-hidden
            className={cn("size-16 flex-none", deleted && "opacity-50")}
          >
            {user.photoUrl && (
              <AvatarImage
                src={user.photoUrl}
                alt=""
                referrerPolicy="no-referrer"
              />
            )}
            <AvatarFallback className="bg-avatar text-xl font-semibold text-foreground">
              {initialsOf(user.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="mr-1.5 text-[28px] leading-[1.15] font-semibold tracking-[-0.025em]">
                {user.fullName}
              </h1>
              <StatusPill
                pill={pill}
                dot
                className="h-[26px] gap-[7px] px-[11px] text-[13px]"
              />
              {user.roles.map(({ role }) => {
                const Icon = ROLE_ICON[role]
                return (
                  <span
                    key={role}
                    className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-border-strong bg-card px-2.5 text-[13px]"
                  >
                    <Icon aria-hidden className="size-3.5" />
                    {ROLE_LABEL[role]}
                  </span>
                )
              })}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg2">
              <span className="flex items-center gap-1.5">
                <Mail aria-hidden className="size-3.5 text-muted-foreground" />
                {user.email}
              </span>
              <span className="flex items-center gap-1.5">
                <Phone aria-hidden className="size-3.5 text-muted-foreground" />
                <span className="font-mono text-xs">
                  {formatPhone(user.phone)}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <CalendarDays
                  aria-hidden
                  className="size-3.5 text-muted-foreground"
                />
                Alta {formatDate(user.createdAt)}
              </span>
              <span className="flex items-center gap-1.5">
                <Fingerprint
                  aria-hidden
                  className="size-3.5 text-muted-foreground"
                />
                <span
                  className="font-mono text-xs text-muted-foreground"
                  title={user.id}
                >
                  {user.id.slice(0, 13)}…
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
      {children}
    </div>
  )
}

/**
 * Aviso bajo la cabecera según el estado de la cuenta; una cuenta activa no lleva ninguno. Con la
 * sanción vigente suma el motivo, quién la aplicó y, si el retiro quedó a medias, el reintento (AC7).
 */
export function AccountBanner({
  user,
  sanction = null,
}: {
  user: AdminUserProfile
  sanction?: AdminUserSanction | null
}) {
  if (user.accountStatus === "active") return null
  let tone: "warning" | "danger" | "neutral"
  let title: string
  let text: string
  let Icon = Ban
  if (user.accountStatus === "deleted") {
    tone = "neutral"
    Icon = UserX
    title = `Cuenta eliminada${user.deletedAt ? ` el ${formatDate(user.deletedAt)}` : ""}`
    text =
      "La persona ya no puede iniciar sesión. Se conservan sus envíos, reportes y movimientos como evidencia."
  } else if (user.bannedUntil) {
    tone = "warning"
    Icon = Clock
    const days = daysUntil(user.bannedUntil)
    title = `Suspendida hasta el ${formatDate(user.bannedUntil)} · ${
      days === 1 ? "falta 1 día" : `faltan ${days} días`
    }`
    text =
      "No puede publicar envíos, ofertar ni declarar viajes mientras dure la suspensión. Sus envíos en curso siguen."
  } else if (user.accountStatus === "suspended") {
    tone = "warning"
    Icon = Clock
    title = "Suspendida sin fecha de fin"
    text =
      "No puede publicar envíos, ofertar ni declarar viajes hasta que se levante la suspensión. Sus envíos en curso siguen."
  } else {
    tone = "danger"
    title = "Inhabilitada"
    text = "No puede iniciar sesión ni usar Movo con esta cuenta."
  }
  const deleted = user.accountStatus === "deleted"
  const border = {
    warning: "border-warn-border",
    danger: "border-dot-danger/35",
    neutral: "border-border-strong",
  }[tone]
  const tile = {
    warning: "bg-warn-fg",
    danger: "bg-danger-fg",
    neutral: "bg-fg2",
  }[tone]
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-3.5 rounded-[10px] border px-4 py-3.5",
        TONE_BG[tone],
        border
      )}
    >
      <span
        className={cn(
          "flex size-9 flex-none items-center justify-center rounded-[9px] text-card",
          tile
        )}
      >
        <Icon aria-hidden className="size-[18px]" />
      </span>
      <div className="flex min-w-0 flex-col gap-[3px] text-foreground">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-[13px] text-pretty text-fg2">{text}</span>
        {sanction && !deleted && (
          <span className="text-[13px] text-pretty">
            «{sanction.reason}»
            <span className="text-fg2">
              {" "}
              · aplicada el {formatDate(sanction.startedAt)}
              {sanction.appliedByName ? ` por ${sanction.appliedByName}` : ""}
            </span>
          </span>
        )}
        {!deleted && needsWithdrawalRetry(sanction) && sanction && (
          <div className="mt-1.5 flex flex-col gap-1.5">
            <span className="text-[13px] text-warn-fg">
              No se pudo retirar todo lo que tenía abierto (publicaciones,
              ofertas o viajes).
            </span>
            <RetryWithdrawalButton userId={user.id} sanctionId={sanction.id} />
          </div>
        )}
      </div>
    </div>
  )
}
