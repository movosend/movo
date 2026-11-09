import type { ReactNode } from "react"
import {
  CircleCheck,
  CircleMinus,
  CircleX,
  LayoutGrid,
  ScanFace,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react"
import type { AdminKycEvidence } from "@movo/shared/src/types/admin-kyc"
import {
  diditStatusPill,
  documentTypeLabel,
  formatScore,
  genderLabel,
  livenessMethodLabel,
  maritalStatusLabel,
  warningFeatureLabel,
  yesNo,
} from "@/lib/kyc/evidence-format"
import {
  formatDate,
  formatDateTime,
  formatPhone,
  type Pill,
  type Tone,
} from "@/lib/users/format"
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { IconTile, SectionEmpty, StatusPill } from "@/components/users/ui"
import { cn } from "@/lib/utils"
import { KYC_SECTIONS, sectionAnchor, type KycSectionId } from "@/lib/kyc/sections"
import { SummaryPhotos, ZoomablePhoto, type GalleryPhoto } from "./photo-gallery"

// ---- Secciones ----

/** Marco de cada sección, como el de la ficha de usuario: ícono, título, pista y un `aside` a la derecha. */
export function KycSection({
  id,
  title,
  hint,
  aside,
  children,
}: {
  id: KycSectionId
  title: string
  hint?: ReactNode
  aside?: ReactNode
  children: ReactNode
}) {
  const Icon = KYC_SECTIONS.find((s) => s.id === id)?.icon ?? LayoutGrid
  return (
    <section
      id={sectionAnchor(id)}
      aria-labelledby={`${sectionAnchor(id)}-title`}
      className="scroll-mt-5 rounded-[14px] border bg-card"
    >
      <header className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
        <IconTile>
          <Icon aria-hidden />
        </IconTile>
        <div className="flex min-w-0 flex-col">
          <h2
            id={`${sectionAnchor(id)}-title`}
            className="text-[15px] leading-tight font-semibold"
          >
            {title}
          </h2>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
        {aside && (
          <>
            <span className="flex-1" />
            {aside}
          </>
        )}
      </header>
      {children}
    </section>
  )
}

// ---- Helpers ----

const joinWith = (separator: string, parts: (string | null)[]) => {
  const kept = parts.filter((part): part is string => part !== null)
  return kept.length > 0 ? kept.join(separator) : null
}
/** Varios datos en una línea: "97 % · selfie frente al documento". */
const join = (...parts: (string | null)[]) => joinWith(" · ", parts)
/** Un lugar: "Córdoba, Argentina". */
const place = (...parts: (string | null)[]) => joinWith(", ", parts)

const TONE_ICON: Record<Tone, { icon: LucideIcon; className: string }> = {
  success: { icon: CircleCheck, className: "text-success-fg" },
  warning: { icon: TriangleAlert, className: "text-warn-fg" },
  danger: { icon: CircleX, className: "text-danger-fg" },
  info: { icon: CircleMinus, className: "text-info-fg" },
  neutral: { icon: CircleMinus, className: "text-muted-foreground" },
}

/** Ícono de estado al final de cada fila, como en Didit, con el texto para lectores de pantalla. */
function StatusIcon({ pill }: { pill: Pill | null }) {
  if (!pill) return <span aria-hidden className="size-[18px]" />
  const { icon: Icon, className } = TONE_ICON[pill.tone]
  return (
    <span title={pill.label} className="flex items-center">
      <Icon aria-hidden className={cn("size-[18px]", className)} />
      <span className="sr-only">{pill.label}</span>
    </span>
  )
}

type Check = {
  label: string
  /** Lo principal, corto: "94 %", "Sin coincidencias". */
  value: string | null
  /** El detalle, en gris debajo: "Selfie frente al documento". */
  sub: string | null
  pill: Pill | null
}

function checksOf(evidence: AdminKycEvidence): Check[] {
  const { document, faceMatch, liveness, ip, aml, phone, email } = evidence
  const method = livenessMethodLabel(liveness?.method ?? null)
  return [
    faceMatch && {
      label: "Coincidencia facial",
      value: formatScore(faceMatch.score),
      sub: "Selfie frente al documento",
      pill: diditStatusPill(faceMatch.status),
    },
    liveness && {
      label: "Prueba de vida",
      value: formatScore(liveness.score),
      sub: method ? `Prueba ${method.toLowerCase()}` : null,
      pill: diditStatusPill(liveness.status),
    },
    document && {
      label: "Documento",
      value: join(documentTypeLabel(document.type), document.issuingCountry),
      sub: document.expirationDate ? `Válido hasta ${formatDate(document.expirationDate)}` : null,
      pill: diditStatusPill(document.status),
    },
    aml && {
      label: "AML",
      value:
        aml.totalHits === null
          ? null
          : aml.totalHits === 0
            ? "Sin coincidencias"
            : `${aml.totalHits} ${aml.totalHits === 1 ? "coincidencia" : "coincidencias"}`,
      sub: "Listas de sanciones y PEP",
      pill: diditStatusPill(aml.status),
    },
    ip && {
      label: "Dirección IP",
      value: ip.address,
      sub: join(place(ip.city, ip.country), ip.isVpnOrTor ? "VPN o Tor" : null),
      pill: diditStatusPill(ip.status),
    },
    phone && {
      label: "Teléfono",
      value: phone.value ? formatPhone(phone.value.replace(/\s+/g, "")) : null,
      sub: phone.country,
      pill: diditStatusPill(phone.status),
    },
    email && {
      label: "Email",
      value: email.value,
      sub: null,
      pill: diditStatusPill(email.status),
    },
  ].filter((check): check is Check => Boolean(check))
}

/** Las caras de la verificación: la selfie y la foto del documento (los documentos enteros tienen su sección). */
const facesOf = (evidence: AdminKycEvidence): GalleryPhoto[] =>
  [
    { key: "selfie", label: "Selfie", url: evidence.images.selfie },
    { key: "portrait", label: "Foto del documento", url: evidence.images.documentPortrait },
  ].filter((photo): photo is GalleryPhoto => photo.url !== null)

/** Hora de vencimiento de los links, en hora argentina. */
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Cordoba",
  })

// ---- Cifras de la cabecera ----

type Kpi = { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "bad" }

export function kpisOf(evidence: AdminKycEvidence, attempts: number): Kpi[] {
  const toneOf = (status: string | null): Kpi["tone"] => {
    const tone = diditStatusPill(status)?.tone
    return tone === "success" ? "ok" : tone === "danger" ? "bad" : tone === "warning" ? "warn" : undefined
  }
  const alerts = evidence.warnings.length
  return [
    {
      label: "Coincidencia facial",
      value: formatScore(evidence.faceMatch?.score ?? null) ?? "—",
      sub: evidence.faceMatch ? "selfie vs. documento" : "sin dato",
      tone: toneOf(evidence.faceMatch?.status ?? null),
    },
    {
      label: "Prueba de vida",
      value: formatScore(evidence.liveness?.score ?? null) ?? "—",
      sub: livenessMethodLabel(evidence.liveness?.method ?? null)?.toLowerCase() ?? "sin dato",
      tone: toneOf(evidence.liveness?.status ?? null),
    },
    {
      label: "Alertas de Didit",
      value: String(alerts),
      sub: alerts === 0 ? "ninguna" : alerts === 1 ? "para revisar" : "para revisar",
      tone: alerts === 0 ? "ok" : "warn",
    },
    {
      label: "Intentos",
      value: String(attempts),
      sub: attempts === 1 ? "el primero" : "con este",
    },
  ]
}

const KPI_TONE: Record<NonNullable<Kpi["tone"]>, string> = {
  ok: "bg-success-soft text-success-fg",
  warn: "bg-warn-soft text-warn-fg",
  bad: "bg-danger-soft text-danger-fg",
}
const KPI_ICON: Record<NonNullable<Kpi["tone"]>, LucideIcon> = {
  ok: CircleCheck,
  warn: TriangleAlert,
  bad: CircleX,
}

/** Cuatro cifras al pie de la cabecera, como la tira de la ficha de usuario. */
export function KpiStrip({ kpis }: { kpis: Kpi[] | null }) {
  return (
    <div className="grid grid-cols-2 gap-px border-t bg-border min-[1100px]:grid-cols-4">
      {(kpis ?? Array.from({ length: 4 }, () => null)).map((kpi, index) => {
        const Icon = kpi?.tone ? KPI_ICON[kpi.tone] : ScanFace
        return (
          <div key={kpi?.label ?? index} className="flex items-center gap-3 bg-card px-5 py-3.5">
            <span
              className={cn(
                "flex size-[38px] flex-none items-center justify-center rounded-[9px]",
                kpi?.tone ? KPI_TONE[kpi.tone] : "bg-muted text-foreground"
              )}
            >
              <Icon aria-hidden className="size-[18px]" />
            </span>
            <span className="flex min-w-0 flex-col gap-[3px]">
              {kpi ? (
                <>
                  <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                    {kpi.label}
                  </span>
                  <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                    <span className="text-[19px] leading-[1.1] font-semibold tracking-[-0.01em] tabular-nums">
                      {kpi.value}
                    </span>
                    {kpi.sub && <span className="text-xs text-muted-foreground">{kpi.sub}</span>}
                  </span>
                </>
              ) : (
                <>
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-[19px] w-14" />
                </>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ---- Secciones ----

/** Resumen: la cara y lo que Didit comprobó, de un vistazo. */
export function EvidenceSummary({ evidence }: { evidence: AdminKycEvidence }) {
  const faces = facesOf(evidence)
  const checks = checksOf(evidence)
  const sessionPill = diditStatusPill(evidence.sessionStatus)
  return (
    <KycSection
      id="resumen"
      title="Resumen"
      hint="Quién es y qué comprobó Didit"
      aside={
        sessionPill ? (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            Estado en Didit <StatusPill pill={sessionPill} dot />
          </span>
        ) : undefined
      }
    >
      <div className="grid gap-6 p-5 sm:grid-cols-[148px_minmax(0,1fr)]">
        {faces.length > 0 ? (
          <SummaryPhotos photos={faces} />
        ) : (
          <div className="flex aspect-[3/4] w-[148px] items-center justify-center rounded-2xl border border-dashed bg-surface-sub p-3 text-center text-xs text-muted-foreground">
            Didit no devolvió fotos del rostro.
          </div>
        )}
        <div className="flex min-w-0 flex-col">
          <span className="pb-1 text-sm font-semibold">Identidad</span>
          {checks.length > 0 ? (
            <ul>
              {checks.map((check) => (
                <li
                  key={check.label}
                  className="grid grid-cols-[minmax(0,128px)_minmax(0,1fr)_auto] items-center gap-3 border-b py-2.5 text-[13px] last:border-b-0"
                >
                  <span className="text-muted-foreground">{check.label}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium" title={check.value ?? undefined}>
                      {check.value ?? "—"}
                    </span>
                    {check.sub && <span className="truncate text-xs text-muted-foreground">{check.sub}</span>}
                  </span>
                  <StatusIcon pill={check.pill} />
                </li>
              ))}
            </ul>
          ) : (
            <SectionEmpty
              icon={ShieldAlert}
              title="Didit no informó comprobaciones"
              text="La sesión no trae resultados de coincidencia facial, prueba de vida ni documento."
            />
          )}
        </div>
      </div>
      <p className="border-t px-5 py-3 text-xs text-muted-foreground">
        Movo pide las fotos y los datos a Didit cada vez que abrís el caso y no los guarda. Los links de las fotos vencen a
        las {hhmm(evidence.imagesExpireAt)}; si no cargan, recargá la página.
      </p>
    </KycSection>
  )
}

type Row = {
  label: string
  value: ReactNode | null
  /** Ocupa toda la fila (un domicilio largo). */
  wide?: boolean
}

/**
 * Datos en celdas "etiqueta arriba, valor abajo". El ancho de la columna central cambia con el índice y el panel lateral,
 * así que la grilla se adapta al ancho de la tarjeta (container query) y no al de la pantalla: 2 columnas si es angosta,
 * 3 si hay lugar. Solo muestra lo que Didit informó.
 */
function FactRows({ rows }: { rows: Row[] }) {
  const shown = rows.filter((row) => row.value !== null && row.value !== "")
  if (shown.length === 0) return null
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 @xl:grid-cols-3">
      {shown.map((row) => (
        <div
          key={row.label}
          className={cn("flex min-w-0 flex-col gap-1", row.wide && "col-span-2 @xl:col-span-3")}
        >
          <dt className="text-xs text-muted-foreground">{row.label}</dt>
          <dd className="text-[13px] font-medium text-pretty">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Perfil: lo que Didit leyó del documento y las dos caras que comparó. */
export function EvidenceProfile({ evidence }: { evidence: AdminKycEvidence }) {
  const { document, images, faceMatch } = evidence
  if (!document) return null
  const faces: GalleryPhoto[] = [
    { key: "selfie", label: "Selfie", url: images.selfie },
    { key: "portrait", label: "Foto del documento", url: images.documentPortrait },
  ].filter((photo): photo is GalleryPhoto => photo.url !== null)
  const type = documentTypeLabel(document.type)
  return (
    <KycSection
      id="perfil"
      title="Perfil"
      hint={type ? `Extraído de ${type.toLowerCase()}` : "Extraído del documento"}
    >
      <div className="@container p-5">
        <div className="grid gap-6 @2xl:grid-cols-[minmax(0,1fr)_auto]">
          <FactRows
            rows={[
              { label: "Nombre", value: document.firstName },
              { label: "Apellidos", value: document.lastName },
              {
                // Solo si agrega algo: si es nombre + apellidos, ya están arriba.
                label: "Nombre completo",
                value:
                  document.fullName &&
                  document.fullName !== joinWith(" ", [document.firstName, document.lastName])
                    ? document.fullName
                    : null,
              },
              {
                label: "Fecha de nacimiento",
                value: document.dateOfBirth ? formatDate(document.dateOfBirth) : null,
              },
              { label: "Edad", value: document.age !== null ? `${document.age} años` : null },
              { label: "Género", value: genderLabel(document.gender) },
              { label: "Nacionalidad", value: document.nationality },
              { label: "Tipo de documento", value: type },
              { label: "País emisor", value: document.issuingCountry },
              {
                label: "Número de documento",
                value: document.number && <span className="font-mono text-xs">{document.number}</span>,
              },
              {
                label: "Número personal",
                value: document.personalNumber && (
                  <span className="font-mono text-xs">{document.personalNumber}</span>
                ),
              },
              { label: "Expedido", value: document.issueDate ? formatDate(document.issueDate) : null },
              {
                label: "Caduca",
                value: document.expirationDate ? formatDate(document.expirationDate) : null,
              },
              { label: "Lugar de nacimiento", value: document.placeOfBirth },
              { label: "Estado civil", value: maritalStatusLabel(document.maritalStatus) },
              { label: "Domicilio", value: document.address, wide: true },
            ]}
          />
          {faces.length > 0 && (
            <div className="flex flex-col gap-2 @2xl:border-l @2xl:pl-6">
              <span className="text-xs text-muted-foreground">Fotos del rostro</span>
              <div className="flex gap-2.5">
                {faces.map((photo) => (
                  <figure key={photo.key} className="flex w-[104px] flex-col gap-1.5">
                    <ZoomablePhoto photo={photo} className="aspect-[3/4] w-full" />
                    <figcaption className="truncate text-xs text-fg2">{photo.label}</figcaption>
                  </figure>
                ))}
              </div>
              {faceMatch?.score !== null && faceMatch?.score !== undefined && (
                <span className="text-xs text-fg2">
                  Coincidencia facial{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {formatScore(faceMatch.score)}
                  </span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </KycSection>
  )
}

/** Documentos: frente y dorso enteros, sin recortar. */
export function EvidenceDocuments({ evidence }: { evidence: AdminKycEvidence }) {
  const docs: GalleryPhoto[] = [
    { key: "front", label: "Documento, frente", url: evidence.images.documentFront },
    { key: "back", label: "Documento, dorso", url: evidence.images.documentBack },
  ].filter((photo): photo is GalleryPhoto => photo.url !== null)
  if (docs.length === 0) return null
  return (
    <KycSection
      id="documentos"
      title="Documentos"
      hint={documentTypeLabel(evidence.document?.type ?? null) ?? undefined}
      aside={<span className="text-xs text-muted-foreground tabular-nums">{docs.length}</span>}
    >
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        {docs.map((photo) => (
          <figure key={photo.key} className="flex flex-col gap-2">
            <ZoomablePhoto photo={photo} fit="contain" className="aspect-[16/10] w-full bg-surface-sub" />
            <figcaption className="text-xs text-fg2">{photo.label}</figcaption>
          </figure>
        ))}
      </div>
    </KycSection>
  )
}

/** Red y dispositivo: desde dónde y con qué hizo la verificación. */
export function EvidenceNetwork({ evidence }: { evidence: AdminKycEvidence }) {
  const { ip } = evidence
  if (!ip) return null
  return (
    <KycSection
      id="red"
      title="Red y dispositivo"
      hint="Desde dónde se hizo la verificación"
      aside={
        ip.isVpnOrTor ? (
          <StatusPill pill={{ label: "VPN o Tor", tone: "warning" }} dot />
        ) : undefined
      }
    >
      <div className="@container p-5">
        <FactRows
          rows={[
            {
              label: "Dirección IP",
              value: ip.address && <span className="font-mono text-xs">{ip.address}</span>,
            },
            { label: "Ubicación", value: place(ip.city, ip.region, ip.country) },
            { label: "VPN o Tor", value: yesNo(ip.isVpnOrTor) },
            { label: "Centro de datos", value: yesNo(ip.isDataCenter) },
            { label: "Plataforma", value: ip.platform },
            { label: "Navegador", value: ip.browser },
            { label: "Sistema operativo", value: ip.os },
            { label: "Dispositivo", value: ip.device },
          ]}
        />
      </div>
    </KycSection>
  )
}

/** Alertas que marcó Didit y, si hubo, las revisiones de su equipo. */
export function EvidenceAlerts({ evidence }: { evidence: AdminKycEvidence }) {
  const count = evidence.warnings.length
  return (
    <KycSection
      id="alertas"
      title="Alertas de Didit"
      hint={count === 0 ? "Ninguna" : "Lo que hizo que la sesión pase a revisión"}
      aside={
        count > 0 ? (
          <StatusPill pill={{ label: String(count), tone: "warning" }} />
        ) : undefined
      }
    >
      {count === 0 ? (
        <p className="px-5 py-4 text-sm text-fg2">Didit no marcó alertas en ninguna verificación.</p>
      ) : (
        <ul>
          {evidence.warnings.map((warning, index) => (
            <li
              key={`${warning.feature}-${warning.risk}-${index}`}
              className="flex items-start gap-3 border-b px-5 py-3.5 text-[13px] last:border-b-0"
            >
              <span className="flex size-7 flex-none items-center justify-center rounded-lg bg-warn-soft text-warn-fg">
                <TriangleAlert aria-hidden className="size-3.5" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{warning.description}</span>
                <span className="text-xs text-muted-foreground">
                  {warningFeatureLabel(warning.feature)} · <span className="font-mono">{warning.risk}</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {evidence.reviews.length > 0 && (
        <div className="border-t px-5 py-4">
          <span className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Revisiones en Didit
          </span>
          <ul className="mt-2 flex flex-col gap-2">
            {evidence.reviews.map((review, index) => {
              const pill = diditStatusPill(review.status)
              return (
                <li
                  key={`${review.createdAt}-${index}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]"
                >
                  {pill && <StatusPill pill={pill} />}
                  {review.createdAt && <span className="text-fg2">{formatDateTime(review.createdAt)}</span>}
                  {review.comment && <span>{review.comment}</span>}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </KycSection>
  )
}

/** Todo el detalle de Didit, en el orden del índice. Pura (sin pedir nada) para poder probarla con datos fijos. */
export function EvidenceView({ evidence }: { evidence: AdminKycEvidence }) {
  return (
    <>
      <EvidenceSummary evidence={evidence} />
      <EvidenceProfile evidence={evidence} />
      <EvidenceDocuments evidence={evidence} />
      <EvidenceNetwork evidence={evidence} />
      <EvidenceAlerts evidence={evidence} />
    </>
  )
}

export function EvidenceSkeleton() {
  return (
    <SkeletonGroup label="Pidiendo el detalle a Didit…" className="flex flex-col gap-5">
      <div className="rounded-[14px] border bg-card">
        <div className="flex items-center gap-3 border-b px-5 py-4">
          <Skeleton className="size-[30px] rounded-lg" />
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="flex gap-6 p-5">
          <Skeleton className="aspect-[3/4] w-[148px] rounded-2xl" />
          <div className="flex flex-1 flex-col gap-4 pt-7">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="size-[18px] rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <Skeleton className="h-64 w-full rounded-[14px]" />
    </SkeletonGroup>
  )
}
