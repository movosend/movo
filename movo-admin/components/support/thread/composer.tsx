"use client"
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react"
import {
  ImagePlus,
  Lock,
  MessageSquare,
  SendHorizontal,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react"
import {
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_ATTACHMENT_MAX_PER_MESSAGE,
  SUPPORT_MESSAGE_MAX_LENGTH,
  SUPPORT_QUICK_REPLIES,
  resolveQuickReply,
} from "@movo/shared/src/types/admin-support"
import { createSupportAttachment } from "@/app/support/actions"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { attachmentProblem, prepareImage, TOO_BIG } from "@/lib/support/images"
import { cn } from "@/lib/utils"
import { MenuHeading } from "../menu-heading"
import { firstName } from "../format"

export interface LocalAttachment {
  key: string
  name: string
  preview: string
  state: "uploading" | "ready" | "failed"
  attachmentId?: string
  error?: string
}

export interface ComposerSend {
  body: string
  internal: boolean
  attachments: LocalAttachment[]
}

const newKey = () => crypto.randomUUID()

/**
 * Compositor (AC8): Responder / Nota interna (cambia color y placeholder), Enter envía y
 * Shift+Enter hace salto de línea, imágenes por selector, arrastre o pegado con vista previa y
 * quitar antes de enviar, y respuestas rápidas con `{nombre}` y `{agente}` ya resueltos. Cada
 * imagen se sube apenas se elige (URL firmada); el envío espera a que terminen.
 */
export function Composer({
  conversationId,
  userName,
  agentName,
  resolved,
  blocked,
  onSend,
}: {
  conversationId: string
  userName: string
  agentName: string
  resolved: boolean
  /** Motivo por el que no se puede escribir (p. ej. conflicto de interés); deshabilita todo. */
  blocked: string | null
  onSend: (send: ComposerSend) => void
}) {
  const [mode, setMode] = useState<"reply" | "note">("reply")
  const [draft, setDraft] = useState("")
  const [files, setFiles] = useState<LocalAttachment[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const text = useRef<HTMLTextAreaElement>(null)
  const hintId = useId()
  const note = mode === "note"
  const uploading = files.some((f) => f.state === "uploading")
  const failed = files.some((f) => f.state === "failed")
  const hasContent = !!draft.trim() || files.length > 0
  const canSend = hasContent && !uploading && !failed && !blocked

  useEffect(
    () => () => files.forEach((f) => URL.revokeObjectURL(f.preview)),
    // Solo al desmontar: las vistas previas viven mientras el compositor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const patch = (key: string, change: Partial<LocalAttachment>) =>
    setFiles((all) => all.map((f) => (f.key === key ? { ...f, ...change } : f)))

  const upload = useCallback(
    async (file: File, key: string) => {
      try {
        const blob = await prepareImage(file)
        if (blob.size > SUPPORT_ATTACHMENT_MAX_BYTES)
          return patch(key, { state: "failed", error: TOO_BIG })
        const created = await createSupportAttachment(conversationId, {
          contentType: file.type,
          sizeBytes: blob.size,
        })
        if (!created.ok)
          return patch(key, { state: "failed", error: created.error })
        const response = await fetch(created.data.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: blob,
          credentials: created.data.uploadUrl.startsWith("/")
            ? "same-origin"
            : "omit",
        })
        if (!response.ok)
          return patch(key, {
            state: "failed",
            error: "No pudimos subir la imagen.",
          })
        patch(key, { state: "ready", attachmentId: created.data.attachmentId })
      } catch {
        patch(key, { state: "failed", error: "No pudimos subir la imagen." })
      }
    },
    [conversationId]
  )

  const addFiles = (list: FileList | File[]) => {
    setNotice(null)
    const picked = [...list]
    let room = SUPPORT_ATTACHMENT_MAX_PER_MESSAGE - files.length
    const accepted: { file: File; key: string }[] = []
    for (const file of picked) {
      const problem = attachmentProblem(file)
      if (problem) {
        setNotice(problem)
        continue
      }
      if (room <= 0) {
        setNotice(
          `Podés adjuntar hasta ${SUPPORT_ATTACHMENT_MAX_PER_MESSAGE} imágenes por mensaje.`
        )
        break
      }
      room--
      accepted.push({ file, key: newKey() })
    }
    if (!accepted.length) return
    setFiles((all) => [
      ...all,
      ...accepted.map(({ file, key }) => ({
        key,
        name: file.name || "Imagen",
        preview: URL.createObjectURL(file),
        state: "uploading" as const,
      })),
    ])
    for (const { file, key } of accepted) void upload(file, key)
  }

  const remove = (key: string) =>
    setFiles((all) => {
      const gone = all.find((f) => f.key === key)
      if (gone) URL.revokeObjectURL(gone.preview)
      return all.filter((f) => f.key !== key)
    })

  const send = () => {
    if (!canSend) return
    onSend({ body: draft.trim(), internal: note, attachments: files })
    // Las vistas previas pasan al mensaje pendiente: no se liberan acá.
    setDraft("")
    setFiles([])
    setNotice(null)
    text.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }
  const onPaste = (e: ClipboardEvent) => {
    const images = [...e.clipboardData.files].filter((f) =>
      f.type.startsWith("image/")
    )
    if (!images.length) return
    e.preventDefault()
    addFiles(images)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }

  const modes = [
    { value: "reply", label: "Responder", Icon: MessageSquare },
    { value: "note", label: "Nota interna", Icon: Lock },
  ] as const

  return (
    <div className="relative flex shrink-0 flex-col gap-2 px-5 pt-2.5 pb-4">
      {resolved && !blocked && (
        <span className="text-xs text-muted-foreground">
          Conversación resuelta. Si respondés, se reabre.
        </span>
      )}
      {blocked && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-[13px] text-warn-fg"
        >
          <TriangleAlert aria-hidden className="mt-px size-4 shrink-0" />
          {blocked}
        </div>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!blocked) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={blocked ? undefined : onDrop}
        className={cn(
          "flex flex-col rounded-xl border shadow-(--shadow-1) transition-colors",
          note
            ? "border-[var(--warn-border)] bg-warn-soft"
            : "border-border-strong bg-card",
          dragging && "ring-2 ring-ring",
          blocked && "opacity-60"
        )}
      >
        <div className="flex items-center gap-0.5 px-2 pt-1.5">
          <div
            role="tablist"
            aria-label="Tipo de mensaje"
            className="flex gap-0.5"
          >
            {modes.map(({ value, label, Icon }) => {
              const on = mode === value
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  disabled={!!blocked}
                  onClick={() => setMode(value)}
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on
                      ? value === "note"
                        ? "bg-warn-soft text-warn-fg"
                        : "bg-muted text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  <Icon aria-hidden className="size-[13px]" />
                  {label}
                </button>
              )
            })}
          </div>
          <span className="flex-1" />
          <button
            type="button"
            title="Adjuntar imágenes"
            aria-label="Adjuntar imágenes"
            disabled={
              !!blocked || files.length >= SUPPORT_ATTACHMENT_MAX_PER_MESSAGE
            }
            onClick={() => input.current?.click()}
            className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-fg2 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <ImagePlus aria-hidden className="size-[14px]" />
            <span className="hidden min-[1100px]:inline">Imagen</span>
          </button>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            data-testid="file-input"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = ""
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={!!blocked}
              title="Respuestas rápidas"
              className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-fg2 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <Zap aria-hidden className="size-[13px]" />
              <span className="hidden min-[1100px]:inline">
                Respuestas rápidas
              </span>
              <span className="sr-only min-[1100px]:hidden">
                Respuestas rápidas
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              className="w-[min(520px,90vw)]"
            >
              <MenuHeading>Respuestas rápidas</MenuHeading>
              {SUPPORT_QUICK_REPLIES.map((reply) => {
                const resolvedText = resolveQuickReply(reply.text, {
                  nombre: firstName(userName),
                  agente: firstName(agentName),
                })
                return (
                  <DropdownMenuItem
                    key={reply.id}
                    onClick={() => {
                      setMode("reply")
                      setDraft((d) => (d ? `${d.trim()} ` : "") + resolvedText)
                      text.current?.focus()
                    }}
                    className="flex-col items-start gap-0.5"
                  >
                    <span className="text-[13px] font-medium">
                      {reply.title}
                    </span>
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {resolvedText}
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {files.length > 0 && (
          <ul
            className="flex flex-wrap gap-2 px-3.5 pt-2"
            aria-label="Imágenes adjuntas"
          >
            {files.map((f) => (
              <li
                key={f.key}
                className="relative size-16 overflow-hidden rounded-lg border bg-muted"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={f.preview}
                  alt={f.name}
                  className="size-full object-cover"
                />
                {f.state !== "ready" && (
                  <span
                    className={cn(
                      "absolute inset-0 flex items-center justify-center text-[10px] font-medium",
                      f.state === "failed"
                        ? "bg-danger-soft text-danger-fg"
                        : "bg-black/35 text-white"
                    )}
                    title={f.error}
                  >
                    {f.state === "failed" ? "Error" : "Subiendo…"}
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`Quitar ${f.name}`}
                  onClick={() => remove(f.key)}
                  className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-white outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X aria-hidden className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={text}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={blocked ? undefined : onPaste}
          disabled={!!blocked}
          maxLength={SUPPORT_MESSAGE_MAX_LENGTH}
          rows={3}
          aria-label={note ? "Nota interna" : "Respuesta"}
          aria-describedby={hintId}
          placeholder={
            note
              ? `Escribí una nota para el equipo. ${firstName(userName)} no la ve.`
              : `Escribile a ${firstName(userName)}…`
          }
          className="w-full resize-none bg-transparent px-3.5 py-2 text-sm leading-[1.45] outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-between gap-2 pr-2 pb-2 pl-3.5">
          <span id={hintId} className="text-[11px] text-muted-foreground">
            {notice ??
              (note
                ? "Solo la ve el equipo de soporte"
                : "Enter para enviar · Shift + Enter para salto de línea")}
          </span>
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
              canSend
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-fg-disabled"
            )}
          >
            {uploading ? "Subiendo…" : note ? "Guardar nota" : "Enviar"}
            <SendHorizontal aria-hidden className="size-[14px]" />
          </button>
        </div>
      </div>
    </div>
  )
}
