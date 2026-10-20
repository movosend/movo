"use client"
import { useState } from "react"
import {
  ChevronDown,
  Gavel,
  KeyRound,
  Mail,
  NotebookPen,
  Phone,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import type { AdminUserProfile } from "@movo/shared/src/types/admin-users"
import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { ContactDialog } from "./contact-dialog"
import { LedgerDialog } from "./ledger-dialog"
import { NoteDialog } from "./note-dialog"
import { SessionsDialog } from "./sessions-dialog"

type ActionKey = "email" | "phone" | "sessions" | "ledger" | "note"

const ITEMS: {
  key: ActionKey
  label: string
  icon: LucideIcon
  group: "access" | "money" | "support"
}[] = [
  { key: "email", label: "Cambiar el email", icon: Mail, group: "access" },
  { key: "phone", label: "Cambiar el teléfono", icon: Phone, group: "access" },
  {
    key: "sessions",
    label: "Cerrar todas las sesiones",
    icon: KeyRound,
    group: "access",
  },
  { key: "ledger", label: "Ajustar el saldo", icon: Wallet, group: "money" },
  {
    key: "note",
    label: "Agregar nota interna",
    icon: NotebookPen,
    group: "support",
  },
]

const GROUP_LABEL = {
  access: "Acceso",
  money: "Cuenta corriente",
  support: "Soporte",
} as const

/**
 * Menú "Acciones" de la cabecera de la ficha (MOVO-294). Cada acción abre su diálogo, con motivo
 * y confirmación; todas quedan en la bitácora. Las sanciones llegan con MOVO-299 y ocupan su lugar
 * deshabilitadas. Con la cuenta eliminada solo se puede dejar una nota, y sobre la propia cuenta
 * ninguna (`ADMIN_CONFLICT_OF_INTEREST`).
 */
export function AccountActions({
  user,
  isSelf = false,
}: {
  user: AdminUserProfile
  isSelf?: boolean
}) {
  const [current, setCurrent] = useState<ActionKey | null>(null)
  const close = () => setCurrent(null)
  const deleted = user.accountStatus === "deleted"
  const blocked = (key: ActionKey) => isSelf || (deleted && key !== "note")
  const notice = isSelf
    ? "No podés actuar sobre tu propia cuenta."
    : deleted
      ? "La cuenta está eliminada: solo admite notas."
      : null
  const groups = (["access", "money", "support"] as const).map((group) => ({
    group,
    items: ITEMS.filter((item) => item.group === group),
  }))
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(buttonVariants({ variant: "outline" }), "h-9 px-3.5")}
        >
          Acciones
          <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {notice && (
            <>
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-xs leading-snug whitespace-normal">
                  {notice}
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
          {groups.map(({ group, items }) => (
            <DropdownMenuGroup key={group}>
              <DropdownMenuLabel>{GROUP_LABEL[group]}</DropdownMenuLabel>
              {items.map(({ key, label, icon: Icon }) => (
                <DropdownMenuItem
                  key={key}
                  disabled={blocked(key)}
                  onClick={() => setCurrent(key)}
                >
                  <Icon aria-hidden />
                  {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </DropdownMenuGroup>
          ))}
          <DropdownMenuGroup>
            <DropdownMenuLabel>Sanciones</DropdownMenuLabel>
            <DropdownMenuItem disabled>
              <Gavel aria-hidden />
              Suspender o inhabilitar
              <span className="ml-auto text-xs text-muted-foreground">
                MOVO-299
              </span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ContactDialog
        field={current === "email" || current === "phone" ? current : null}
        onClose={close}
        user={user}
      />
      <SessionsDialog
        open={current === "sessions"}
        onClose={close}
        userId={user.id}
        fullName={user.fullName}
      />
      <LedgerDialog
        open={current === "ledger"}
        onClose={close}
        userId={user.id}
        fullName={user.fullName}
      />
      <NoteDialog
        open={current === "note"}
        onClose={close}
        userId={user.id}
        fullName={user.fullName}
      />
    </>
  )
}
