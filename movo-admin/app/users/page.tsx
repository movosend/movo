import type { Metadata } from "next"
import { publicError } from "@/lib/auth/api"
import { requireAdmin } from "@/lib/auth/session"
import { sidebarDefaultOpen } from "@/lib/sidebar"
import { searchUsers, USERS_PAGE_SIZE } from "@/lib/users/api"
import { AdminShell } from "@/components/admin-shell"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Pager } from "@/components/users/pager"
import { UserSearch } from "@/components/users/user-search"
import { UserRows } from "@/components/users/user-table"

const first = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? ""

export const metadata: Metadata = { title: "Usuarios" }

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const q = first(params.q).trim().slice(0, 100)
  const page = Math.min(
    1000,
    Math.max(1, Math.floor(Number(first(params.page))) || 1)
  )
  const returnTo = `/users${q || page > 1 ? `?${new URLSearchParams({ ...(q ? { q } : {}), ...(page > 1 ? { page: String(page) } : {}) })}` : ""}`
  const profile = await requireAdmin(false, returnTo)

  let data
  let loadError: string | undefined
  try {
    data = await searchUsers(q, page)
  } catch (error) {
    loadError = publicError(error)
  }

  const total = data?.total ?? 0
  const label = loadError
    ? ""
    : q
      ? total === 1
        ? "1 resultado"
        : `${total} resultados`
      : `${total} usuarios · más recientes primero`
  const href = (n: number) =>
    `/users?${new URLSearchParams({ ...(q ? { q } : {}), ...(n > 1 ? { page: String(n) } : {}) })}`

  return (
    <AdminShell
      fullName={profile.fullName}
      email={profile.email}
      photoUrl={profile.photoUrl}
      defaultOpen={await sidebarDefaultOpen()}
      current="/users"
    >
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-5 pt-7 pb-14 md:px-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em]">
            Usuarios
          </h1>
          <p className="text-sm text-fg2">
            Buscá a cualquier persona de la red y abrí su ficha.
          </p>
        </div>
        {loadError && (
          <Alert variant="destructive" className="w-auto">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}
        <UserSearch initialQuery={q} label={label}>
          {data && <UserRows users={data.items} query={q} />}
          {data && data.total > USERS_PAGE_SIZE && (
            <Pager
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              href={href}
            />
          )}
        </UserSearch>
      </div>
    </AdminShell>
  )
}
