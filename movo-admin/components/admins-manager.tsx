"use client"
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  startTransition,
} from "react"
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Info,
  LoaderCircle,
  Search,
  ShieldCheck,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react"
import type { AdminCandidate } from "@movo/shared/src/types/user"
import {
  cancelGrant,
  confirmGrant,
  resendGrantCode,
  revokeAdmin,
  searchCandidates,
  startGrant,
  type AdminsState,
  type GrantState,
} from "@/app/admins/actions"
import { UserAvatar } from "@/components/user-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"

export interface AdminRowData {
  id: string
  fullName: string
  email: string
  photoUrl: string | null
  suspended: boolean
  since: string
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <span
      role="alert"
      className="flex items-start gap-1.5 text-[13px] leading-snug text-danger-fg"
    >
      <AlertCircle className="mt-px size-3.5 flex-none" />
      <span>{children}</span>
    </span>
  )
}

function blockedReason(candidate: AdminCandidate): string | null {
  if (candidate.isAdmin) return "Ya es administrador"
  if (candidate.status !== "active") return "Cuenta no activa"
  if (!candidate.emailVerified) return "Email sin verificar"
  return null
}

/** Autocompletado por nombre o email (mínimo 2 letras, espera 250 ms antes de buscar). */
function CandidatePicker({
  onSelect,
}: {
  onSelect: (candidate: AdminCandidate) => void
}) {
  const listId = useId()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<AdminCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const sequence = useRef(0)
  const term = query.trim()
  const searchable = term.length >= 2

  useEffect(() => {
    const current = ++sequence.current
    if (!searchable) return
    const timer = setTimeout(() => {
      setLoading(true)
      searchCandidates(term)
        .then((found) => {
          if (current !== sequence.current) return
          setResults(found)
          setActive(0)
        })
        .catch(() => {
          if (current === sequence.current) setResults([])
        })
        .finally(() => {
          if (current === sequence.current) setLoading(false)
        })
    }, 250)
    return () => clearTimeout(timer)
  }, [term, searchable])

  const shown = searchable ? results : []
  const choose = (candidate: AdminCandidate) => {
    if (blockedReason(candidate)) return
    setOpen(false)
    onSelect(candidate)
  }
  const showList = open && searchable
  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={`${listId}-input`} className="text-[13px] font-medium">
        Persona
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showList && shown[active] ? `${listId}-${active}` : undefined
          }
          autoFocus
          autoComplete="off"
          maxLength={100}
          placeholder="Nombre o email de la cuenta en Movo"
          className="h-10 pr-9 pl-9"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            if (event.target.value.trim().length >= 2) setLoading(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault()
              setOpen(true)
              setActive((i) => Math.min(shown.length - 1, i + 1))
            } else if (event.key === "ArrowUp") {
              event.preventDefault()
              setActive((i) => Math.max(0, i - 1))
            } else if (event.key === "Enter" && showList) {
              event.preventDefault()
              if (shown[active]) choose(shown[active])
            } else if (event.key === "Escape" && showList) {
              event.stopPropagation()
              setOpen(false)
            }
          }}
        />
        {loading && (
          <LoaderCircle className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Personas encontradas"
          className="absolute top-full z-10 mt-1 max-h-72 w-full overflow-auto rounded-[10px] border bg-popover p-1 shadow-[var(--shadow-3)]"
        >
          {shown.map((candidate, index) => {
            const reason = blockedReason(candidate)
            return (
              <li
                key={candidate.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                aria-disabled={!!reason}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  choose(candidate)
                }}
                className={`flex items-center gap-3 rounded-md px-2.5 py-2 ${
                  index === active ? "bg-muted" : ""
                } ${reason ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
              >
                <UserAvatar
                  name={candidate.fullName}
                  photoUrl={candidate.photoUrl}
                />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-sm font-medium">
                    {candidate.fullName}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {candidate.email}
                  </span>
                </span>
                {reason && (
                  <span className="flex-none rounded-full border border-border-strong px-2 py-0.5 text-[11px] font-medium text-fg2">
                    {reason}
                  </span>
                )}
              </li>
            )
          })}
          {shown.length === 0 && !loading && (
            <li className="px-3 py-3 text-[13px] text-muted-foreground">
              No encontramos a nadie con «{term}». La persona tiene que tener
              cuenta en la app.
            </li>
          )}
          {shown.length === 0 && loading && (
            <li className="px-3 py-3 text-[13px] text-muted-foreground">
              Buscando…
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function SelectedCandidate({
  candidate,
  onChange,
}: {
  candidate: { fullName: string; email: string; photoUrl: string | null }
  onChange?: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-surface-sub px-3 py-2.5">
      <UserAvatar name={candidate.fullName} photoUrl={candidate.photoUrl} />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm font-medium">
          {candidate.fullName}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {candidate.email}
        </span>
      </div>
      {onChange && (
        <button
          type="button"
          onClick={onChange}
          className="text-[13px] font-medium text-fg2 underline underline-offset-3 hover:text-foreground"
        >
          Cambiar
        </button>
      )}
    </div>
  )
}

/** Estado inicial vacío del flujo: se vuelve a montar con otro `attempt` para empezar de nuevo. */
function AddFlow({
  initialError,
  onClose,
  onDone,
  onRestart,
}: {
  initialError?: string
  onClose: () => void
  onDone: (name: string) => void
  onRestart: (message?: string) => void
}) {
  const [selected, setSelected] = useState<AdminCandidate | null>(null)
  const [wantsPassword, setWantsPassword] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [code, setCode] = useState("")
  const [now, setNow] = useState(0)
  const [startState, startAction, starting] = useActionState<
    GrantState,
    FormData
  >(startGrant, {})
  const [confirmState, confirmAction, confirming] = useActionState<
    GrantState,
    FormData
  >(confirmGrant, {})
  const [resendState, resendAction, resending] = useActionState<
    GrantState,
    FormData | undefined
  >((previous) => resendGrantCode(previous), {})

  const inCode = !!startState.codeSentTo
  const maskedEmail = resendState.codeSentTo ?? startState.codeSentTo
  const resendAt = resendState.resendAt ?? startState.resendAt ?? 0
  const seconds = Math.max(0, Math.ceil((resendAt - now) / 1000))

  useEffect(() => {
    if (!inCode) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [inCode])
  useEffect(() => {
    if (confirmState.done) onDone(confirmState.done)
  }, [confirmState.done, onDone])

  const restartMessage =
    confirmState.restart || resendState.restart || startState.restart
      ? (confirmState.error ?? resendState.error ?? startState.error)
      : undefined
  const step = inCode ? "code" : selected && wantsPassword ? "password" : "pick"
  const stepError =
    step === "password"
      ? startState.error
      : step === "code"
        ? (confirmState.error ?? resendState.error)
        : initialError

  const back = () => {
    if (step === "password") setWantsPassword(false)
    if (step === "code") {
      startTransition(() => {
        void cancelGrant()
        onRestart()
      })
    }
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          {step !== "pick" && (
            <button
              type="button"
              onClick={back}
              aria-label="Volver"
              className="-ml-1 flex size-7 items-center justify-center rounded-md text-fg2 hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </button>
          )}
          <DialogTitle>
            {step === "pick" ? "Agregar administrador" : "Confirmá que sos vos"}
          </DialogTitle>
        </div>
      </DialogHeader>

      {step === "pick" && (
        <>
          <DialogBody>
            {selected ? (
              <SelectedCandidate
                candidate={selected}
                onChange={() => setSelected(null)}
              />
            ) : (
              <CandidatePicker onSelect={setSelected} />
            )}
            {stepError && <ErrorLine>{stepError}</ErrorLine>}
            <span className="text-[13px] leading-relaxed text-pretty text-fg2">
              La persona tiene que tener una cuenta en Movo con el email
              verificado. Le vamos a avisar por email que ahora tiene acceso al
              panel.
            </span>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!selected}
              onClick={() => setWantsPassword(true)}
            >
              Continuar
            </Button>
          </DialogFooter>
        </>
      )}

      {step === "password" && selected && (
        <form action={startAction}>
          <input type="hidden" name="targetEmail" value={selected.email} />
          <input type="hidden" name="targetName" value={selected.fullName} />
          <DialogBody>
            <SelectedCandidate candidate={selected} />
            <p className="text-sm leading-relaxed text-pretty text-fg2">
              Dar acceso al panel es una acción sensible. Para confirmarla,
              ingresá tu contraseña y después el código que te mandamos por
              email.
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">Tu contraseña</span>
              <div className="auth-password">
                <Input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  autoFocus
                  required
                  maxLength={1024}
                  disabled={starting}
                  aria-invalid={!!startState.error}
                  className="h-10"
                />
                <button
                  type="button"
                  className="auth-reveal"
                  aria-label={
                    showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </button>
              </div>
            </label>
            {stepError && <ErrorLine>{stepError}</ErrorLine>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={starting} className="min-w-36">
              {starting ? (
                <>
                  <LoaderCircle className="animate-spin" />
                  Enviando…
                </>
              ) : (
                "Enviar código"
              )}
            </Button>
          </DialogFooter>
        </form>
      )}

      {step === "code" && selected && (
        <form action={confirmAction}>
          <DialogBody>
            <SelectedCandidate candidate={selected} />
            <div className="flex items-start gap-2.5 rounded-lg bg-info-soft px-3.5 py-3 text-[13px] leading-snug text-info-fg">
              <Info className="mt-px size-4 flex-none" />
              <span>
                Te enviamos un código de 6 dígitos a{" "}
                <strong className="font-medium">{maskedEmail}</strong>.
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="grant-code" className="text-[13px] font-medium">
                Código de verificación
              </label>
              <InputOTP
                id="grant-code"
                name="code"
                maxLength={6}
                pattern="^[0-9]*$"
                pasteTransformer={(value) => value.replace(/\s/g, "")}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={setCode}
                disabled={confirming || !!restartMessage}
                aria-invalid={!!confirmState.error}
                required
              >
                <InputOTPGroup className="auth-otp">
                  {Array.from({ length: 6 }, (_, i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            {stepError && <ErrorLine>{stepError}</ErrorLine>}
            {!restartMessage && (
              <div className="auth-resend">
                {seconds > 0 ? (
                  <span>Podés pedir otro código en {seconds} s</span>
                ) : (
                  <button
                    type="button"
                    className="auth-link"
                    disabled={resending}
                    onClick={() =>
                      startTransition(() => resendAction(undefined))
                    }
                  >
                    Reenviar código
                  </button>
                )}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            {restartMessage ? (
              <Button type="button" onClick={() => onRestart(restartMessage)}>
                Empezar de nuevo
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={confirming || code.length !== 6}
                className="min-w-36"
              >
                {confirming ? (
                  <>
                    <LoaderCircle className="animate-spin" />
                    Otorgando…
                  </>
                ) : (
                  "Otorgar acceso"
                )}
              </Button>
            )}
          </DialogFooter>
        </form>
      )}
    </>
  )
}

function AddAdminDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: (name: string) => void
}) {
  const [attempt, setAttempt] = useState(0)
  const [initialError, setInitialError] = useState<string>()
  const close = () => {
    void cancelGrant()
    onOpenChange(false)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
        else onOpenChange(true)
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <AddFlow
          key={attempt}
          initialError={initialError}
          onClose={close}
          onDone={(name) => {
            onOpenChange(false)
            onDone(name)
          }}
          onRestart={(message) => {
            setInitialError(message)
            setAttempt((n) => n + 1)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function RevokeDialog({
  admin,
  onClose,
}: {
  admin: AdminRowData | undefined
  onClose: () => void
}) {
  return (
    <Dialog open={!!admin} onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="max-w-[480px]">
        {admin && (
          <RevokeForm key={admin.id} admin={admin} onCancel={onClose} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function RevokeForm({
  admin,
  onCancel,
}: {
  admin: AdminRowData
  onCancel: () => void
}) {
  const [state, action, pending] = useActionState<AdminsState, FormData>(
    revokeAdmin,
    {}
  )
  const [reason, setReason] = useState("")
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={admin.id} />
      <DialogHeader>
        <DialogTitle>¿Revocar el acceso de {admin.fullName}?</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <SelectedCandidate
          candidate={{
            fullName: admin.fullName,
            email: `${admin.email} · admin desde ${admin.since}`,
            photoUrl: admin.photoUrl,
          }}
        />
        <p className="text-sm leading-relaxed text-pretty text-fg2">
          Se cierra su sesión en el panel de inmediato. Va a poder seguir usando
          la app de Movo normalmente.
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="flex justify-between gap-3 text-[13px]">
            <span className="font-medium">Motivo</span>
            <span className="text-muted-foreground">
              Obligatorio · queda en la bitácora
            </span>
          </span>
          <textarea
            name="reason"
            rows={3}
            required
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={pending}
            placeholder="Ej.: dejó el equipo de operaciones"
            className="min-h-[84px] w-full resize-y rounded-md border border-border-strong bg-card px-3 py-2.5 text-sm leading-normal outline-none placeholder:text-muted-foreground focus:border-foreground focus:ring-3 focus:ring-ring/30"
          />
        </label>
        {state.error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg bg-danger-soft px-3.5 py-3 text-[13px] leading-snug text-danger-fg"
          >
            <AlertCircle className="mt-px size-4 flex-none" />
            <span>{state.error}</span>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <button
          type="submit"
          disabled={pending || reason.trim().length < 3}
          className="flex h-9 min-w-36 items-center justify-center gap-2 rounded-lg bg-[var(--danger-solid)] px-3.5 text-sm font-medium text-white hover:bg-[var(--danger-solid-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              Revocando…
            </>
          ) : (
            "Revocar acceso"
          )}
        </button>
      </DialogFooter>
    </form>
  )
}

function Toast({
  message,
  onDismiss,
}: {
  message: string
  onDismiss: () => void
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 6000)
    return () => clearTimeout(timer)
  }, [message, onDismiss])
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-5 bottom-5 z-[80] w-[380px] max-w-[calc(100vw-40px)]"
    >
      <div
        role="status"
        className="pointer-events-auto flex items-start gap-3 rounded-[10px] border bg-card/90 py-3 pr-3 pl-3.5 shadow-[var(--shadow-3)] backdrop-blur-md"
      >
        <span className="flex size-5 flex-none items-center justify-center rounded-full bg-lime text-[#0a0a0b]">
          <Check className="size-3" />
        </span>
        <span className="flex-1 text-sm leading-snug font-medium">
          {message}
        </span>
        <button
          type="button"
          aria-label="Cerrar"
          onClick={onDismiss}
          className="flex size-6 flex-none items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

const COLUMNS = "md:grid-cols-[minmax(180px,2.2fr)_minmax(0,2fr)_132px_148px]"

export function AdminsManager({
  admins,
  currentUserId,
  loadError,
}: {
  admins: AdminRowData[]
  currentUserId: string
  loadError?: string
}) {
  const [addOpen, setAddOpen] = useState(false)
  const [revokeId, setRevokeId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const target = admins.find((admin) => admin.id === revokeId)
  const solo = admins.length === 1
  const count = `${admins.length} ${admins.length === 1 ? "administrador" : "administradores"}`
  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-6 px-5 pt-8 pb-16 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em]">
            Administradores
          </h1>
          <p className="text-sm leading-normal text-fg2">
            Personas con acceso a este panel. Todo lo que hacen queda en la
            bitácora.
          </p>
        </div>
        <Button type="button" onClick={() => setAddOpen(true)}>
          <UserPlus data-icon="inline-start" />
          Agregar administrador
        </Button>
      </div>

      <div className="overflow-hidden rounded-[10px] border bg-card">
        {loadError ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 px-6 py-12 text-center"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-danger-soft text-danger-fg">
              <AlertCircle className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <span className="text-[15px] font-medium">
                No pudimos cargar los administradores
              </span>
              <span className="text-[13px] text-fg2">{loadError}</span>
            </div>
          </div>
        ) : (
          <>
            <div
              className={`hidden h-10 items-center gap-4 border-b bg-surface-sub px-5 text-xs font-medium text-muted-foreground md:grid ${COLUMNS}`}
            >
              <span>Nombre</span>
              <span>Email</span>
              <span>Admin desde</span>
              <span className="text-right">Acciones</span>
            </div>
            <ul>
              {admins.map((admin) => (
                <li
                  key={admin.id}
                  className={`grid items-center gap-x-4 gap-y-1 border-b px-5 py-3 text-sm hover:bg-surface-sub md:h-14 md:py-0 ${COLUMNS}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <UserAvatar
                      name={admin.fullName}
                      photoUrl={admin.photoUrl}
                    />
                    <span className="truncate font-medium">
                      {admin.fullName}
                    </span>
                    {admin.id === currentUserId && (
                      <span className="flex-none rounded-full bg-lime px-2 py-0.5 text-[11px] font-semibold text-[#0a0a0b]">
                        Vos
                      </span>
                    )}
                    {admin.suspended && (
                      <span className="flex-none rounded-full border border-border-strong px-2 py-0.5 text-[11px] font-medium text-fg2">
                        Cuenta no activa
                      </span>
                    )}
                  </div>
                  <span className="truncate text-fg2">{admin.email}</span>
                  <span className="whitespace-nowrap text-fg2 tabular-nums">
                    <span className="md:hidden">Admin desde </span>
                    {admin.since}
                  </span>
                  <div className="flex justify-end">
                    {admin.id !== currentUserId && (
                      <button
                        type="button"
                        aria-label={`Revocar el rol de ${admin.fullName}`}
                        onClick={() => setRevokeId(admin.id)}
                        className="flex h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-fg2 hover:bg-danger-soft hover:text-danger-fg"
                      >
                        <UserMinus className="size-4" />
                        Revocar acceso
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-4 bg-surface-sub px-5 py-3 text-xs text-muted-foreground">
              <span>{count}</span>
              {solo && (
                <span className="flex items-center gap-1.5 text-fg2">
                  <ShieldCheck className="size-3.5" />
                  Siempre tiene que haber al menos un administrador. Sumá a
                  alguien más antes de dejar el panel.
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <AddAdminDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onDone={(name) => setToast(`${name} ahora es administrador.`)}
      />
      <RevokeDialog admin={target} onClose={() => setRevokeId(null)} />
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}
