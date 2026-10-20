import "server-only"
import { ApiError } from "@movo/shared/src/errors/api-error"
import {
  MOCK_TODAY,
  mockAudit,
  mockDevices,
  mockKyc,
  mockLedger,
  mockModeration,
  mockProfile,
  mockRatings,
  mockSanctions,
  mockSearch,
  mockShipments,
  mockTrips,
  mockVehicle,
  seedById,
} from "./fixtures"
import {
  SECTION_SERVICE,
  type SectionKey,
  type SectionMap,
  type SectionParams,
} from "./sections"

/**
 * Modo fixtures (MOVO-295): `MOVO_ADMIN_MOCK=1` reemplaza solo la capa de datos de Usuarios
 * mientras `svc-admin` no tenga las rutas de MOVO-294. El login sigue yendo al gateway real.
 * Se ignora en producción para que nunca muestre datos inventados.
 *
 * `MOVO_ADMIN_MOCK_FAIL=kyc,ledger` hace fallar esas secciones con un 502 en la primera carga
 * (el reintento anda); con `!` al final (`kyc!`) fallan siempre. `MOVO_ADMIN_MOCK_LATENCY_MS`
 * fija la demora base (default 350 ms).
 */
export const mockEnabled = () =>
  process.env.MOVO_ADMIN_MOCK === "1" && process.env.NODE_ENV !== "production"

export const MOCK_NOW = MOCK_TODAY

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const base = () => {
  const n = Number(process.env.MOVO_ADMIN_MOCK_LATENCY_MS)
  return Number.isFinite(n) && n >= 0 ? n : 350
}
// Escalonado por sección, como el prototipo: las más pesadas tardan más y se ve el streaming.
const STAGGER: Record<SectionKey, number> = {
  kyc: 1.8,
  vehicle: 1.2,
  shipments: 2.7,
  trips: 1.5,
  ratings: 2.1,
  moderation: 3.2,
  suspensions: 1.7,
  ledger: 3.8,
  devices: 1.4,
  audit: 2.4,
}

const failed = new Set<string>()
function shouldFail(id: string, key: SectionKey): boolean {
  const spec = (process.env.MOVO_ADMIN_MOCK_FAIL ?? "")
    .split(",")
    .map((s) => s.trim())
  if (spec.includes(`${key}!`)) return true
  if (!spec.includes(key)) return false
  const k = `${id}:${key}`
  if (failed.has(k)) return false
  failed.add(k)
  return true
}

const userNotFound = () =>
  new ApiError(404, "USER_NOT_FOUND", "No existe el usuario.")

export async function mockSearchUsers(q: string, page: number) {
  await sleep(base())
  return mockSearch(q, page, 10)
}

export async function mockGetProfile(id: string) {
  await sleep(base() * 0.6)
  const seed = seedById(id)
  if (!seed) throw userNotFound()
  return mockProfile(seed)
}

export async function mockGetSection<K extends SectionKey>(
  id: string,
  key: K,
  params: SectionParams
): Promise<SectionMap[K]> {
  await sleep(base() * STAGGER[key])
  const seed = seedById(id)
  if (!seed) throw userNotFound()
  if (shouldFail(id, key))
    throw new ApiError(
      502,
      `${SECTION_SERVICE[key]}_SERVICE_UNAVAILABLE` as "INTERNAL_ERROR",
      "El servicio no respondió."
    )
  const page = params.page ?? 1
  const result: SectionMap[SectionKey] = (() => {
    switch (key) {
      case "kyc":
        return mockKyc(seed)
      case "vehicle":
        return mockVehicle(seed)
      case "shipments":
        return mockShipments(
          seed,
          params.role ?? "sender",
          page,
          params.pageSize ?? 5
        )
      case "trips":
        return mockTrips(seed, page, params.pageSize ?? 5)
      case "ratings":
        return mockRatings(seed, page, params.pageSize ?? 5)
      case "moderation":
        return mockModeration(seed)
      case "suspensions":
        return mockSanctions(seed)
      case "ledger":
        return mockLedger(seed, params.cursor, params.limit)
      case "devices":
        return mockDevices(seed)
      case "audit":
        return mockAudit(seed, params.cursor, params.limit)
    }
  })()
  return result as SectionMap[K]
}
