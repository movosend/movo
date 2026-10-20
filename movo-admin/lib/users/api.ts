import "server-only"
import { cookies } from "next/headers"
import type {
  AdminUserPage,
  AdminUserProfile,
} from "@movo/shared/src/types/admin-users"
import { gateway } from "@/lib/auth/api"
import { ACCESS_COOKIE } from "@/lib/auth/policy"
import {
  mockEnabled,
  mockGetProfile,
  mockGetSection,
  mockSearchUsers,
} from "./mock"
import {
  SECTION_ROUTE,
  type SectionKey,
  type SectionMap,
  type SectionParams,
} from "./sections"

export const USERS_PAGE_SIZE = 10

const token = async () => (await cookies()).get(ACCESS_COOKIE)?.value

/** `GET /admin/users?q=&page=&pageSize=` (MOVO-294). */
export async function searchUsers(
  q: string,
  page: number
): Promise<AdminUserPage> {
  if (mockEnabled()) return mockSearchUsers(q, page)
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(USERS_PAGE_SIZE),
  })
  if (q) query.set("q", q)
  return gateway<AdminUserPage>(`/admin/users?${query}`, {
    accessToken: await token(),
  })
}

/** `GET /admin/users/:id`: la única llamada que bloquea la ficha (cabecera y banner). */
export async function getUserProfile(id: string): Promise<AdminUserProfile> {
  if (mockEnabled()) return mockGetProfile(id)
  return gateway<AdminUserProfile>(`/admin/users/${encodeURIComponent(id)}`, {
    accessToken: await token(),
  })
}

/** `GET /admin/users/:id/<sección>`: cada una consulta a un solo servicio y falla por separado. */
export async function getUserSection<K extends SectionKey>(
  id: string,
  key: K,
  params: SectionParams = {}
): Promise<SectionMap[K]> {
  if (mockEnabled()) return mockGetSection(id, key, params)
  const query = new URLSearchParams()
  if (params.role) query.set("role", params.role)
  if (params.page) query.set("page", String(params.page))
  if (params.pageSize) query.set("pageSize", String(params.pageSize))
  const qs = query.size ? `?${query}` : ""
  return gateway<SectionMap[K]>(
    `/admin/users/${encodeURIComponent(id)}/${SECTION_ROUTE[key]}${qs}`,
    { accessToken: await token() }
  )
}
