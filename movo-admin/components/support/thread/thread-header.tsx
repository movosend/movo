"use client"
import { useState, type ReactNode } from "react"
import { Check, ChevronDown, RotateCcw, UserRound } from "lucide-react"
import {
  SUPPORT_PRIORITIES,
  SUPPORT_TOPICS,
  type SupportAgent,
  type SupportConversation,
  type SupportPatchBody,
} from "@movo/shared/src/types/admin-support"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { UserAvatar } from "@/components/user-avatar"
import { supportClient } from "@/lib/support/client"
import {
  PRIORITY_LABEL,
  ROLE_LABEL,
  STATUS_LABEL,
  TOPIC_LABEL,
} from "@/lib/support/labels"
import { cn } from "@/lib/utils"
import { MenuHeading } from "../menu-heading"
import { firstName, PRIORITY_DOT, STATUS_TONE } from "../format"
import { TopicIcon } from "../topic-icon"

/** Aparece y desaparece con un fade, achicando su ancho a 0 para que lo demás se acomode. */
function FadeWidth({
  show,
  gap,
  children,
}: {
  show: boolean
  /** Margen negativo que compensa el `gap` del padre cuando se oculta. */
  gap: string
  children: ReactNode
}) {
  return (
    <div
      aria-hidden={undefined}
      className={cn(
        "grid motion-safe:transition-[grid-template-columns,opacity,margin] motion-safe:duration-200",
        show
          ? "grid-cols-[1fr] opacity-100"
          : cn("grid-cols-[0fr] opacity-0", gap)
      )}
    >
      <div className="min-w-0 overflow-hidden">{children}</div>
    </div>
  )
}

const trigger =
  "flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-card px-2.5 text-[13px] font-medium whitespace-nowrap outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"

/**
 * Encabezado de la conversación (AC6): nombre, rol, código, estado, y las acciones — asignar (con
 * la carga de cada agente), prioridad, tema y Resolver / Reabrir. Las etiquetas y el vínculo con
 * un envío están en el panel de contexto, como en el prototipo.
 */
export function ThreadHeader({
  conversation,
  meId,
  busy,
  readOnly,
  onPatch,
  onStatus,
  onToggleContext,
  contextOpen,
  showIdentity,
}: {
  conversation: SupportConversation
  meId: string
  busy: boolean
  /** Es una consulta propia (conflicto de interés): se puede mirar, no modificar. */
  readOnly: boolean
  onPatch: (body: SupportPatchBody) => void
  onStatus: (action: "resolve" | "reopen") => void
  onToggleContext: () => void
  /** El `Sheet` de la ficha (pantallas angostas; desde 1360 px es una columna con su propio botón). */
  contextOpen: boolean
  /** `false` cuando la ficha ya está a la vista: el nombre y el avatar se ven ahí y no se repiten. */
  showIdentity: boolean
}) {
  const [agents, setAgents] = useState<SupportAgent[] | null>(null)
  const [agentsError, setAgentsError] = useState(false)
  const tone = STATUS_TONE[conversation.status]
  const assignee = conversation.assignee
  const resolved = conversation.status === "resolved"
  const off = busy || readOnly

  const loadAgents = (open: boolean) => {
    if (!open) return
    setAgentsError(false)
    supportClient
      .agents()
      .then(setAgents)
      .catch(() => setAgentsError(true))
  }

  return (
    <div className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b bg-card px-5 py-2.5">
      <FadeWidth show={showIdentity} gap="mr-[-12px]">
        <UserAvatar name={conversation.user.fullName} size={36} />
      </FadeWidth>
      <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Sigue en el árbol de accesibilidad aunque no se vea: es el título de la conversación. */}
          <FadeWidth show={showIdentity} gap="mr-[-8px]">
            <h1 className="text-[15px] font-semibold whitespace-nowrap">
              {conversation.user.fullName}
            </h1>
          </FadeWidth>
          <span
            className={cn(
              "inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
              tone.pill
            )}
          >
            <span
              aria-hidden
              className={cn("size-1.5 rounded-full", tone.dot)}
            />
            {STATUS_LABEL[conversation.status]}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {ROLE_LABEL[conversation.user.role]} ·{" "}
          {TOPIC_LABEL[conversation.topic]} ·{" "}
          <span className="font-mono">{conversation.code}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <DropdownMenu onOpenChange={loadAgents}>
          <DropdownMenuTrigger disabled={off} className={trigger}>
            <span
              aria-hidden
              className={cn(
                "flex size-5 items-center justify-center rounded-full text-[8px] font-semibold",
                assignee
                  ? "bg-avatar"
                  : "border border-dashed border-border-strong"
              )}
            >
              {assignee ? firstName(assignee.fullName)[0] : ""}
            </span>
            {assignee
              ? assignee.id === meId
                ? "Vos"
                : firstName(assignee.fullName)
              : "Sin asignar"}
            <ChevronDown aria-hidden className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <MenuHeading>Asignar a</MenuHeading>
            <DropdownMenuItem onClick={() => onPatch({ assignedTo: null })}>
              <span className="flex size-[22px] items-center justify-center rounded-full border border-dashed border-border-strong" />
              <span className="flex-1">Sin asignar</span>
              {!assignee && <Check aria-hidden className="size-4" />}
            </DropdownMenuItem>
            {agentsError && (
              <div role="alert" className="px-2.5 py-2 text-xs text-danger-fg">
                No pudimos traer los agentes.
              </div>
            )}
            {!agents && !agentsError && (
              <div className="px-2.5 py-2 text-xs text-muted-foreground">
                Cargando…
              </div>
            )}
            {agents?.map((agent) => (
              <DropdownMenuItem
                key={agent.id}
                onClick={() => onPatch({ assignedTo: agent.id })}
              >
                <span className="flex size-[22px] items-center justify-center rounded-full bg-avatar text-[9px] font-semibold">
                  {firstName(agent.fullName)[0]}
                </span>
                <span className="flex-1">
                  {agent.id === meId
                    ? `${agent.fullName} (vos)`
                    : agent.fullName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {agent.activeCount} activas
                </span>
                {assignee?.id === agent.id && (
                  <Check aria-hidden className="size-4" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger disabled={off} className={trigger}>
            <span
              aria-hidden
              className={cn(
                "size-2 rounded-full",
                PRIORITY_DOT[conversation.priority]
              )}
            />
            {PRIORITY_LABEL[conversation.priority]}
            <ChevronDown aria-hidden className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <MenuHeading>Prioridad</MenuHeading>
            {SUPPORT_PRIORITIES.map((p) => (
              <DropdownMenuItem
                key={p}
                onClick={() => onPatch({ priority: p })}
              >
                <span
                  aria-hidden
                  className={cn("size-2 rounded-full", PRIORITY_DOT[p])}
                />
                <span className="flex-1">{PRIORITY_LABEL[p]}</span>
                {conversation.priority === p && (
                  <Check aria-hidden className="size-4" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger disabled={off} className={trigger}>
            <TopicIcon topic={conversation.topic} className="size-3.5" />
            {TOPIC_LABEL[conversation.topic]}
            <ChevronDown aria-hidden className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <MenuHeading>Tema</MenuHeading>
            {SUPPORT_TOPICS.map((t) => (
              <DropdownMenuItem key={t} onClick={() => onPatch({ topic: t })}>
                <TopicIcon topic={t} className="size-4" />
                <span className="flex-1">{TOPIC_LABEL[t]}</span>
                {conversation.topic === t && (
                  <Check aria-hidden className="size-4" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {resolved ? (
          <button
            type="button"
            disabled={off}
            onClick={() => onStatus("reopen")}
            className={cn(trigger, "px-3")}
          >
            <RotateCcw aria-hidden className="size-3.5" />
            Reabrir
          </button>
        ) : (
          <button
            type="button"
            disabled={off}
            onClick={() => onStatus("resolve")}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium whitespace-nowrap text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <Check aria-hidden className="size-[15px]" />
            Resolver
          </button>
        )}
        <button
          type="button"
          onClick={onToggleContext}
          aria-label="Ficha del usuario"
          aria-expanded={contextOpen}
          title="Ficha del usuario"
          className={cn(
            "flex size-8 items-center justify-center rounded-lg border border-border-strong outline-none focus-visible:ring-2 focus-visible:ring-ring min-[1360px]:hidden",
            contextOpen ? "bg-muted" : "bg-card"
          )}
        >
          <UserRound aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  )
}
