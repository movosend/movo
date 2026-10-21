import { IdCard, ScanFace, Wallet } from "lucide-react"
import type {
  AdminKycCard,
  AdminUserMercadoPago,
} from "@movo/shared/src/types/admin-users"
import { formatDate, KYC, type Pill } from "@/lib/users/format"
import { loadSection } from "@/lib/users/load"
import { ReportSection } from "../ficha-status"
import { SectionError } from "../section-error"
import {
  Eyebrow,
  IconTile,
  SectionShell,
  StatusPill,
  TONE_BG,
  TONE_DOT,
} from "../ui"
import { cn } from "@/lib/utils"

const ATTEMPTS_SHOWN = 3

function Attempt({ a }: { a: AdminKycCard["attempts"][number] }) {
  const p = KYC[a.status]
  return (
    <div className="flex items-baseline gap-2.5 text-[13px]">
      <span
        aria-hidden
        className={cn(
          "size-[7px] flex-none -translate-y-px rounded-full",
          TONE_DOT[p.tone]
        )}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span>
          <span className="font-medium">{p.label}</span>
          <span className="text-muted-foreground">
            {" "}
            · {formatDate(a.requestedAt)}
          </span>
        </span>
        {a.reason && <span className="text-xs text-fg2">{a.reason}</span>}
      </span>
    </div>
  )
}

function Card({
  icon: Icon,
  title,
  pill,
  empty,
  rows,
  attempts,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  pill: Pill
  empty?: string
  rows: { k: string; v: string; mono?: boolean }[]
  attempts?: AdminKycCard["attempts"]
}) {
  return (
    <div className="flex flex-col gap-3.5 rounded-lg border p-4">
      <div className="flex items-center gap-2.5">
        <IconTile className={cn("size-9 rounded-[9px]", TONE_BG[pill.tone])}>
          <Icon className="size-[18px]" />
        </IconTile>
        <span className="flex-1 text-sm font-semibold">{title}</span>
        <StatusPill pill={pill} dot />
      </div>
      {empty && <span className="text-[13px] text-fg2">{empty}</span>}
      {rows.map((r) => (
        <div key={r.k} className="flex justify-between gap-3 text-[13px]">
          <span className="text-muted-foreground">{r.k}</span>
          <span
            className={cn(
              "text-right [overflow-wrap:anywhere]",
              r.mono && "font-mono"
            )}
          >
            {r.v}
          </span>
        </div>
      ))}
      {attempts && attempts.length > 0 && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <Eyebrow>Intentos</Eyebrow>
          {[...attempts]
            .reverse()
            .slice(0, ATTEMPTS_SHOWN)
            .map((a, i) => (
              <Attempt key={i} a={a} />
            ))}
          {attempts.length > ATTEMPTS_SHOWN && (
            <details className="group flex flex-col gap-2">
              <summary className="cursor-pointer text-xs font-medium text-fg2 select-none hover:text-foreground">
                Ver los {attempts.length - ATTEMPTS_SHOWN} anteriores
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                {[...attempts]
                  .reverse()
                  .slice(ATTEMPTS_SHOWN)
                  .map((a, i) => (
                    <Attempt key={i} a={a} />
                  ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

const MP_PILL: Record<AdminUserMercadoPago["status"], Pill> = {
  linked: { label: "Vinculada", tone: "success" },
  not_linked: { label: "Sin vincular", tone: "neutral" },
  revoked: { label: "Revocada", tone: "danger" },
  expired: { label: "Vencida", tone: "warning" },
}

/** Tarjeta de Mercado Pago. `null` = svc-payments no respondió: falla solo esta tarjeta, no la sección. */
function mpCard(
  mp: AdminUserMercadoPago | null,
  isCarrier: boolean
): { pill: Pill; empty?: string; rows: { k: string; v: string; mono?: boolean }[] } {
  if (!mp)
    return {
      pill: { label: "No disponible", tone: "neutral" },
      empty: "No pudimos consultar Mercado Pago. Reintentá en un rato.",
      rows: [],
    }
  if (mp.status === "not_linked" && !mp.connectedAt)
    return {
      pill: MP_PILL.not_linked,
      empty: isCarrier
        ? "No vinculó su cuenta de Mercado Pago, así que no puede cobrar."
        : "Sin cuenta vinculada. Solo la necesita para cobrar como transportista.",
      rows: [],
    }
  return {
    pill: MP_PILL[mp.status],
    ...(mp.status === "expired"
      ? {
          empty:
            "El acceso venció y no se renovó solo. Es una falla nuestra: no hace falta pedirle que vuelva a vincular.",
        }
      : mp.status === "revoked"
        ? { empty: "Revocó el acceso desde Mercado Pago: tiene que volver a vincular la cuenta para cobrar." }
        : {}),
    rows: [
      ...(mp.nickname ? [{ k: "Cuenta", v: mp.nickname, mono: true }] : []),
      ...(mp.connectedAt ? [{ k: "Vinculada", v: formatDate(mp.connectedAt) }] : []),
      ...(mp.unlinkedAt ? [{ k: "Desvinculada", v: formatDate(mp.unlinkedAt) }] : []),
    ],
  }
}

export async function KycSection({
  id,
  isCarrier,
}: {
  id: string
  isCarrier: boolean
}) {
  const result = await loadSection(id, "kyc")
  if (!result.ok)
    return (
      <SectionShell id="kyc">
        <SectionError id="kyc" userId={id} status={result.status} />
      </SectionShell>
    )
  const { identity, license, mercadoPago: mp } = result.data
  const last = (c: AdminKycCard) => c.attempts[c.attempts.length - 1]
  return (
    <SectionShell id="kyc">
      <ReportSection id="kyc" status="ready" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4 p-[18px]">
        <Card
          icon={ScanFace}
          title="Identidad"
          pill={KYC[identity.status]}
          empty={
            identity.status === "not_started"
              ? "Nunca inició la verificación de identidad."
              : undefined
          }
          rows={
            identity.status === "not_started"
              ? []
              : [
                  {
                    k: "Última sesión",
                    v: identity.lastSessionId ?? "—",
                    mono: true,
                  },
                  {
                    k: "Último intento",
                    v: formatDate(last(identity)?.requestedAt),
                  },
                ]
          }
          attempts={identity.attempts}
        />
        <Card
          icon={IdCard}
          title="Licencia de conducir"
          pill={KYC[license.status]}
          empty={
            license.status === "not_started"
              ? isCarrier
                ? "Nunca inició la verificación de la licencia."
                : "Nunca inició la verificación. La necesita solo para transportar."
              : undefined
          }
          rows={
            license.status === "not_started"
              ? []
              : [
                  {
                    k: "Última sesión",
                    v: license.lastSessionId ?? "—",
                    mono: true,
                  },
                  ...(license.expiresAt
                    ? [{ k: "Vence", v: formatDate(license.expiresAt) }]
                    : []),
                ]
          }
          attempts={license.attempts}
        />
        <Card icon={Wallet} title="Mercado Pago" {...mpCard(mp, isCarrier)} />
      </div>
    </SectionShell>
  )
}
