"use client"
import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, TriangleAlert, X } from "lucide-react"
import {
  SUPPORT_ERROR,
  type SupportAgentRef,
  type SupportAttachment,
  type SupportConversation,
  type SupportEvent,
  type SupportMessage,
  type SupportMessagesPage,
  type SupportPatchBody,
} from "@movo/shared/src/types/admin-support"
import {
  markSupportRead,
  patchSupportConversation,
  sendSupportMessage,
  setSupportStatus,
} from "@/app/support/actions"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { supportClient } from "@/lib/support/client"
import { cn } from "@/lib/utils"
import { ContextPanel, type ContextState } from "../context-panel"
import { ResizeHandle, usePanels } from "../panel-layout"
import { useSupportMessages } from "../support-provider"
import { Composer, type ComposerSend } from "./composer"
import { MessageList, type DisplayMessage } from "./message-list"
import { ThreadHeader } from "./thread-header"

interface Payload {
  body: string
  internal: boolean
  attachmentIds: string[]
  attachments: SupportAttachment[]
}

const CONFLICT_TEXT =
  "Esta consulta es tuya: no podés responderla ni modificarla. Pedile a otra persona del equipo que la atienda."

/** Une mensajes por id (sin duplicar lo que llega por evento y por respuesta) y los ordena por fecha. */
function merge(
  current: SupportMessage[],
  incoming: SupportMessage[]
): SupportMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]))
  for (const m of incoming) byId.set(m.id, m)
  return [...byId.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  )
}

/**
 * Conversación abierta (AC6–AC8, AC10–AC12): encabezado, mensajes, compositor y panel de contexto.
 * Las escrituras son optimistas: el mensaje aparece al instante con su `clientMessageId` y se
 * concilia con la respuesta o el evento; si falla queda "no enviado" con Reintentar (el reintento
 * reusa el mismo `clientMessageId`, así el backend no lo duplica).
 */
export function ThreadView({
  me,
  initialConversation,
  initialMessages,
}: {
  me: SupportAgentRef
  initialConversation: SupportConversation
  initialMessages: SupportMessagesPage
}) {
  const id = initialConversation.id
  const [conversation, setConversation] = useState(initialConversation)
  const [messages, setMessages] = useState<SupportMessage[]>(() =>
    merge([], [...initialMessages.items])
  )
  const [older, setOlder] = useState<string | null>(initialMessages.nextCursor)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState(false)
  const [pending, setPending] = useState<DisplayMessage[]>([])
  const payloads = useRef(new Map<string, Payload>())
  const [context, setContext] = useState<ContextState>({ status: "loading" })
  const [sheetOpen, setSheetOpen] = useState(false)
  const { state: panels, dragging, wide, toggle } = usePanels()
  // Ancho: la columna se puede colapsar; angosto: el Sheet.
  const contextOpen = wide ? !panels.contextCollapsed : sheetOpen
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [conflict, setConflict] = useState(
    initialConversation.user.id === me.id
  )

  const fetchContext = useCallback(() => {
    supportClient
      .context(id)
      .then((data) => setContext({ status: "ready", data }))
      .catch(() => setContext({ status: "error" }))
  }, [id])
  // La conversación se monta con `key={id}`: arranca en "loading", sin reponerlo acá.
  useEffect(() => fetchContext(), [fetchContext])
  const loadContext = () => {
    setContext({ status: "loading" })
    fetchContext()
  }

  // Abrir la conversación la marca como leída (lectura: sin bitácora ni conflicto de interés).
  useEffect(() => {
    if (conversation.unread === 0) return
    void markSupportRead(id).then(() =>
      setConversation((c) => ({ ...c, unread: 0 }))
    )
  }, [id, conversation.unread])

  const applyEvent = useCallback(
    (event: SupportEvent) => {
      if (event.type === "support_message" && event.conversationId === id) {
        const message = event.message
        if (message.clientMessageId) {
          payloads.current.delete(message.clientMessageId)
          setPending((all) =>
            all.filter((p) => p.clientMessageId !== message.clientMessageId)
          )
        }
        setMessages((all) => merge(all, [message]))
        setConversation((c) => ({ ...c, ...event.conversation }))
      } else if (
        event.type === "conversation_updated" &&
        event.conversation.id === id
      ) {
        setConversation((c) => ({ ...c, ...event.conversation }))
      }
    },
    [id]
  )

  const resync = useCallback(() => {
    supportClient
      .messages(id)
      .then((page) => setMessages((all) => merge(all, page.items)))
      .catch(() => {})
    supportClient
      .conversation(id)
      .then((next) => setConversation((c) => ({ ...c, ...next })))
      .catch(() => {})
  }, [id])

  useSupportMessages((message) => {
    if (message.type === "event") applyEvent(message.event)
    else resync()
  })

  const loadOlder = () => {
    if (!older || loadingOlder) return
    setLoadingOlder(true)
    setOlderError(false)
    supportClient
      .messages(id, older)
      .then((page) => {
        setMessages((all) => merge(all, page.items))
        setOlder(page.nextCursor)
      })
      .catch(() => setOlderError(true))
      .finally(() => setLoadingOlder(false))
  }

  const deliver = useCallback(
    async (clientMessageId: string, payload: Payload) => {
      const result = await sendSupportMessage(id, {
        body: payload.body,
        clientMessageId,
        internal: payload.internal,
        attachmentIds: payload.attachmentIds,
      })
      if (result.ok) {
        payloads.current.delete(clientMessageId)
        setPending((all) =>
          all.filter((p) => p.clientMessageId !== clientMessageId)
        )
        setMessages((all) => merge(all, [result.data]))
        return
      }
      if (result.code === SUPPORT_ERROR.CONFLICT) {
        setConflict(true)
        payloads.current.delete(clientMessageId)
        setPending((all) =>
          all.filter((p) => p.clientMessageId !== clientMessageId)
        )
        return
      }
      setPending((all) =>
        all.map((p) =>
          p.clientMessageId === clientMessageId
            ? { ...p, pending: { state: "failed", error: result.error } }
            : p
        )
      )
    },
    [id]
  )

  const send = (input: ComposerSend) => {
    const clientMessageId = crypto.randomUUID()
    const attachments: SupportAttachment[] = input.attachments.map((a) => ({
      id: a.attachmentId ?? a.key,
      contentType: "image/jpeg",
      url: a.preview,
    }))
    const payload: Payload = {
      body: input.body,
      internal: input.internal,
      attachmentIds: input.attachments.flatMap((a) =>
        a.attachmentId ? [a.attachmentId] : []
      ),
      attachments,
    }
    payloads.current.set(clientMessageId, payload)
    const base = {
      id: clientMessageId,
      conversationId: id,
      createdAt: new Date().toISOString(),
      clientMessageId,
      body: input.body,
      attachments,
      author: me,
      pending: { state: "sending" as const },
    }
    setPending((all) => [
      ...all,
      input.internal
        ? { kind: "internal_note", ...base }
        : { kind: "agent", ...base },
    ])
    void deliver(clientMessageId, payload)
  }

  const retry = (clientMessageId: string) => {
    const payload = payloads.current.get(clientMessageId)
    if (!payload) return
    setPending((all) =>
      all.map((p) =>
        p.clientMessageId === clientMessageId
          ? { ...p, pending: { state: "sending" } }
          : p
      )
    )
    void deliver(clientMessageId, payload)
  }
  const discard = (clientMessageId: string) => {
    payloads.current.delete(clientMessageId)
    setPending((all) =>
      all.filter((p) => p.clientMessageId !== clientMessageId)
    )
  }

  const write = async (
    call: () => Promise<
      | { ok: true; data: SupportConversation }
      | { ok: false; error: string; code?: string }
    >
  ) => {
    setBusy(true)
    setNotice(null)
    const result = await call()
    setBusy(false)
    if (result.ok) setConversation((c) => ({ ...c, ...result.data }))
    else if (result.code === SUPPORT_ERROR.CONFLICT) setConflict(true)
    else setNotice(result.error)
  }
  const patch = (body: SupportPatchBody) =>
    write(() => patchSupportConversation(id, body))
  const status = (action: "resolve" | "reopen") =>
    write(() => setSupportStatus(id, action))

  const display: DisplayMessage[] = [...messages, ...pending]
  const blocked = conflict ? CONFLICT_TEXT : null

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section
        aria-label={`Conversación con ${conversation.user.fullName}`}
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
      >
        <Link
          href="/support"
          className="flex h-10 items-center gap-1.5 border-b bg-card px-4 text-[13px] font-medium text-fg2 md:hidden"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Consultas
        </Link>
        <ThreadHeader
          conversation={conversation}
          meId={me.id}
          busy={busy}
          readOnly={conflict}
          onPatch={patch}
          onStatus={status}
          onToggleContext={() =>
            wide ? toggle("context") : setSheetOpen((open) => !open)
          }
          contextOpen={contextOpen}
          wide={wide}
        />
        {notice && (
          <div
            role="alert"
            className="flex items-start gap-2 border-b bg-danger-soft px-5 py-2 text-[13px]"
          >
            <TriangleAlert
              aria-hidden
              className="mt-px size-4 shrink-0 text-danger-fg"
            />
            <span className="flex-1">{notice}</span>
            <button
              type="button"
              aria-label="Cerrar aviso"
              onClick={() => setNotice(null)}
              className="rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        )}
        <MessageList
          messages={display}
          meId={me.id}
          userName={conversation.user.fullName}
          hasOlder={older !== null}
          loadingOlder={loadingOlder}
          olderError={olderError}
          onLoadOlder={loadOlder}
          onRetry={retry}
          onDiscard={discard}
        />
        <Composer
          conversationId={id}
          userName={conversation.user.fullName}
          agentName={me.fullName}
          resolved={conversation.status === "resolved"}
          blocked={blocked}
          onSend={send}
        />
      </section>
      <aside
        aria-label="Ficha del usuario"
        style={{ width: panels.contextCollapsed ? 0 : panels.context }}
        inert={panels.contextCollapsed}
        aria-hidden={panels.contextCollapsed}
        className={cn(
          "relative hidden shrink-0 flex-col bg-card min-[1360px]:flex",
          !panels.contextCollapsed && "border-l",
          !dragging && "motion-safe:transition-[width] motion-safe:duration-200"
        )}
      >
        <ResizeHandle side="context" label="Ancho de la ficha del usuario" />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ContextPanel
            conversation={conversation}
            context={context}
            disabled={busy || conflict}
            onPatch={patch}
            onRetry={loadContext}
          />
        </div>
      </aside>
      <Sheet open={sheetOpen && !wide} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-[320px] max-w-[92vw] gap-0 p-0 min-[1360px]:hidden"
        >
          <SheetTitle className="sr-only">Ficha del usuario</SheetTitle>
          <ContextPanel
            conversation={conversation}
            context={context}
            disabled={busy || conflict}
            onPatch={patch}
            onRetry={loadContext}
            onClose={() => setSheetOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  )
}
