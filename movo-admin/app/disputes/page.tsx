import type { Metadata } from "next"
import type { AdminDisputePage } from "@movo/shared/src/types/admin-disputes"
import { publicError } from "@/lib/auth/api"
import { requireAdmin } from "@/lib/auth/session"
import { sidebarDefaultOpen } from "@/lib/sidebar"
import { listDisputes } from "@/lib/disputes/api"
import { DISPUTE_STATUS_TAB } from "@/lib/disputes/format"
import {
  disputeListHref,
  disputePageNumber,
  disputeQuery,
  EMPTY_DISPUTE_STATE,
  nextDisputePage,
  parseDisputeState,
  prevDisputePage,
} from "@/lib/disputes/params"
import { AdminShell } from "@/components/admin-shell"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { DisputeFilters } from "@/components/disputes/dispute-filters"
import {
  DisputeRowLink,
  DisputesEmpty,
  DisputeTableHeader,
} from "@/components/disputes/dispute-table"
import { ShipmentsPager } from "@/components/shipments/shipment-table"

export const metadata: Metadata = { title: "Disputas" }

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const state = parseDisputeState(await searchParams)
  const returnTo = disputeListHref(state)
  const profile = await requireAdmin(false, returnTo)

  let data: AdminDisputePage | undefined
  let loadError: string | undefined
  try {
    data = await listDisputes(state)
  } catch (error) {
    loadError = publicError(error)
  }

  const now = new Date()
  const total = data?.statusCounts[state.status] ?? 0
  const resultLabel = data
    ? `${total} ${total === 1 ? "disputa" : "disputas"} · ${DISPUTE_STATUS_TAB[state.status].toLowerCase()}`
    : ""
  const filtered =
    disputeQuery({
      ...state,
      status: EMPTY_DISPUTE_STATE.status,
      cursor: null,
      back: [],
    }) !== ""
  // El expediente vuelve a esta misma bandeja (filtros y página).
  const from = disputeQuery(state)
  const detailHref = (id: string) =>
    `/disputes/${id}${from ? `?${new URLSearchParams({ from })}` : ""}`

  return (
    <AdminShell
      fullName={profile.fullName}
      email={profile.email}
      photoUrl={profile.photoUrl}
      defaultOpen={await sidebarDefaultOpen()}
      current="/disputes"
    >
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-5 pt-7 pb-14 md:px-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em]">
            Disputas
          </h1>
          <p className="text-sm text-fg2">
            Los reclamos sobre envíos que esperan una decisión del equipo, la
            más antigua primero. Abrí uno para ver el expediente.
          </p>
        </div>
        <DisputeFilters
          state={state}
          counts={data?.statusCounts ?? null}
          resultLabel={resultLabel}
          loadedAt={now.toISOString()}
        />
        {loadError ? (
          <Alert variant="destructive" className="w-auto">
            <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>No pudimos cargar las disputas. {loadError}</span>
              <a
                href={returnTo}
                className="font-medium underline underline-offset-4"
              >
                Reintentar
              </a>
            </AlertDescription>
          </Alert>
        ) : (
          data && (
            <div className="overflow-hidden rounded-[10px] border bg-card">
              <DisputeTableHeader />
              {data.items.length === 0 ? (
                <DisputesEmpty filtered={filtered} />
              ) : (
                data.items.map((row) => (
                  <DisputeRowLink
                    key={row.id}
                    row={row}
                    href={detailHref(row.id)}
                    now={now}
                  />
                ))
              )}
              <ShipmentsPager
                page={disputePageNumber(state)}
                prevHref={
                  state.cursor ? disputeListHref(prevDisputePage(state)) : null
                }
                nextHref={
                  data.nextCursor
                    ? disputeListHref(nextDisputePage(state, data.nextCursor))
                    : null
                }
              />
            </div>
          )
        )}
      </div>
    </AdminShell>
  )
}
