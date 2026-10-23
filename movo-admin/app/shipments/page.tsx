import type { Metadata } from "next"
import type { AdminShipmentPage } from "@movo/shared/src/types/admin-shipments"
import { publicError } from "@/lib/auth/api"
import { requireAdmin } from "@/lib/auth/session"
import { sidebarDefaultOpen } from "@/lib/sidebar"
import { listShipments } from "@/lib/shipments/api"
import {
  EMPTY_LIST_STATE,
  listHref,
  listQuery,
  nextPage,
  parseListState,
  prevPage,
} from "@/lib/shipments/params"
import { AdminShell } from "@/components/admin-shell"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ShipmentFilters } from "@/components/shipments/shipment-filters"
import {
  ShipmentRowLink,
  ShipmentsEmpty,
  ShipmentsPager,
  ShipmentTableHeader,
} from "@/components/shipments/shipment-table"

export const metadata: Metadata = { title: "Envíos" }

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const state = parseListState(await searchParams)
  const returnTo = listHref(state)
  const profile = await requireAdmin(false, returnTo)

  let data: AdminShipmentPage | undefined
  let loadError: string | undefined
  try {
    data = await listShipments(state)
  } catch (error) {
    loadError = publicError(error)
  }

  const now = new Date()
  // El total del resultado: el chip elegido, o la pestaña (los activos en "Todos").
  const total = data
    ? state.status
      ? data.statusCounts[state.status]
      : state.alert
        ? data.alertCounts[state.tab]
        : data.counts[state.tab]
    : 0
  const resultLabel = data ? (total === 1 ? "1 envío" : `${total} envíos`) : ""
  const filtered =
    listQuery({ ...state, cursor: null, back: [] }) !==
    listQuery(EMPTY_LIST_STATE)
  // El detalle vuelve a este mismo listado (filtros y página).
  const from = listQuery(state)
  const detailHref = (id: string) =>
    `/shipments/${id}${from ? `?${new URLSearchParams({ from })}` : ""}`

  return (
    <AdminShell
      fullName={profile.fullName}
      email={profile.email}
      photoUrl={profile.photoUrl}
      defaultOpen={await sidebarDefaultOpen()}
      current="/shipments"
    >
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-5 pt-7 pb-14 md:px-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em]">
            Envíos
          </h1>
          <p className="text-sm text-fg2">
            Todos los envíos de la red, por estado. Abrí uno para ver su línea
            de tiempo y el chat.
          </p>
        </div>
        <ShipmentFilters
          state={state}
          counts={data ?? null}
          resultLabel={resultLabel}
          loadedAt={now.toISOString()}
        />
        {loadError ? (
          <Alert variant="destructive" className="w-auto">
            <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>No pudimos cargar los envíos. {loadError}</span>
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
              <ShipmentTableHeader />
              {data.items.length === 0 ? (
                <ShipmentsEmpty filtered={filtered} />
              ) : (
                data.items.map((row) => (
                  <ShipmentRowLink
                    key={row.id}
                    row={row}
                    href={detailHref(row.id)}
                    now={now}
                  />
                ))
              )}
              <ShipmentsPager
                page={state.back.length + (state.cursor ? 2 : 1)}
                prevHref={state.cursor ? listHref(prevPage(state)) : null}
                nextHref={
                  data.nextCursor
                    ? listHref(nextPage(state, data.nextCursor))
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
