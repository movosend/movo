"use client"
import Link from "next/link"
import { useState } from "react"
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Check,
  Clock,
  Copy,
  IdCard,
  Link2,
  Mail,
  Phone,
  Plus,
  RotateCw,
  ShieldCheck,
  Star,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react"
import {
  SUPPORT_TAGS,
  type SupportConversation,
  type SupportPatchBody,
  type SupportTag,
  type SupportUserContext,
  type SupportVerificationBadge,
} from "@movo/shared/src/types/admin-support"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { UserAvatar } from "@/components/user-avatar"
import { ROLE_LABEL, STATUS_LABEL, TOPIC_LABEL } from "@/lib/support/labels"
import { shipmentHref } from "@/lib/support/shipment-href"
import { cn } from "@/lib/utils"
import { MenuHeading } from "./menu-heading"
import {
  firstName,
  formatMonthYear,
  formatShortDate,
  SHIPMENT_TONE,
} from "./format"

export type ContextState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: SupportUserContext }

const BADGES: Record<
  SupportVerificationBadge,
  { label: string; tone: string; Icon: LucideIcon }
> = {
  identity: {
    label: "Identidad verificada",
    tone: "bg-success-soft text-success-fg",
    Icon: BadgeCheck,
  },
  kyc_approved: {
    label: "KYC aprobado",
    tone: "bg-success-soft text-success-fg",
    Icon: ShieldCheck,
  },
  kyc_pending: {
    label: "KYC pendiente",
    tone: "bg-warn-soft text-warn-fg",
    Icon: Clock,
  },
  license_valid: {
    label: "Licencia vigente",
    tone: "bg-info-soft text-info-fg",
    Icon: IdCard,
  },
}

const heading =
  "text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase"

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      aria-label={done ? `${label} copiado` : `Copiar ${label}`}
      title={`Copiar ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {done ? (
        <Check aria-hidden className="size-3.5" />
      ) : (
        <Copy aria-hidden className="size-3.5" />
      )}
    </button>
  )
}

function Tags({
  tags,
  disabled,
  onChange,
}: {
  tags: SupportTag[]
  disabled: boolean
  onChange: (tags: SupportTag[]) => void
}) {
  return (
    <section
      className="flex flex-col gap-2.5 border-b px-5 py-4"
      aria-label="Etiquetas"
    >
      <h2 className={heading}>Etiquetas</h2>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex h-6 items-center gap-1 rounded-full bg-muted pr-1 pl-2.5 text-xs font-medium"
          >
            {tag}
            <button
              type="button"
              aria-label={`Quitar etiqueta ${tag}`}
              disabled={disabled}
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="flex size-[18px] items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <X aria-hidden className="size-3" />
            </button>
          </span>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={disabled}
            className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-border-strong px-2.5 text-xs font-medium text-fg2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <Plus aria-hidden className="size-3" />
            Agregar
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <MenuHeading>Etiquetas</MenuHeading>
            {SUPPORT_TAGS.map((tag) => {
              const on = tags.includes(tag)
              return (
                <DropdownMenuItem
                  key={tag}
                  onClick={() =>
                    onChange(
                      on ? tags.filter((t) => t !== tag) : [...tags, tag]
                    )
                  }
                >
                  <span className="w-4">
                    {on && <Check aria-hidden className="size-4" />}
                  </span>
                  {tag}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </section>
  )
}

function LinkedShipment({
  conversation,
  context,
  disabled,
  onPatch,
}: {
  conversation: SupportConversation
  context: SupportUserContext | null
  disabled: boolean
  onPatch: (body: SupportPatchBody) => void
}) {
  const linked = conversation.shipment
  const info =
    linked && context?.recentShipments.find((s) => s.id === linked.id)
  const href = linked ? shipmentHref(linked.id) : null
  const menu = (
    <DropdownMenuContent align="end" className="w-[min(300px,85vw)]">
      <MenuHeading>
        Envíos de {firstName(conversation.user.fullName)}
      </MenuHeading>
      {!context ? (
        <div className="px-2.5 py-2 text-xs text-muted-foreground">
          Los envíos del usuario no están disponibles ahora.
        </div>
      ) : context.recentShipments.length === 0 ? (
        <div className="px-2.5 py-2 text-xs text-muted-foreground">
          No tiene envíos todavía.
        </div>
      ) : (
        context.recentShipments.map((s) => (
          <DropdownMenuItem
            key={s.id}
            onClick={() => linked?.id !== s.id && onPatch({ shipmentId: s.id })}
            className={cn(
              "flex-col items-start gap-0.5",
              linked?.id === s.id && "bg-muted"
            )}
          >
            <span className="flex w-full justify-between gap-2">
              <span className="font-mono text-xs font-semibold">#{s.code}</span>
              <span className="text-[11px] text-muted-foreground">
                {s.statusLabel}
              </span>
            </span>
            <span className="text-xs text-fg2">{s.route}</span>
          </DropdownMenuItem>
        ))
      )}
      {linked && (
        <DropdownMenuItem
          onClick={() => onPatch({ shipmentId: null })}
          className="text-danger-fg"
        >
          Desvincular
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  )
  return (
    <section
      className="flex flex-col gap-2.5 border-b px-5 py-4"
      aria-label="Envío vinculado"
    >
      <div className="flex items-center justify-between">
        <h2 className={heading}>Envío vinculado</h2>
        {linked && (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={disabled}
              className="rounded text-xs font-medium text-fg2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              Cambiar
            </DropdownMenuTrigger>
            {menu}
          </DropdownMenu>
        )}
      </div>
      {linked ? (
        <div className="flex flex-col gap-1.5 rounded-lg border bg-surface-sub p-3">
          <span className="flex items-center justify-between gap-2">
            <span className="font-mono text-[13px] font-semibold">
              #{linked.code}
            </span>
            {info && (
              <span
                className={cn(
                  "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium",
                  SHIPMENT_TONE[info.tone]
                )}
              >
                {info.statusLabel}
              </span>
            )}
          </span>
          {info && <span className="text-[13px] text-fg2">{info.route}</span>}
          {href ? (
            <a
              href={href}
              className="flex items-center gap-1 text-xs font-medium"
            >
              Abrir en Envíos <ArrowRight aria-hidden className="size-[13px]" />
            </a>
          ) : (
            <span className="text-xs text-muted-foreground">
              El detalle del envío llega con la pantalla de Envíos.
            </span>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPatch({ shipmentId: null })}
            className="self-start rounded text-xs font-medium text-danger-fg outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            Desvincular
          </button>
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={disabled}
            className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong text-[13px] font-medium text-fg2 outline-none hover:border-fg2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <Link2 aria-hidden className="size-3.5" />
            Vincular a un envío
          </DropdownMenuTrigger>
          {menu}
        </DropdownMenu>
      )}
    </section>
  )
}

function Loading() {
  return (
    <div aria-busy className="flex flex-col gap-5 px-5 py-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="flex gap-1.5">
        <Skeleton className="h-[22px] w-20 rounded-full" />
        <Skeleton className="h-[22px] w-16 rounded-full" />
        <Skeleton className="h-[22px] w-24 rounded-full" />
      </div>
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3.5 w-4/5" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
    </div>
  )
}

/**
 * Panel de contexto del usuario (AC10–AC12): perfil con acciones de copiar, insignias, etiquetas,
 * envío vinculado, envíos recientes y consultas anteriores. El encabezado sale de la conversación
 * (ya cargada); el resto, de `GET …/context`, que falla abierto: si `svc-users` no responde las
 * insignias vienen en `null` y se avisa en su lugar, sin romper el resto.
 */
export function ContextPanel({
  conversation,
  context,
  disabled,
  onPatch,
  onRetry,
  onClose,
}: {
  conversation: SupportConversation
  context: ContextState
  disabled: boolean
  onPatch: (body: SupportPatchBody) => void
  onRetry: () => void
  onClose?: () => void
}) {
  const data = context.status === "ready" ? context.data : null
  const profile = data?.profile
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <section
        className="flex flex-col items-start gap-3 border-b p-5"
        aria-label="Perfil"
      >
        <div className="flex w-full items-start justify-between">
          <UserAvatar name={conversation.user.fullName} size={52} />
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="flex size-7 items-center justify-center rounded-md text-fg2 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="size-4" />
            </button>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-base font-semibold">
            {conversation.user.fullName}
          </span>
          <span className="text-[13px] text-muted-foreground">
            {ROLE_LABEL[conversation.user.role]}
            {profile &&
              ` · en Movo desde ${formatMonthYear(profile.memberSince)}`}
          </span>
        </div>
        <Link
          href={`/users/${conversation.user.id}`}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border-strong px-2.5 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          Ver ficha del usuario
          <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
        {context.status === "loading" && <Loading />}
        {context.status === "error" && (
          <div
            role="alert"
            className="flex w-full flex-col items-start gap-2 rounded-lg bg-danger-soft p-3 text-[13px]"
          >
            <span className="flex items-center gap-2 font-medium">
              <TriangleAlert aria-hidden className="size-4 text-danger-fg" />
              No pudimos cargar la ficha del usuario.
            </span>
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RotateCw /> Reintentar
            </Button>
          </div>
        )}
        {data && profile && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {data.badges === null ? (
                <span className="text-xs text-muted-foreground">
                  Verificaciones no disponibles por ahora.
                </span>
              ) : data.badges.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  Sin verificaciones.
                </span>
              ) : (
                data.badges.map((b) => {
                  const { label, tone, Icon } = BADGES[b]
                  return (
                    <span
                      key={b}
                      className={cn(
                        "inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11px] font-medium",
                        tone
                      )}
                    >
                      <Icon aria-hidden className="size-3" />
                      {label}
                    </span>
                  )
                })
              )}
            </div>
            <dl className="grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 text-[13px] text-fg2">
              <Star aria-hidden className="size-3.5 text-muted-foreground" />
              <dt className="sr-only">Reputación</dt>
              <dd className="col-span-2">
                {profile.ratingAverage === null
                  ? "Sin calificaciones todavía"
                  : `${profile.ratingAverage.toFixed(1).replace(".", ",")} · ${profile.ratingCount} calificaciones`}
              </dd>
              <Mail aria-hidden className="size-3.5 text-muted-foreground" />
              <dt className="sr-only">Email</dt>
              <dd className="truncate">{profile.email || "—"}</dd>
              {profile.email ? (
                <CopyButton value={profile.email} label="email" />
              ) : (
                <span />
              )}
              <Phone aria-hidden className="size-3.5 text-muted-foreground" />
              <dt className="sr-only">Teléfono</dt>
              <dd className="font-mono text-xs">{profile.phone}</dd>
              <CopyButton value={profile.phone} label="teléfono" />
            </dl>
          </>
        )}
      </section>

      <Tags
        tags={conversation.tags}
        disabled={disabled}
        onChange={(tags) => onPatch({ tags })}
      />
      <LinkedShipment
        conversation={conversation}
        context={data}
        disabled={disabled}
        onPatch={onPatch}
      />

      {data && (
        <>
          <section
            className="flex flex-col gap-2 border-b px-5 py-4"
            aria-label="Envíos recientes"
          >
            <h2 className={heading}>Envíos recientes</h2>
            {data.recentShipments.length === 0 ? (
              <span className="text-[13px] text-muted-foreground">
                Todavía no tiene envíos.
              </span>
            ) : (
              data.recentShipments.map((s) => {
                const href = shipmentHref(s.id)
                const row = (
                  <>
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold">
                        #{s.code}
                      </span>
                      <span
                        className={cn(
                          "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium",
                          SHIPMENT_TONE[s.tone]
                        )}
                      >
                        {s.statusLabel}
                      </span>
                    </span>
                    <span className="text-xs text-fg2">{s.route}</span>
                  </>
                )
                return href ? (
                  <a
                    key={s.id}
                    href={href}
                    className="flex flex-col gap-0.5 rounded-lg border p-2.5 hover:border-border-strong"
                  >
                    {row}
                  </a>
                ) : (
                  <div
                    key={s.id}
                    className="flex flex-col gap-0.5 rounded-lg border p-2.5"
                  >
                    {row}
                  </div>
                )
              })
            )}
          </section>
          <section
            className="flex flex-col gap-1.5 px-5 pt-4 pb-6"
            aria-label="Conversaciones anteriores"
          >
            <h2 className={cn(heading, "mb-1")}>Conversaciones anteriores</h2>
            {data.otherConversations.length === 0 ? (
              <span className="text-[13px] text-muted-foreground">
                Es su primera consulta.
              </span>
            ) : (
              data.otherConversations.map((h) => (
                <div
                  key={h.conversationId}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 border-b py-2"
                >
                  <span className="text-[13px] font-medium">
                    {TOPIC_LABEL[h.topic]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatShortDate(h.createdAt)}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{h.code}</span> ·{" "}
                    {STATUS_LABEL[h.status]}
                  </span>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </div>
  )
}
