import { cache, Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { Scale, TriangleAlert, X } from "lucide-react"
import {
  reportAppliesBand,
  reportAppliesCity,
  type AdminReportId,
} from "@movo/shared/src/types/admin-reports"
import { publicError } from "@/lib/auth/api"
import { requireAdmin } from "@/lib/auth/session"
import { sidebarDefaultOpen } from "@/lib/sidebar"
import { getDispute } from "@/lib/disputes/api"
import { DISPUTE_REASON_LABEL } from "@/lib/disputes/format"
import { getReport } from "@/lib/reports/api"
import {
  metricsHref,
  metricsQuery,
  metricsRange,
  parseMetricsState,
  type MetricsState,
} from "@/lib/reports/params"
import { argentinaDay, shipmentDisplayCode } from "@/lib/shipments/format"
import { AdminShell } from "@/components/admin-shell"
import { ChartPanelsSkeleton, KpiRowSkeleton } from "@/components/skeletons"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { MetricsToolbar } from "@/components/reports/metrics/metrics-toolbar"
import { MetricsView } from "@/components/reports/metrics/metrics-view"
import { ToastProvider } from "@/components/reports/toasts"

export const metadata: Metadata = { title: "Métricas" }

/** El aviso y el desglose leen la misma disputa: una sola lectura por render. */
const disputeOnce = cache((id: string) => getDispute(id).catch(() => null))

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const state = parseMetricsState(await searchParams)
  const profile = await requireAdmin(false, metricsHref(state))
  const today = argentinaDay(new Date())
  const range = metricsRange(state, today)

  return (
    <AdminShell
      fullName={profile.fullName}
      email={profile.email}
      photoUrl={profile.photoUrl}
      defaultOpen={await sidebarDefaultOpen()}
      current="/metrics"
    >
      <ToastProvider>
        <div className="mx-auto flex max-w-[1280px] flex-col gap-[18px] px-5 pt-7 pb-14 md:px-8">
          {state.demo && <DemoNotice state={state} />}
          <MetricsToolbar
            state={state}
            range={range}
            today={today}
            bandApplied={reportAppliesBand(state.tab)}
          />
          {state.tab === "disputes" && state.dispute && (
            <Suspense fallback={null}>
              <FromDispute state={state} />
            </Suspense>
          )}
          {/* Un cambio de filtro remonta el cuerpo: se ve el skeleton mientras llega el reporte nuevo. */}
          <Suspense
            key={metricsQuery(state)}
            fallback={
              <div className="flex flex-col gap-4">
                <KpiRowSkeleton />
                <ChartPanelsSkeleton />
              </div>
            }
          >
            <ReportBody state={state} range={range} />
          </Suspense>
        </div>
      </ToastProvider>
    </AdminShell>
  )
}

async function ReportBody({
  state,
  range,
}: {
  state: MetricsState
  range: { from: string; to: string }
}) {
  const id: AdminReportId = state.tab
  // La disputa solo resalta un motivo: se pide junto con el reporte y no lo demora ni lo rompe.
  const dispute =
    id === "disputes" && state.dispute ? disputeOnce(state.dispute) : null
  const reportRequest = getReport(
    id,
    {
      ...range,
      ...(state.band && reportAppliesBand(id) ? { band: state.band } : {}),
      ...(state.city && reportAppliesCity(id) ? { city: state.city } : {}),
    },
    { demo: state.demo }
  ).then(
    (report) => ({ report, error: null }),
    (error: unknown) => ({ report: null, error: publicError(error) })
  )
  const [result, disputeData] = await Promise.all([reportRequest, dispute])
  const highlight = disputeData?.reason ?? null
  if (result.report)
    return (
      <MetricsView
        id={id}
        report={result.report}
        highlight={highlight}
        demo={state.demo}
        state={state}
      />
    )
  return (
    <Alert variant="destructive" className="w-auto">
      <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>No pudimos cargar este reporte. {result.error}</span>
        <a
          href={metricsHref(state)}
          className="font-medium underline underline-offset-4"
        >
          Reintentar
        </a>
      </AlertDescription>
    </Alert>
  )
}

/** Aviso de datos de demostración: arriba de todo, mientras `datos=demo` esté en la URL. */
function DemoNotice({ state }: { state: MetricsState }) {
  return (
    <div
      role="status"
      className="border-warn-border flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn-fg"
    >
      <TriangleAlert className="text-warn-icon size-[18px] flex-none" />
      <span className="min-w-[240px] flex-1">
        <b className="font-semibold">Datos de demostración.</b> Los números de
        esta pantalla son ficticios: sirven para mostrar el panel, no para tomar
        decisiones. Los CSV también son de demostración.
      </span>
      <Link
        href={metricsHref({ ...state, demo: false })}
        scroll={false}
        className="font-medium underline underline-offset-[3px]"
      >
        Ver datos reales
      </Link>
    </div>
  )
}

/** "Llegaste desde la disputa …": el link del expediente marca su motivo en el desglose. */
async function FromDispute({ state }: { state: MetricsState }) {
  const dispute = await disputeOnce(state.dispute!)
  if (!dispute) return null
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-[10px] bg-info-soft px-3.5 py-2.5 text-[13px]"
    >
      <Scale className="size-[18px] text-info-fg" />
      <span className="min-w-[240px] flex-1">
        Llegaste desde la disputa de{" "}
        <span className="font-mono font-medium">
          {shipmentDisplayCode(dispute.shipmentId)}
        </span>
        . Su motivo,{" "}
        <b className="font-semibold">{DISPUTE_REASON_LABEL[dispute.reason]}</b>,
        está marcado en el desglose.
      </span>
      <Link
        href={`/disputes/${dispute.id}`}
        className="font-medium underline underline-offset-[3px]"
      >
        Volver a la disputa
      </Link>
      <Link
        href={metricsHref({ ...state, dispute: null })}
        scroll={false}
        aria-label="Cerrar"
        className="flex size-7 items-center justify-center rounded-md text-fg2 hover:bg-card"
      >
        <X className="size-4" />
      </Link>
    </div>
  )
}
