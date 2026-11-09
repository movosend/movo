import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { notFound } from "next/navigation"
import { ArrowLeft, Car, IdCard, UserRound } from "lucide-react"
import { ApiError } from "@movo/shared/src/errors/api-error"
import type { AdminKycReviewDetail } from "@movo/shared/src/types/admin-kyc"
import { publicError } from "@/lib/auth/api"
import { requireAdmin } from "@/lib/auth/session"
import { sidebarDefaultOpen } from "@/lib/sidebar"
import { getKycReview } from "@/lib/kyc/api"
import { isLongWait, KYC_TYPE_LABEL, waitingLabel } from "@/lib/kyc/format"
import { formatDate, formatDateTime, formatPhone, KYC, type Pill } from "@/lib/users/format"
import { cn } from "@/lib/utils"
import { AdminShell } from "@/components/admin-shell"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { StatusPill } from "@/components/users/ui"
import { CaseIndex } from "@/components/kyc/case-index"
import { CopyChip } from "@/components/kyc/copy-chip"
import { DecisionPanel } from "@/components/kyc/decision-panel"
import {
  EvidenceSection,
  EvidenceSkeleton,
  HeaderAvatar,
  HeaderKpis,
  HeaderPhoto,
} from "@/components/kyc/evidence"
import { KpiStrip, KycSection } from "@/components/kyc/evidence-view"

export const metadata: Metadata = { title: "Revisión de KYC" }

const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/

/** Fila del panel lateral: dato arriba, valor abajo. */
function RailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b py-3 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 text-[13px] break-words">{children}</span>
    </div>
  )
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!SESSION_ID.test(id)) notFound()
  const profile = await requireAdmin(false, `/kyc/${id}`)

  let review: AdminKycReviewDetail | undefined
  let loadError: string | undefined
  try {
    review = await getKycReview(id)
  } catch (error) {
    if (error instanceof ApiError && error.code === "KYC_SESSION_NOT_FOUND") notFound()
    loadError = publicError(error)
  }

  const type = review ? KYC_TYPE_LABEL[review.verificationType] : ""
  // Estado del intento: un `manual_review` que ya no se puede decidir es uno reemplazado por una verificación más nueva.
  const statusPill: Pill | null = review
    ? !review.decidable && review.status === "manual_review"
      ? { label: "Reemplazado", tone: "neutral" }
      : (KYC[review.status] ?? { label: review.status, tone: "neutral" })
    : null
  const inReviewSince = review?.inReviewSince ?? null
  const attempts = review ? review.history.length + 1 : 0
  const TypeIcon = review?.verificationType === "license" ? Car : IdCard

  return (
    <AdminShell
      fullName={profile.fullName}
      email={profile.email}
      photoUrl={profile.photoUrl}
      defaultOpen={await sidebarDefaultOpen()}
      current="/kyc"
      crumb={review ? `${review.fullName} · ${type}` : "Revisión"}
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-5 pt-6 pb-14 md:px-8">
        {loadError && (
          <Alert variant="destructive" className="w-auto">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}
        {review && (
          <>
            {/* ---- Cabecera: foto, nombre, id, decisión y cifras ---- */}
            <header className="relative overflow-hidden rounded-[14px] border bg-card">
              <div aria-hidden className="mv-grid-fade pointer-events-none absolute inset-0" />
              <div
                aria-hidden
                className="mv-dots-fade pointer-events-none absolute top-0 right-0 bottom-0 w-1/2"
              />
              <div className="relative flex flex-col gap-5 px-6 pt-[18px] pb-6">
                <Link
                  href="/kyc"
                  className="flex w-fit items-center gap-1.5 text-[13px] font-medium text-fg2 hover:text-foreground"
                >
                  <ArrowLeft aria-hidden className="size-4" />
                  Volver a la cola
                </Link>
                <div className="flex flex-wrap items-center gap-5">
                  <Suspense fallback={<HeaderAvatar fullName={review.fullName} src={review.photoUrl} />}>
                    <HeaderPhoto
                      sessionId={review.sessionId}
                      fullName={review.fullName}
                      photoUrl={review.photoUrl}
                    />
                  </Suspense>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="mr-1.5 text-[28px] leading-[1.15] font-semibold tracking-[-0.025em]">
                        {review.fullName}
                      </h1>
                      {statusPill && (
                        <StatusPill pill={statusPill} dot className="h-[26px] gap-[7px] px-[11px] text-[13px]" />
                      )}
                      <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-border-strong bg-card px-2.5 text-[13px]">
                        <TypeIcon aria-hidden className="size-3.5" />
                        {type}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-fg2">
                      <CopyChip value={review.sessionId} label="id de la sesión de Didit" />
                      <span aria-hidden className="text-muted-foreground">·</span>
                      {inReviewSince ? (
                        <span className={cn(isLongWait(inReviewSince) && "font-medium text-warn-fg")}>
                          En revisión {waitingLabel(inReviewSince)}
                        </span>
                      ) : (
                        <span>
                          {review.resolvedAt ? `Resuelto el ${formatDateTime(review.resolvedAt)}` : "Ya no está en revisión"}
                        </span>
                      )}
                      <span aria-hidden className="text-muted-foreground">·</span>
                      <span>
                        {attempts} {attempts === 1 ? "intento" : "intentos"}
                      </span>
                    </div>
                  </div>
                  {/* Siempre montado: si se reemplazara al resolverse, el admin perdería la confirmación de su decisión. */}
                  <DecisionPanel
                    decidable={review.decidable}
                    sessionId={review.sessionId}
                    fullName={review.fullName}
                    verificationType={review.verificationType}
                  />
                </div>
              </div>
              <Suspense fallback={<KpiStrip kpis={null} />}>
                <HeaderKpis sessionId={review.sessionId} attempts={attempts} />
              </Suspense>
            </header>

            {/* ---- Cuerpo: índice, secciones y panel lateral ---- */}
            <div className="grid items-start gap-5 min-[1100px]:grid-cols-[210px_minmax(0,1fr)] min-[1440px]:grid-cols-[210px_minmax(0,1fr)_290px]">
              <aside className="sticky top-5 hidden min-[1100px]:block">
                <CaseIndex counts={{ historial: attempts }} />
              </aside>

              <div className="flex min-w-0 flex-col gap-5">
                <Suspense fallback={<EvidenceSkeleton />}>
                  <EvidenceSection sessionId={review.sessionId} />
                </Suspense>

                <KycSection
                  id="historial"
                  title="Intentos"
                  hint={`Verificaciones de ${type.toLowerCase()} de esta persona`}
                  aside={<span className="text-xs text-muted-foreground tabular-nums">{attempts}</span>}
                >
                  <ul>
                    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-surface-sub px-5 py-3 text-[13px]">
                      {statusPill && <StatusPill pill={statusPill} dot />}
                      <span className="font-medium">Este intento</span>
                      <span className="text-fg2">{formatDateTime(review.requestedAt)}</span>
                      <span className="ml-auto font-mono text-xs text-muted-foreground">
                        {review.sessionId.slice(0, 8)}
                      </span>
                    </li>
                    {review.history.map((attempt) => (
                      <li
                        key={attempt.sessionId}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-5 py-3 text-[13px] last:border-b-0"
                      >
                        <StatusPill
                          pill={KYC[attempt.status] ?? { label: attempt.status, tone: "neutral" }}
                          dot
                        />
                        <span className="text-fg2">{formatDateTime(attempt.requestedAt)}</span>
                        {attempt.reason && (
                          <span className="min-w-0 truncate text-muted-foreground">{attempt.reason}</span>
                        )}
                        <span className="ml-auto font-mono text-xs text-muted-foreground">
                          {attempt.sessionId.slice(0, 8)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </KycSection>
              </div>

              <aside className="flex flex-col gap-5 min-[1100px]:col-start-2 min-[1440px]:sticky min-[1440px]:top-5 min-[1440px]:col-start-auto">
                <section aria-labelledby="kyc-rail-title" className="rounded-[14px] border bg-card px-5 pt-4 pb-2">
                  <div className="flex items-center gap-2 border-b pb-3">
                    <UserRound aria-hidden className="size-4 text-muted-foreground" />
                    <h2 id="kyc-rail-title" className="text-sm font-semibold">
                      Persona
                    </h2>
                    <span className="ml-auto truncate font-mono text-xs text-muted-foreground">
                      {review.userId.slice(0, 8)}…
                    </span>
                  </div>
                  <RailRow label="Estado del caso">{statusPill && <StatusPill pill={statusPill} dot />}</RailRow>
                  <RailRow label="Qué marcó Didit">
                    {review.reason ?? <span className="text-muted-foreground">Sin motivo legible</span>}
                  </RailRow>
                  {inReviewSince && <RailRow label="Entró a revisión">{formatDateTime(inReviewSince)}</RailRow>}
                  {review.resolvedAt && <RailRow label="Resuelto">{formatDateTime(review.resolvedAt)}</RailRow>}
                  <RailRow label="Inició la verificación">{formatDateTime(review.requestedAt)}</RailRow>
                  {review.expirationDate && (
                    <RailRow label="Vencimiento del documento">{formatDate(review.expirationDate)}</RailRow>
                  )}
                  <RailRow label="Email">{review.email}</RailRow>
                  <RailRow label="Teléfono">
                    <span className="font-mono text-xs">{formatPhone(review.phone)}</span>
                  </RailRow>
                  <div className="py-3">
                    <Link
                      href={`/users/${review.userId}`}
                      className={cn(buttonVariants({ variant: "outline" }), "w-full")}
                    >
                      Ver la ficha de usuario
                    </Link>
                  </div>
                </section>
                {review.decidable && (
                  <p className="px-1 text-xs leading-relaxed text-muted-foreground">
                    Al decidir, Didit actualiza la sesión, la persona recibe un aviso en la app y queda en la bitácora
                    quién lo hizo y por qué. Atajos: <kbd className="font-sans font-medium">A</kbd> aprobar,{" "}
                    <kbd className="font-sans font-medium">D</kbd> rechazar.
                  </p>
                )}
              </aside>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  )
}
