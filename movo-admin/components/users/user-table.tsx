import Link from "next/link"
import { SearchX } from "lucide-react"
import type { AdminUserListItem } from "@movo/shared/src/types/admin-users"
import { initialsOf } from "@/lib/initials"
import {
  accountPill,
  formatDate,
  formatDni,
  formatPhone,
  KYC,
  ROLE_LABEL,
} from "@/lib/users/format"
import { cn } from "@/lib/utils"
import { SectionEmpty, StatusPill } from "./ui"

/** Columnas del listado: 7 en pantalla ancha, 3 (KYC apilado, roles bajo el nombre) debajo de 1180 px. */
export const COLUMNS =
  "grid-cols-[minmax(0,2fr)_minmax(130px,auto)_minmax(170px,auto)] min-[1180px]:grid-cols-[minmax(220px,2fr)_minmax(150px,1.1fr)_minmax(120px,1fr)_160px_130px_130px_96px]"

const MATCH_LABEL = {
  dni: "Coincide por DNI",
  phone: "Coincide por teléfono",
} as const

export function UserRow({ user }: { user: AdminUserListItem }) {
  const deleted = user.accountStatus === "deleted"
  const match =
    user.matchedBy === "dni" || user.matchedBy === "phone"
      ? user.matchedBy
      : null
  const roles = user.roles.map((r) => ROLE_LABEL[r])
  return (
    <Link
      href={`/users/${user.id}`}
      className={cn(
        "grid items-center gap-4 border-b px-[18px] py-3 text-[13px] outline-none hover:bg-surface-sub focus-visible:bg-surface-sub focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        COLUMNS
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            "flex size-8 flex-none items-center justify-center rounded-full bg-avatar text-[11px] font-semibold",
            deleted && "opacity-50"
          )}
        >
          {initialsOf(user.fullName)}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "truncate text-sm font-medium",
                deleted && "text-muted-foreground"
              )}
            >
              {user.fullName}
            </span>
            {match && (
              <span className="inline-flex h-[18px] flex-none items-center rounded-full bg-lime px-[7px] text-[11px] font-semibold text-[#0a0a0b]">
                {MATCH_LABEL[match]}
              </span>
            )}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {user.email}
          </span>
          <span className="truncate text-xs text-fg2 min-[1180px]:hidden">
            {roles.join(" · ")}
          </span>
        </span>
      </span>
      <span className="hidden min-w-0 flex-col gap-0.5 font-mono text-xs min-[1180px]:flex">
        <span className="whitespace-nowrap">{formatPhone(user.phone)}</span>
        <span className="text-muted-foreground">DNI {formatDni(user.dni)}</span>
      </span>
      <span className="hidden flex-wrap gap-1 min-[1180px]:flex">
        {roles.map((r) => (
          <span
            key={r}
            className="inline-flex h-[22px] items-center rounded-full border border-border-strong px-2 text-xs whitespace-nowrap text-fg2"
          >
            {r}
          </span>
        ))}
      </span>
      <span>
        <StatusPill
          pill={accountPill(user.accountStatus, user.bannedUntil, true)}
          dot
        />
      </span>
      <span className="hidden min-[1180px]:block">
        <StatusPill pill={KYC[user.kycIdentity]} />
      </span>
      <span className="hidden min-[1180px]:block">
        <StatusPill pill={KYC[user.kycLicense]} />
      </span>
      <span className="flex flex-col items-start gap-1 min-[1180px]:hidden">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="w-11">Identidad</span>
          <StatusPill pill={KYC[user.kycIdentity]} />
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="w-11">Licencia</span>
          <StatusPill pill={KYC[user.kycLicense]} />
        </span>
      </span>
      <span className="hidden text-right text-xs whitespace-nowrap text-fg2 min-[1180px]:block">
        {formatDate(user.createdAt)}
      </span>
    </Link>
  )
}

export function UserRows({
  users,
  query,
}: {
  users: AdminUserListItem[]
  query: string
}) {
  if (users.length === 0)
    return (
      <SectionEmpty
        icon={SearchX}
        title={`Nadie coincide con “${query}”`}
        text="Probá con el email completo, el teléfono sin el +54 o el DNI sin puntos."
        className="px-6 py-14 [&_span:first-child]:size-auto [&_span:first-child]:border-0 [&_span:first-child]:bg-transparent"
      />
    )
  return (
    <>
      {users.map((u) => (
        <UserRow key={u.id} user={u} />
      ))}
    </>
  )
}
