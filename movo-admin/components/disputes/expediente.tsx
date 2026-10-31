import Link from "next/link"
import type { ReactNode } from "react"
import {
  ArrowLeft,
  Bot,
  Camera,
  Fingerprint,
  Gavel,
  MessageSquareText,
  Radar,
  UsersRound,
} from "lucide-react"
import type { DisputePhoto } from "@movo/shared/src/types/dispute"
import { disputeFinalShipmentStatus } from "@movo/shared/src/config/dispute-resolution"
import type {
  AdminDisputeHandshakeEvent,
  AdminDisputePhotos,
  AdminDisputeResolution,
} from "@movo/shared/src/types/admin-disputes"
import type {
  AdminDisputeAttribution,
  AdminDisputeDetail,
  AdminDisputePartyHistory,
} from "@movo/shared/src/types/admin-disputes"
import type { AdminBlock } from "@movo/shared/src/types/admin-shipments"
import {
  ageLabel,
  DISPUTE_REASON_LABEL,
  DISPUTE_STATUS_PILL,
  FINAL_STATUS_LABEL,
  isSystemReason,
  OUTCOME_LABEL,
  PARTY_ROLE_LABEL,
  PAYMENT_ACTION_LABEL,
  splitLine,
} from "@/lib/disputes/format"
import { formatDateTime } from "@/lib/users/format"
import { shipmentDisplayCode } from "@/lib/shipments/format"
import { cn } from "@/lib/utils"
import { BlockError } from "@/components/shipments/block-error"
import { IconTile, StatusPill } from "@/components/users/ui"

const card = "flex flex-col gap-3.5 rounded-[10px] border bg-card p-[18px]"

/** Marco de un bloque del expediente: ícono, título y, a la derecha, un `aside` opcional. */
export function DisputeCard({
  id,
  icon: Icon,
  title,
  aside,
  children,
}: {
  id: string
  icon: React.ComponentType<{ "aria-hidden"?: boolean }>
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-labelledby={`${id}-title`} className={card}>
      <header className="flex items-center gap-2.5">
        <IconTile>
          <Icon aria-hidden />
        </IconTile>
        <h2 id={`${id}-title`} className="text-[15px] font-semibold">
          {title}
        </h2>
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

export function ExpedienteHeader({
  dispute,
  backHref,
  now,
  actions,
}: {
  dispute: AdminDisputeDetail
  backHref: string
  now: Date
  actions?: ReactNode
}) {
  const system = isSystemReason(dispute.reason)
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-2.5">
        <Link
          href={backHref}
          className="flex items-center gap-1.5 self-start rounded text-[13px] font-medium text-fg2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Volver a la bandeja
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em]">
            Disputa{" "}
            <span className="font-mono">
              {shipmentDisplayCode(dispute.shipmentId)}
            </span>
          </h1>
          <StatusPill
            pill={DISPUTE_STATUS_PILL[dispute.status]}
            className="h-[26px] px-[11px] text-[13px]"
          />
          <span
            className={cn(
              "inline-flex h-[26px] items-center gap-1 rounded-full px-[11px] text-[13px] font-medium",
              system
                ? "border border-dashed border-border-strong bg-card text-fg2"
                : "bg-muted text-fg2"
            )}
          >
            {system && <Bot aria-hidden className="size-3.5" />}
            {DISPUTE_REASON_LABEL[dispute.reason]}
          </span>
        </div>
        <span className="text-sm text-fg2">
          {dispute.pickupCity ?? "Sin ciudad"} · abierta{" "}
          {formatDateTime(dispute.openedAt)}
          {dispute.status === "open" && ` · ${ageLabel(dispute.openedAt, now)}`}
          {" · "}
          <Link
            href={`/shipments/${dispute.shipmentId}`}
            className="font-medium underline underline-offset-4 hover:text-foreground"
          >
            Ver el envío
          </Link>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  )
}

function Photos({
  photos,
}: {
  photos: Array<Pick<DisputePhoto, "id" | "url">>
}) {
  if (photos.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-2">
      {photos.map((photo, i) => (
        <li key={photo.id}>
          <a
            href={photo.url}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={`Foto ${i + 1}`}
              className="size-24 object-cover"
              loading="lazy"
            />
          </a>
        </li>
      ))}
    </ul>
  )
}

const roleOf = (
  dispute: AdminDisputeDetail,
  role: "sender" | "receiver" | "carrier"
) =>
  (role === "sender"
    ? dispute.sender
    : role === "receiver"
      ? dispute.receiver
      : dispute.carrier
  )?.name ?? "Sin nombre"

/** La disputa: quién y qué reclamó, sus fotos y los descargos (el de quien abrió es la ampliación). */
export function DisputeCaseCard({
  dispute,
}: {
  dispute: AdminDisputeDetail
}) {
  const system = isSystemReason(dispute.reason)
  const entries = [
    {
      key: "opening",
      who: system ? "Sistema" : roleOf(dispute, dispute.openedByRole!),
      role: system
        ? "barrido automático"
        : PARTY_ROLE_LABEL[dispute.openedByRole!],
      at: dispute.openedAt,
      text: dispute.description,
      photos: dispute.photos,
      system,
    },
    ...dispute.statements.map((s) => ({
      key: s.id,
      who: roleOf(dispute, s.authorRole),
      role:
        s.kind === "amendment"
          ? `${PARTY_ROLE_LABEL[s.authorRole]} · ampliación`
          : `${PARTY_ROLE_LABEL[s.authorRole]} · descargo`,
      at: s.createdAt,
      text: s.text,
      photos: s.photos,
      system: false,
    })),
  ]
  const expected = dispute.carrier && dispute.openedByRole !== null ? 2 : 1
  const given = dispute.statements.filter((s) => s.kind === "statement").length
  return (
    <DisputeCard
      id="caso"
      icon={MessageSquareText}
      title="Disputa y descargos"
      aside={
        !system && (
          <span className="text-xs text-muted-foreground">
            Descargos {given} de {expected}
          </span>
        )
      }
    >
      <ol className="flex flex-col gap-4">
        {entries.map((entry) => (
          <li key={entry.key} className="flex gap-3">
            <span
              aria-hidden
              className={cn(
                "flex size-9 flex-none items-center justify-center rounded-full text-xs font-semibold",
                entry.system
                  ? "border border-dashed border-border-strong text-fg2"
                  : "bg-muted"
              )}
            >
              {entry.system ? (
                <Bot className="size-4" />
              ) : (
                entry.who.slice(0, 2).toUpperCase()
              )}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                <span className="font-medium">{entry.who}</span>
                <span className="text-muted-foreground">
                  {entry.role} · {formatDateTime(entry.at)}
                </span>
              </span>
              <p className="text-sm leading-[1.55] text-pretty whitespace-pre-wrap">
                {entry.text}
              </p>
              <Photos photos={entry.photos} />
            </div>
          </li>
        ))}
        {!system && given === 0 && (
          <li className="rounded-lg border border-dashed px-3.5 py-3 text-[13px] text-fg2">
            Todavía no hay descargos de las otras partes.
          </li>
        )}
      </ol>
    </DisputeCard>
  )
}

const CLASS_LABEL = {
  arrival: "Llegó",
  far: "Lejos",
  gray: "Zona gris",
} as const

/** Disputas del sistema: a quién atribuyó el barrido y con qué datos (DD-045, DD-052). */
export function AttributionCard({
  attribution,
}: {
  attribution: AdminDisputeAttribution
}) {
  const who =
    attribution.attributedTo === null
      ? "Sin atribución"
      : `Atribuido al ${PARTY_ROLE_LABEL[attribution.attributedTo]}`
  return (
    <DisputeCard
      id="atribucion"
      icon={Radar}
      title="Qué detectó el sistema"
      aside={<StatusPill pill={{ label: who, tone: "neutral" }} />}
    >
      <p className="text-sm leading-[1.55] text-pretty">
        {attribution.summary}
      </p>
      <span className="text-xs text-muted-foreground">
        Barrido del {formatDateTime(attribution.sweptAt)}
        {attribution.lastPingAt &&
          ` · último ping ${formatDateTime(attribution.lastPingAt)}`}
      </span>
      {attribution.positions.length > 0 && (
        <table className="w-full text-left text-[13px]">
          <caption className="sr-only">Posiciones del transportista</caption>
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1.5 font-medium">Hora</th>
              <th className="py-1.5 font-medium">Precisión</th>
              <th className="py-1.5 font-medium">Clasificación</th>
            </tr>
          </thead>
          <tbody>
            {attribution.positions.map((p) => (
              <tr key={p.capturedAt} className="border-t">
                <td className="py-1.5">{formatDateTime(p.capturedAt)}</td>
                <td className="py-1.5 tabular-nums">±{p.accuracyM} m</td>
                <td className="py-1.5">{CLASS_LABEL[p.class]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </DisputeCard>
  )
}

const STAGE_LABEL: Record<string, string> = {
  pickup: "Retiro",
  delivery: "Entrega",
}

/** Eventos del handshake de custodia con la distancia medida entre las partes. */
export function HandshakeCard({
  handshake,
}: {
  handshake: AdminBlock<AdminDisputeHandshakeEvent[]>
}) {
  return (
    <DisputeCard id="handshake" icon={Fingerprint} title="Handshake">
      {handshake.error ? (
        <BlockError
          noun="el handshake"
          code={handshake.error.code}
          scope="expediente"
        />
      ) : handshake.data.length === 0 ? (
        <p className="text-[13px] text-fg2">
          No hubo handshake: el paquete nunca cambió de manos.
        </p>
      ) : (
        <ul className="flex flex-col gap-3.5">
          {handshake.data.map((h) => (
            <li key={h.id} className="flex items-start gap-3 text-[13px]">
              <span
                aria-hidden
                className={cn(
                  "mt-[5px] size-2.5 flex-none bg-foreground",
                  h.stage === "pickup" ? "rounded-[2px]" : "rounded-full"
                )}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">
                  {STAGE_LABEL[h.stage] ?? h.stage} confirmado
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(h.createdAt)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {h.distanceM} m entre las partes
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </DisputeCard>
  )
}

const STAGE_PHOTO: Record<string, string> = {
  creation: "Publicación",
  pickup: "Retiro",
  delivery: "Entrega",
}

/** Fotos del envío (publicación, retiro y entrega). Las de la disputa están en su propio bloque. */
export function PhotosCard({
  photos,
}: {
  photos: AdminBlock<AdminDisputePhotos>
}) {
  return (
    <DisputeCard id="fotos" icon={Camera} title="Fotos del envío">
      {photos.error ? (
        <BlockError
          noun="las fotos"
          code={photos.error.code}
          scope="expediente"
        />
      ) : photos.data.length === 0 ? (
        <p className="text-[13px] text-fg2">El envío no tiene fotos.</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {photos.data.map((photo) => (
            <li key={photo.id} className="flex flex-col gap-1">
              <Photos photos={[photo]} />
              <span className="text-xs text-muted-foreground">
                {STAGE_PHOTO[photo.stage] ?? photo.stage}
              </span>
            </li>
          ))}
        </ul>
      )}
    </DisputeCard>
  )
}

/** Cuántas disputas abrió, perdió y tiene abiertas cada parte, con link a su ficha. */
export function PartyHistoryCard({
  dispute,
}: {
  dispute: AdminDisputeDetail
}) {
  const nameOf = (h: AdminDisputePartyHistory) =>
    [dispute.sender, dispute.carrier, dispute.receiver].find(
      (p) => p?.id === h.userId
    )?.name ?? "Sin nombre"
  return (
    <DisputeCard
      id="historial"
      icon={UsersRound}
      title="Historial de las partes"
    >
      {dispute.partyHistory.length === 0 ? (
        <p className="text-[13px] text-fg2">Sin historial para mostrar.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {dispute.partyHistory.map((h) => (
            <li
              key={h.userId}
              className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0"
            >
              <span className="flex items-baseline gap-2">
                <Link
                  href={`/users/${h.userId}`}
                  className="text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {nameOf(h)}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {PARTY_ROLE_LABEL[h.role]}
                </span>
              </span>
              <span className="flex flex-wrap gap-1.5 text-xs">
                {(
                  [
                    ["Abrió", h.opened],
                    ["Perdió", h.lost],
                    ["Abiertas", h.open],
                  ] as const
                ).map(([label, n]) => (
                  <span
                    key={label}
                    className="rounded-full bg-muted px-2 py-0.5 text-fg2 tabular-nums"
                  >
                    {label}{" "}
                    <span className="font-medium text-foreground">{n}</span>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </DisputeCard>
  )
}

/** Cómo quedó resuelta: resultado, reparto, qué se ejecutó, el razonamiento y quién lo decidió. */
export function ResolutionCard({
  dispute,
  resolution,
}: {
  dispute: AdminDisputeDetail
  resolution: AdminDisputeResolution
}) {
  const final = disputeFinalShipmentStatus(resolution.outcome)
  return (
    <DisputeCard
      id="resolucion"
      icon={Gavel}
      title="Resolución"
      aside={<StatusPill pill={DISPUTE_STATUS_PILL[dispute.status]} />}
    >
      <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Resultado</dt>
          <dd className="font-medium">{OUTCOME_LABEL[resolution.outcome]}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">El envío quedó</dt>
          <dd className="font-medium">{FINAL_STATUS_LABEL[final]}</dd>
        </div>
        <div className="flex flex-col gap-0.5 sm:col-span-2">
          <dt className="text-xs text-muted-foreground">Reparto</dt>
          <dd className="font-medium">
            {splitLine(
              resolution.outcome,
              roleOf(dispute, "carrier"),
              roleOf(dispute, "sender"),
              resolution.carrierAmountArs,
              resolution.senderAmountArs
            )}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5 sm:col-span-2">
          <dt className="text-xs text-muted-foreground">Qué se ejecutó</dt>
          <dd>{PAYMENT_ACTION_LABEL[resolution.paymentAction]}</dd>
        </div>
      </dl>
      <p className="rounded-lg bg-surface-sub p-3 text-sm leading-[1.55] text-pretty whitespace-pre-wrap">
        {resolution.reasoning}
      </p>
      <span className="text-xs text-muted-foreground">
        {resolution.resolvedBy}
        {resolution.resolvedAt && ` · ${formatDateTime(resolution.resolvedAt)}`}
      </span>
    </DisputeCard>
  )
}
