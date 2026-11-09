import Link from "next/link"
import { ApiError } from "@movo/shared/src/errors/api-error"
import type { AdminKycEvidence } from "@movo/shared/src/types/admin-kyc"
import { publicError } from "@/lib/auth/api"
import { getKycEvidence } from "@/lib/kyc/api"
import { initialsOf } from "@/lib/initials"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { EvidenceSkeleton, EvidenceView, KpiStrip, kpisOf } from "./evidence-view"

export { EvidenceSkeleton }

/** Mensaje para cuando no se pudo traer el detalle de Didit: el caso se puede decidir igual con lo que ya hay en la página. */
export function evidenceErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "KYC_EVIDENCE_NOT_FOUND")
      return "Didit no tiene detalle de esta sesión (por ejemplo, si la eliminaron). Podés decidir con lo que marcó Didit o abrirla en su consola."
    if (error.code === "KYC_PROVIDER_ERROR")
      return "No pudimos consultar a Didit. Probá de nuevo en un momento."
  }
  return publicError(error)
}

async function tryEvidence(
  sessionId: string
): Promise<{ ok: true; evidence: AdminKycEvidence } | { ok: false; error: unknown }> {
  try {
    return { ok: true, evidence: await getKycEvidence(sessionId) }
  } catch (error) {
    return { ok: false, error }
  }
}

/** Las secciones del caso. Va dentro de un Suspense: si Didit tarda o falla, la cabecera y la decisión ya están en pantalla. */
export async function EvidenceSection({ sessionId }: { sessionId: string }) {
  const result = await tryEvidence(sessionId)
  if (!result.ok)
    return (
      <Alert variant="destructive" className="w-auto">
        <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {evidenceErrorMessage(result.error)}
          <Link
            href={`/kyc/${encodeURIComponent(sessionId)}`}
            className="font-medium underline underline-offset-4"
          >
            Reintentar
          </Link>
        </AlertDescription>
      </Alert>
    )
  return <EvidenceView evidence={result.evidence} />
}

/** Foto de la cabecera: la selfie de Didit; si no hay, la foto de perfil de Movo; si tampoco, las iniciales. */
export async function HeaderPhoto({
  sessionId,
  fullName,
  photoUrl,
}: {
  sessionId: string
  fullName: string
  photoUrl: string | null
}) {
  const result = await tryEvidence(sessionId)
  const selfie = result.ok ? result.evidence.images.selfie : null
  return <HeaderAvatar fullName={fullName} src={selfie ?? photoUrl} />
}

export function HeaderAvatar({ fullName, src }: { fullName: string; src: string | null }) {
  return (
    <Avatar aria-hidden className="size-[72px] flex-none ring-4 ring-card shadow-[var(--shadow-3)]">
      {src && <AvatarImage src={src} alt="" referrerPolicy="no-referrer" className="object-cover" />}
      <AvatarFallback className="bg-avatar text-xl font-semibold text-foreground">
        {initialsOf(fullName)}
      </AvatarFallback>
    </Avatar>
  )
}

/** Cifras de la cabecera; si Didit no respondió, solo el número de intentos (que es de Movo). */
export async function HeaderKpis({ sessionId, attempts }: { sessionId: string; attempts: number }) {
  const result = await tryEvidence(sessionId)
  if (result.ok) return <KpiStrip kpis={kpisOf(result.evidence, attempts)} />
  return (
    <KpiStrip
      kpis={[
        { label: "Coincidencia facial", value: "—", sub: "Didit no respondió" },
        { label: "Prueba de vida", value: "—", sub: "Didit no respondió" },
        { label: "Alertas de Didit", value: "—", sub: "Didit no respondió" },
        { label: "Intentos", value: String(attempts), sub: attempts === 1 ? "el primero" : "con este" },
      ]}
    />
  )
}
