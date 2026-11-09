import type { Metadata } from "next"
import { publicError } from "@/lib/auth/api"
import { requireAdmin } from "@/lib/auth/session"
import { sidebarDefaultOpen } from "@/lib/sidebar"
import { KYC_PAGE_SIZE, listKycReviews } from "@/lib/kyc/api"
import { parseKycType } from "@/lib/kyc/format"
import { AdminShell } from "@/components/admin-shell"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { KycFilters } from "@/components/kyc/kyc-filters"
import { KycRows } from "@/components/kyc/review-table"
import { Pager } from "@/components/users/pager"

const first = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? ""

export const metadata: Metadata = { title: "KYC" }

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const q = first(params.q).trim().slice(0, 100)
  const type = parseKycType(first(params.type))
  const page = Math.min(
    1000,
    Math.max(1, Math.floor(Number(first(params.page))) || 1)
  )
  const query = (n: number) =>
    new URLSearchParams({
      ...(q ? { q } : {}),
      ...(type ? { type } : {}),
      ...(n > 1 ? { page: String(n) } : {}),
    })
  const returnTo = `/kyc${query(page).size ? `?${query(page)}` : ""}`
  const profile = await requireAdmin(false, returnTo)

  let data
  let loadError: string | undefined
  try {
    data = await listKycReviews({ q, type, page })
  } catch (error) {
    loadError = publicError(error)
  }

  const total = data?.total ?? 0
  const filtered = Boolean(q || type)
  const label = loadError
    ? ""
    : total === 0
      ? filtered
        ? "Sin resultados"
        : "Nada pendiente"
      : `${total} ${total === 1 ? "caso" : "casos"} para revisar · el que más espera primero`
  const href = (n: number) => {
    const qs = query(n)
    return qs.size ? `/kyc?${qs}` : "/kyc"
  }

  return (
    <AdminShell
      fullName={profile.fullName}
      email={profile.email}
      photoUrl={profile.photoUrl}
      defaultOpen={await sidebarDefaultOpen()}
      current="/kyc"
    >
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-5 pt-7 pb-14 md:px-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em]">
            KYC
          </h1>
          <p className="text-sm text-fg2">
            Verificaciones de identidad y licencia que Didit dejó para revisión
            manual. Abrí un caso para aprobarlo o rechazarlo.
          </p>
        </div>
        {loadError && (
          <Alert variant="destructive" className="w-auto">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}
        <KycFilters initialQuery={q} initialType={type} label={label}>
          {data && <KycRows rows={data.items} filtered={filtered} />}
          {data && data.total > KYC_PAGE_SIZE && (
            <Pager
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              href={href}
            />
          )}
        </KycFilters>
      </div>
    </AdminShell>
  )
}
