import type {
  AdminShipmentRole,
  AdminUserAuditPage,
  AdminUserDevices,
  AdminUserKyc,
  AdminUserLedger,
  AdminUserModeration,
  AdminUserRatings,
  AdminUserSanctions,
  AdminUserShipmentPage,
  AdminUserTripPage,
  AdminUserVehicle,
} from "@movo/shared/src/types/admin-users"

/** Secciones de la ficha que cargan por separado: una ruta `GET /admin/users/:id/<ruta>` cada una. */
export interface SectionMap {
  kyc: AdminUserKyc
  vehicle: AdminUserVehicle
  shipments: AdminUserShipmentPage
  trips: AdminUserTripPage
  ratings: AdminUserRatings
  moderation: AdminUserModeration
  suspensions: AdminUserSanctions
  ledger: AdminUserLedger
  devices: AdminUserDevices
  audit: AdminUserAuditPage
}

export type SectionKey = keyof SectionMap

export const SECTION_ROUTE: Record<SectionKey, string> = {
  kyc: "kyc",
  vehicle: "vehicle",
  shipments: "shipments",
  trips: "trips",
  ratings: "ratings",
  moderation: "moderation",
  suspensions: "suspensions",
  ledger: "ledger",
  devices: "devices",
  audit: "audit-log",
}

export interface SectionParams {
  role?: AdminShipmentRole
  page?: number
  pageSize?: number
}

/** Servicio dueño de cada sección: es el que, si cae, responde 502 con su código. */
export const SECTION_SERVICE: Record<SectionKey, string> = {
  kyc: "USERS",
  vehicle: "USERS",
  moderation: "USERS",
  devices: "USERS",
  shipments: "SHIPMENTS",
  trips: "SHIPMENTS",
  ratings: "SHIPMENTS",
  ledger: "PAYMENTS",
  suspensions: "ADMIN",
  audit: "ADMIN",
}
