/**
 * Datos de prueba de la búsqueda de usuarios y la ficha (MOVO-295), portados del prototipo de
 * Claude Design. Solo los usa `mock.ts` mientras MOVO-294 no esté desplegado. Se arman con la
 * forma de `@movo/shared` (`AdminUser*`), así el panel no depende de que sea un mock.
 */
import { ADMIN_USER_MODERATION_LIMIT } from "@movo/shared/src/types/admin-users"
import type {
  AdminAccountStatus,
  AdminKycStatus,
  AdminLedgerStatus,
  AdminLedgerType,
  AdminReportReason,
  AdminReportStatus,
  AdminShipmentRole,
  AdminShipmentStatus,
  AdminUserAuditPage,
  AdminUserNote,
  AdminUserDevices,
  AdminUserKyc,
  AdminUserLedger,
  AdminUserListItem,
  AdminUserModeration,
  AdminUserProfile,
  AdminUserRatings,
  AdminUserReport,
  AdminUserRoleName,
  AdminUserSanctions,
  AdminUserShipment,
  AdminUserTripPage,
  AdminUserVehicle,
  AdminKycCard,
} from "@movo/shared/src/types/admin-users"

/** "Hoy" del prototipo: mantiene estable lo que dependen de la fecha (días de suspensión, alta). */
export const MOCK_TODAY = new Date("2026-10-19T12:00:00-03:00")

const hash = (str: string) => {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** UUID v4 determinístico: el mismo nombre da siempre el mismo id. */
export function uuid(seed: string): string {
  let h = hash(seed)
  let o = ""
  for (let i = 0; i < 32; i++) {
    h = (Math.imul(h ^ (h >>> 13), 1103515245) + 12345) >>> 0
    o += ((h >>> 24) & 15).toString(16)
  }
  return `${o.slice(0, 8)}-${o.slice(8, 12)}-4${o.slice(13, 16)}-a${o.slice(17, 20)}-${o.slice(20, 32)}`
}

type Raw = [
  name: string,
  email: string,
  phone: string,
  dni: string,
  created: string,
  roles: "E" | "ET",
  status: AdminAccountStatus,
  until: string | null,
  kycId: AdminKycStatus,
  kycLic: AdminKycStatus,
  rating: number | null,
  nRatings: number,
  birth: string,
]

const RAW: Raw[] = [
  [
    "Marcos Vera",
    "marcos.vera@gmail.com",
    "+5493516124410",
    "33812405",
    "2025-11-03",
    "ET",
    "active",
    null,
    "approved",
    "approved",
    4.8,
    37,
    "1988-04-18",
  ],
  [
    "Renata Silva",
    "renata.silva@outlook.com",
    "+5493514882207",
    "41230118",
    "2026-10-12",
    "E",
    "active",
    null,
    "approved",
    "not_started",
    null,
    0,
    "1998-09-02",
  ],
  [
    "Hernán Molina",
    "hernanmolina@gmail.com",
    "+5493517013392",
    "29554871",
    "2026-01-21",
    "ET",
    "banned",
    "2026-11-02",
    "approved",
    "approved",
    3.9,
    22,
    "1982-12-11",
  ],
  [
    "Ezequiel Rojas",
    "eze.rojas@hotmail.com",
    "+5493513309081",
    "35118902",
    "2025-12-14",
    "ET",
    "banned",
    null,
    "approved",
    "rejected",
    2.7,
    9,
    "1990-06-25",
  ],
  [
    "Lorena Paz",
    "lorepaz@gmail.com",
    "+5493512457713",
    "30871224",
    "2026-02-08",
    "E",
    "deleted",
    null,
    "approved",
    "not_started",
    4.5,
    6,
    "1984-03-30",
  ],
  [
    "Valentina Sosa",
    "vale.sosa@gmail.com",
    "+5493515901146",
    "39402557",
    "2026-04-02",
    "ET",
    "active",
    null,
    "approved",
    "manual_review",
    4.9,
    14,
    "1996-01-07",
  ],
  [
    "Ana Molina",
    "anamolina@yahoo.com.ar",
    "+5493516140028",
    "32190441",
    "2026-03-17",
    "E",
    "active",
    null,
    "approved",
    "not_started",
    4.7,
    11,
    "1987-07-19",
  ],
  [
    "Diego Funes",
    "dfunes@gmail.com",
    "+5493513775520",
    "31006783",
    "2025-10-29",
    "ET",
    "active",
    null,
    "approved",
    "approved",
    4.9,
    58,
    "1985-02-14",
  ],
  [
    "Sofía Ríos",
    "sofirios@gmail.com",
    "+5493514826630",
    "40551209",
    "2026-05-22",
    "E",
    "active",
    null,
    "approved",
    "not_started",
    4.6,
    8,
    "1997-11-21",
  ],
  [
    "Nicolás Paz",
    "nico.paz@gmail.com",
    "+5493512661874",
    "36774012",
    "2025-12-01",
    "ET",
    "active",
    null,
    "approved",
    "approved",
    4.8,
    41,
    "1992-05-03",
  ],
  [
    "Camila Ortiz",
    "camiortiz@gmail.com",
    "+5493517093345",
    "42118906",
    "2026-10-15",
    "E",
    "active",
    null,
    "pending",
    "not_started",
    null,
    0,
    "2000-08-12",
  ],
  [
    "Gonzalo Díaz",
    "gonzadiaz@outlook.com",
    "+5493515510092",
    "34660218",
    "2026-01-09",
    "ET",
    "active",
    null,
    "approved",
    "expired",
    4.4,
    19,
    "1989-10-28",
  ],
  [
    "Agustina Ponce",
    "agusponce@gmail.com",
    "+5493513187765",
    "38209544",
    "2026-02-27",
    "ET",
    "active",
    null,
    "approved",
    "approved",
    4.7,
    16,
    "1994-12-05",
  ],
  [
    "Bruno Castro",
    "brunocastro@gmail.com",
    "+5493516402219",
    "37551930",
    "2026-06-11",
    "E",
    "active",
    null,
    "approved",
    "not_started",
    4.3,
    5,
    "1993-04-09",
  ],
  [
    "Paula Méndez",
    "pmendez@gmail.com",
    "+5493514278831",
    "33009117",
    "2026-07-03",
    "E",
    "active",
    null,
    "approved",
    "not_started",
    4.8,
    7,
    "1988-01-16",
  ],
  [
    "Tomás Aguirre",
    "tomiaguirre@gmail.com",
    "+5493517025546",
    "39880421",
    "2026-03-05",
    "ET",
    "active",
    null,
    "approved",
    "approved",
    4.6,
    23,
    "1996-06-30",
  ],
  [
    "Lucas Romero",
    "lromero@hotmail.com",
    "+5493512339970",
    "35442018",
    "2026-08-19",
    "E",
    "active",
    null,
    "approved",
    "not_started",
    4.2,
    4,
    "1991-09-14",
  ],
  [
    "Mateo Ibarra",
    "mateo.ibarra@gmail.com",
    "+5493518154402",
    "41902336",
    "2026-09-08",
    "ET",
    "active",
    null,
    "approved",
    "pending",
    5.0,
    3,
    "1999-03-22",
  ],
  [
    "Joaquín Herrera",
    "joacoherrera@gmail.com",
    "+5493513906618",
    "40117885",
    "2026-10-17",
    "E",
    "active",
    null,
    "rejected",
    "not_started",
    null,
    0,
    "1998-02-01",
  ],
  [
    "Julián Torres",
    "julitorres@gmail.com",
    "+5493515543107",
    "34208776",
    "2026-04-24",
    "E",
    "active",
    null,
    "approved",
    "not_started",
    4.9,
    12,
    "1989-07-07",
  ],
  [
    "Micaela Luque",
    "mica.luque@gmail.com",
    "+5493516672290",
    "38771403",
    "2026-05-30",
    "E",
    "active",
    null,
    "approved",
    "not_started",
    4.7,
    9,
    "1995-10-10",
  ],
  [
    "Florencia Díaz",
    "flor.diaz@yahoo.com.ar",
    "+5493514718854",
    "36330592",
    "2026-06-21",
    "E",
    "active",
    null,
    "approved",
    "not_started",
    4.1,
    6,
    "1992-11-27",
  ],
  [
    "Santiago Arce",
    "santiarce@gmail.com",
    "+5493513021179",
    "37004661",
    "2026-07-14",
    "E",
    "active",
    null,
    "expired",
    "not_started",
    4.0,
    2,
    "1993-05-19",
  ],
  [
    "Gabriel Ledesma",
    "gledesma@gmail.com",
    "+5493515896624",
    "31889230",
    "2026-08-02",
    "E",
    "active",
    null,
    "approved",
    "not_started",
    4.5,
    3,
    "1986-08-08",
  ],
  [
    "Facundo Gil",
    "facugil@gmail.com",
    "+5493517440915",
    "39115874",
    "2026-09-26",
    "E",
    "active",
    null,
    "approved",
    "not_started",
    4.6,
    2,
    "1997-01-25",
  ],
  [
    "Martina Ruiz",
    "martiruiz@gmail.com",
    "+5493516135528",
    "43006119",
    "2026-10-18",
    "E",
    "active",
    null,
    "not_started",
    "not_started",
    null,
    0,
    "2002-04-04",
  ],
]

export interface Seed {
  id: string
  name: string
  email: string
  phone: string
  dni: string
  created: string
  roles: AdminUserRoleName[]
  status: AdminAccountStatus
  until: string | null
  kycId: AdminKycStatus
  kycLic: AdminKycStatus
  rating: number | null
  nRatings: number
  birth: string
}

export const SEEDS: Seed[] = RAW.map((r) => ({
  id: uuid(r[0]),
  name: r[0],
  email: r[1],
  phone: r[2],
  dni: r[3],
  created: r[4],
  roles:
    r[5] === "ET"
      ? (["sender", "carrier"] as const).slice()
      : (["sender"] as const).slice(),
  status: r[6],
  until: r[7],
  kycId: r[8],
  kycLic: r[9],
  rating: r[10],
  nRatings: r[11],
  birth: r[12],
})).sort((a, b) => (a.created < b.created ? 1 : -1))

export const seedById = (id: string) => SEEDS.find((s) => s.id === id)
const seedByName = (name: string) => SEEDS.find((s) => s.name === name)
const ref = (name: string) => ({
  id: seedByName(name)?.id ?? uuid(name),
  fullName: name,
})
const at = (date: string) => `${date}T15:00:00.000Z`

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
const digits = (s: string) => s.replace(/\D/g, "")

function matchOf(seed: Seed, q: string): AdminUserListItem["matchedBy"] {
  const nq = norm(q)
  const dq = digits(q)
  if (norm(seed.name).includes(nq)) return "name"
  if (norm(seed.email).includes(nq)) return "email"
  if (dq.length >= 3 && digits(seed.dni).includes(dq)) return "dni"
  // El teléfono se busca sin el prefijo +54 9: "351 612-4410" y "+54 9 351 612-4410" coinciden.
  if (
    dq.length >= 3 &&
    digits(seed.phone).includes(dq.replace(/^(549|54|0)/, ""))
  )
    return "phone"
  return null
}

const toListItem = (
  s: Seed,
  matchedBy: AdminUserListItem["matchedBy"]
): AdminUserListItem => ({
  id: s.id,
  fullName: s.name,
  email: s.email,
  phone: s.phone,
  dni: s.dni,
  photoUrl: null,
  roles: s.roles,
  accountStatus: s.status,
  bannedUntil: s.until,
  kycIdentity: s.kycId,
  kycLicense: s.kycLic,
  createdAt: at(s.created),
  matchedBy,
})

export function mockSearch(q: string, page: number, pageSize: number) {
  const query = q.trim()
  const found = query
    ? SEEDS.flatMap((s) => {
        const m = matchOf(s, query)
        return m ? [toListItem(s, m)] : []
      })
    : SEEDS.map((s) => toListItem(s, null))
  const start = (page - 1) * pageSize
  return {
    items: found.slice(start, start + pageSize),
    page,
    pageSize,
    total: found.length,
  }
}

// --- Extras por usuario (los que el prototipo cuenta a mano) ---------------------------------

interface ExtraReport {
  reason: AdminReportReason
  status: AdminReportStatus
  who: string
  at: string
  details: string
  entries: number
  photos: number
}

interface ExtraLedger {
  type: AdminLedgerType
  amount: number
  status: AdminLedgerStatus
  at: string
  ship?: string
  reason?: string
  admin?: string
}

interface Extra {
  vehicle?: AdminUserVehicle["vehicle"]
  kycIdAttempts?: { s: AdminKycStatus; at: string; note?: string }[]
  kycLicAttempts?: { s: AdminKycStatus; at: string; note?: string }[]
  licExp?: string
  ratings?: {
    score: number
    by: string
    role: AdminShipmentRole
    ship?: string
    at: string
    comment: string | null
  }[]
  reportsRecv?: ExtraReport[]
  reportsMade?: ExtraReport[]
  blocksMade?: { name: string; at: string }[]
  blocksRecv?: { name: string; at: string }[]
  sanctions?: AdminUserSanctions["items"]
  ledger?: ExtraLedger[]
  devices?: AdminUserDevices["devices"]
  handshake?: string | null
  deletedAt?: string
  audit?: AdminUserAuditPage["items"]
  notes?: { admin: string; body: string; at: string }[]
  mp?: "linked" | "not_linked" | "revoked"
}

const EXTRA: Record<string, Extra> = {
  "Marcos Vera": {
    notes: [
      {
        admin: "Carla Benítez",
        body: "Escribió a soporte por el reporte de acoso: ya hablé con él, entiende el criterio. Si reincide, pasar directo a suspensión.",
        at: "2026-09-02",
      },
      {
        admin: "Tomás Ferreyra",
        body: "Pidió cambiar el teléfono por robo del celular. Validé identidad por videollamada con el DNI.",
        at: "2026-08-21",
      },
    ],
    vehicle: {
      brand: "Fiat",
      model: "Cronos",
      licensePlate: "AF 412 KD",
      cargoCapacityLabel: "Baúl mediano · hasta 20 kg",
    },
    kycIdAttempts: [
      {
        s: "rejected",
        at: "2025-11-03",
        note: "La foto del DNI salió borrosa",
      },
      { s: "approved", at: "2025-11-04" },
    ],
    kycLicAttempts: [{ s: "approved", at: "2025-11-10" }],
    licExp: "2029-04-18",
    ratings: [
      {
        score: 5,
        by: "Julián Torres",
        role: "carrier",
        ship: "MOVO-48170",
        at: "2026-10-19",
        comment: "Puntual y cuidadoso. Avisó cuando salía.",
      },
      {
        score: 4,
        by: "Micaela Luque",
        role: "carrier",
        at: "2026-10-03",
        comment: "Todo bien, llegó unos minutos tarde.",
      },
      {
        score: 3,
        by: "Bruno Castro",
        role: "carrier",
        at: "2026-06-29",
        comment: "Tardó en contestar el chat.",
      },
    ],
    reportsRecv: [
      {
        reason: "no_show",
        status: "pending",
        who: "Sofía Ríos",
        at: "2026-10-17",
        details:
          "Quedamos a las 9 y no apareció. Me avisó por chat a las 10:40.",
        entries: 1,
        photos: 0,
      },
      {
        reason: "damaged_package",
        status: "reviewed",
        who: "Julián Torres",
        at: "2026-09-02",
        details:
          "La caja llegó abollada en una esquina. El contenido estaba bien.",
        entries: 0,
        photos: 2,
      },
    ],
    reportsMade: [
      {
        reason: "harassment",
        status: "dismissed",
        who: "Hernán Molina",
        at: "2026-08-14",
        details:
          "Me escribió varias veces por fuera del chat después de la entrega.",
        entries: 0,
        photos: 0,
      },
    ],
    blocksMade: [{ name: "Hernán Molina", at: "2026-08-14" }],
    blocksRecv: [{ name: "Bruno Castro", at: "2026-06-30" }],
    sanctions: [
      {
        type: "temporary",
        days: 3,
        reason: "Tres no-show en una semana con envíos asignados.",
        adminId: uuid("Carla Benítez"),
        adminName: "Carla Benítez",
        createdAt: at("2026-07-08"),
        status: "lifted",
        liftedAt: at("2026-07-11"),
        liftedBy: "vencimiento automático",
      },
    ],
    ledger: [
      {
        type: "cash_commission",
        amount: 1240,
        status: "pending",
        at: "2026-10-15",
        ship: "MOVO-48170",
      },
      {
        type: "manual_adjustment",
        amount: -300,
        status: "settled",
        at: "2026-10-08",
        reason: "Compensación por demora en la acreditación de Mercado Pago",
        admin: "Tomás Ferreyra",
      },
      { type: "fee_offset", amount: -980, status: "settled", at: "2026-10-02" },
      {
        type: "cash_commission",
        amount: 980,
        status: "settled",
        at: "2026-09-27",
      },
      {
        type: "cancellation_penalty",
        amount: 1500,
        status: "voided",
        at: "2026-07-06",
      },
    ],
    devices: [
      {
        id: uuid("mv-d1"),
        platform: "android",
        deviceId: "7f3c9a10-SM-A546E",
        updatedAt: at("2026-10-19"),
      },
      {
        id: uuid("mv-d2"),
        platform: "ios",
        deviceId: "a91d44e2-iPhone13,2",
        updatedAt: at("2026-05-20"),
      },
    ],
    audit: [
      {
        id: uuid("mv-a1"),
        adminId: uuid("Carla Benítez"),
        adminName: "Carla Benítez",
        action: "user.suspend",
        reason: "Tres no-show en una semana con envíos asignados.",
        outcome: "succeeded",
        errorCode: null,
        createdAt: at("2026-07-08"),
      },
      {
        id: uuid("mv-a2"),
        adminId: uuid("Tomás Ferreyra"),
        adminName: "Tomás Ferreyra",
        action: "ledger.adjust",
        reason: "Compensación por demora en la acreditación de Mercado Pago",
        outcome: "succeeded",
        errorCode: null,
        createdAt: at("2026-10-08"),
      },
    ],
    mp: "linked",
  },
  "Renata Silva": { vehicle: null, ratings: [], devices: [] },
  "Hernán Molina": {
    notes: [
      {
        admin: "Tomás Ferreyra",
        body: "Disputa abierta por un paquete dañado: esperar fotos del emisor antes de resolver.",
        at: "2026-10-12",
      },
    ],
    vehicle: {
      brand: "Volkswagen",
      model: "Gol Trend",
      licensePlate: "AC 077 RT",
      cargoCapacityLabel: "Baúl chico · hasta 10 kg",
    },
    reportsRecv: [
      {
        reason: "harassment",
        status: "pending",
        who: "Florencia Díaz",
        at: "2026-10-11",
        details:
          "Me gritó en la puerta porque el paquete pesaba más de lo publicado.",
        entries: 2,
        photos: 0,
      },
      {
        reason: "damaged_package",
        status: "pending",
        who: "Carolina Sánchez",
        at: "2026-10-19",
        details: "El paquete llegó con la caja rota y el contenido golpeado.",
        entries: 0,
        photos: 3,
      },
      {
        reason: "harassment",
        status: "dismissed",
        who: "Marcos Vera",
        at: "2026-08-14",
        details:
          "Me escribió varias veces por fuera del chat después de la entrega.",
        entries: 0,
        photos: 0,
      },
    ],
    blocksRecv: [{ name: "Marcos Vera", at: "2026-08-14" }],
    sanctions: [
      {
        type: "temporary",
        days: 21,
        reason:
          "Reclamo por paquete roto y dos reportes por trato agresivo en 30 días.",
        adminId: uuid("Tomás Ferreyra"),
        adminName: "Tomás Ferreyra",
        createdAt: at("2026-10-12"),
        status: "active",
      },
    ],
    audit: [
      {
        id: uuid("hm-a1"),
        adminId: uuid("Tomás Ferreyra"),
        adminName: "Tomás Ferreyra",
        action: "user.suspend",
        reason:
          "Reclamo por paquete roto y dos reportes por trato agresivo en 30 días.",
        outcome: "succeeded",
        errorCode: null,
        createdAt: at("2026-10-12"),
      },
    ],
  },
  "Ezequiel Rojas": {
    reportsRecv: [
      {
        reason: "payment_issue",
        status: "reviewed",
        who: "Paula Méndez",
        at: "2026-09-20",
        details: "Me pidió que le transfiera aparte para “asegurar” el envío.",
        entries: 1,
        photos: 1,
      },
      {
        reason: "payment_issue",
        status: "reviewed",
        who: "Lucas Romero",
        at: "2026-09-11",
        details: "Quiso cobrarme en efectivo además del pago en la app.",
        entries: 0,
        photos: 0,
      },
    ],
    sanctions: [
      {
        type: "permanent",
        reason:
          "Pidió el pago por fuera de la app en dos envíos. Confirmado con los reportes revisados.",
        adminId: uuid("Carla Benítez"),
        adminName: "Carla Benítez",
        createdAt: at("2026-09-28"),
        status: "active",
      },
      {
        type: "temporary",
        days: 7,
        reason: "Cancelaciones tardías reiteradas.",
        adminId: uuid("Tomás Ferreyra"),
        adminName: "Tomás Ferreyra",
        createdAt: at("2026-06-02"),
        status: "lifted",
        liftedAt: at("2026-06-09"),
        liftedBy: "vencimiento automático",
      },
    ],
    ledger: [
      {
        type: "cancellation_penalty",
        amount: 1500,
        status: "pending",
        at: "2026-09-25",
        ship: "MOVO-48216",
      },
      {
        type: "cash_commission",
        amount: 800,
        status: "pending",
        at: "2026-09-18",
      },
    ],
    kycLicAttempts: [
      {
        s: "rejected",
        at: "2025-12-15",
        note: "La licencia no corresponde al titular del DNI",
      },
    ],
    mp: "revoked",
  },
  "Lorena Paz": {
    deletedAt: "2026-10-17",
    devices: [],
    handshake: null,
    reportsMade: [
      {
        reason: "other",
        status: "reviewed",
        who: "Gonzalo Díaz",
        at: "2026-09-09",
        details: "Dejó el paquete con el portero sin avisar.",
        entries: 0,
        photos: 1,
      },
    ],
  },
  "Valentina Sosa": {
    kycLicAttempts: [
      {
        s: "rejected",
        at: "2026-10-14",
        note: "La foto del dorso salió con reflejo",
      },
      {
        s: "manual_review",
        at: "2026-10-18",
        note: "Didit no pudo leer la fecha de vencimiento",
      },
    ],
    vehicle: {
      brand: "Honda",
      model: "Wave 110",
      licensePlate: "A 123 BCD",
      cargoCapacityLabel: "Caja trasera · hasta 5 kg",
    },
  },
}

/**
 * Volumen alto para probar la paginación: Diego Funes tiene 55 reportes recibidos, 12 bloqueos,
 * 45 movimientos de cuenta y 25 acciones en la bitácora.
 */
const BULK_NAME = "Diego Funes"
const day = (i: number) => `2026-0${1 + (i % 9)}-${10 + (i % 18)}`
const LEDGER_KINDS: [AdminLedgerType, number, AdminLedgerStatus][] = [
  ["cash_commission", 980, "settled"],
  ["fee_offset", -980, "settled"],
  ["cancellation_penalty", 1500, "voided"],
  ["voluntary_payment", -2000, "settled"],
  ["payment_surcharge", 310, "pending"],
]
const BULK_WHO = [
  "Ana Molina",
  "Julián Torres",
  "Paula Méndez",
  "Micaela Luque",
]
const BULK: Extra = {
  reportsRecv: Array.from({ length: 55 }, (_, i) => ({
    reason: (
      [
        "harassment",
        "no_show",
        "damaged_package",
        "payment_issue",
        "other",
      ] as const
    )[i % 5],
    status: (["pending", "reviewed", "dismissed"] as const)[i % 3],
    who: BULK_WHO[i % BULK_WHO.length],
    at: day(i),
    details: `Reporte de prueba número ${i + 1}.`,
    entries: i % 4 === 0 ? 1 : 0,
    photos: i % 6 === 0 ? 2 : 0,
  })),
  blocksMade: Array.from({ length: 12 }, (_, i) => ({
    name: `Persona bloqueada ${i + 1}`,
    at: day(i),
  })),
  ledger: Array.from({ length: 45 }, (_, i) => {
    const [type, amount, status] = LEDGER_KINDS[i % LEDGER_KINDS.length]
    return { type, amount, status, at: day(i) }
  }),
  audit: Array.from({ length: 25 }, (_, i) => ({
    id: uuid(`bulk-audit${i}`),
    adminId: uuid("Carla Benítez"),
    adminName: "Carla Benítez",
    action: i % 2 ? "ledger.adjust" : "user.suspend",
    reason: `Acción de prueba número ${i + 1}.`,
    outcome: "succeeded" as const,
    errorCode: null,
    createdAt: at(day(i)),
  })),
}

const VEH: [string, string, string][] = [
  ["Toyota", "Etios", "Baúl mediano · hasta 15 kg"],
  ["Renault", "Kangoo", "Utilitario · hasta 120 kg"],
  ["Peugeot", "208", "Baúl chico · hasta 10 kg"],
  ["Chevrolet", "Onix", "Baúl mediano · hasta 15 kg"],
]
const COMMENTS = [
  "Muy amable, todo según lo acordado.",
  "Respondió rápido el chat.",
  "Llegó a tiempo.",
  null,
]
const RATERS = [
  "Ana Molina",
  "Julián Torres",
  "Paula Méndez",
  "Diego Funes",
  "Micaela Luque",
]

// code, status, from, to, sender, carrier, receiver, price, date — mismos envíos que el prototipo de Envíos
type ShipRow = [
  string,
  AdminShipmentStatus,
  string,
  string,
  string,
  string | null,
  string,
  number,
  string,
]
const SHIPS: ShipRow[] = [
  [
    "MOVO-48213",
    "in_transit",
    "Alberdi",
    "Maldonado",
    "Ana Molina",
    "Diego Funes",
    "Luis Herrera",
    6800,
    "2026-10-19",
  ],
  [
    "MOVO-48207",
    "in_transit",
    "Cerro de las Rosas",
    "Nueva Córdoba",
    "Sofía Ríos",
    "Marcos Vera",
    "Julia Peralta",
    9200,
    "2026-10-19",
  ],
  [
    "MOVO-48199",
    "in_transit",
    "Alta Córdoba",
    "Jardín",
    "Camila Ortiz",
    "Nicolás Paz",
    "Rocío Medina",
    7400,
    "2026-10-19",
  ],
  [
    "MOVO-48195",
    "in_transit",
    "Villa Cabrera",
    "General Paz",
    "Facundo Gil",
    "Valentina Sosa",
    "Pedro Luna",
    5900,
    "2026-10-19",
  ],
  [
    "MOVO-48188",
    "in_transit",
    "Argüello",
    "Centro",
    "Martina Ruiz",
    "Gonzalo Díaz",
    "Emilia Vega",
    11300,
    "2026-10-19",
  ],
  [
    "MOVO-48214",
    "assigned",
    "Villa Azalais",
    "Villa Revol",
    "Bruno Castro",
    "Agustina Ponce",
    "Lautaro Ríos",
    6100,
    "2026-10-19",
  ],
  [
    "MOVO-48216",
    "assigned",
    "San Salvador",
    "Villa El Libertador",
    "Paula Méndez",
    "Ezequiel Rojas",
    "Brenda Arias",
    8000,
    "2026-10-19",
  ],
  [
    "MOVO-48201",
    "assigned_unfunded",
    "Centro",
    "Argüello",
    "Lucas Romero",
    "Tomás Aguirre",
    "Milagros Cruz",
    7900,
    "2026-10-19",
  ],
  [
    "MOVO-48219",
    "assignment_pending",
    "Maldonado",
    "Cerro de las Rosas",
    "Joaquín Herrera",
    "Mateo Ibarra",
    "Sol Navarro",
    10500,
    "2026-10-20",
  ],
  [
    "MOVO-48222",
    "published",
    "Nueva Córdoba",
    "Villa Cabrera",
    "Renata Silva",
    null,
    "Ignacio Ferrer",
    6400,
    "2026-10-20",
  ],
  [
    "MOVO-48224",
    "awaiting_receiver_confirmation",
    "General Paz",
    "Alberdi",
    "Lorena Paz",
    null,
    "Ramiro Quiroga",
    5200,
    "2026-10-16",
  ],
  [
    "MOVO-48176",
    "disputed",
    "Jardín",
    "Alta Córdoba",
    "Florencia Díaz",
    "Hernán Molina",
    "Carolina Sánchez",
    8700,
    "2026-10-19",
  ],
  [
    "MOVO-48170",
    "delivered",
    "Villa El Libertador",
    "San Salvador",
    "Julián Torres",
    "Marcos Vera",
    "Abril Romero",
    6900,
    "2026-10-19",
  ],
  [
    "MOVO-48162",
    "completed",
    "Villa Revol",
    "Villa Azalais",
    "Micaela Luque",
    "Nicolás Paz",
    "Franco Vidal",
    7100,
    "2026-10-18",
  ],
  [
    "MOVO-48158",
    "cancelled",
    "Cerro de las Rosas",
    "General Paz",
    "Santiago Arce",
    null,
    "Daniela Moreno",
    5600,
    "2026-10-18",
  ],
  [
    "MOVO-48181",
    "rejected_by_receiver",
    "Alberdi",
    "Villa Cabrera",
    "Gabriel Ledesma",
    null,
    "Victoria Campos",
    6300,
    "2026-10-20",
  ],
  [
    "MOVO-48141",
    "completed",
    "Nueva Córdoba",
    "Jardín",
    "Micaela Luque",
    "Marcos Vera",
    "Franco Vidal",
    6200,
    "2026-10-14",
  ],
  [
    "MOVO-48127",
    "completed",
    "Centro",
    "Alta Córdoba",
    "Paula Méndez",
    "Marcos Vera",
    "Brenda Arias",
    5800,
    "2026-10-09",
  ],
  [
    "MOVO-48112",
    "cancelled",
    "Argüello",
    "Villa Cabrera",
    "Bruno Castro",
    "Marcos Vera",
    "Lautaro Ríos",
    7300,
    "2026-10-03",
  ],
  [
    "MOVO-48096",
    "completed",
    "General Paz",
    "Maldonado",
    "Julián Torres",
    "Marcos Vera",
    "Abril Romero",
    6600,
    "2026-09-27",
  ],
  [
    "MOVO-48071",
    "completed",
    "Cerro de las Rosas",
    "Centro",
    "Sofía Ríos",
    "Marcos Vera",
    "Julia Peralta",
    8100,
    "2026-09-19",
  ],
  [
    "MOVO-48044",
    "completed",
    "Alberdi",
    "San Salvador",
    "Ana Molina",
    "Marcos Vera",
    "Luis Herrera",
    5400,
    "2026-09-08",
  ],
  [
    "MOVO-48018",
    "completed",
    "Villa Revol",
    "Nueva Córdoba",
    "Gabriel Ledesma",
    "Marcos Vera",
    "Victoria Campos",
    6900,
    "2026-08-30",
  ],
]

const toShipment = (
  r: ShipRow,
  userRole: AdminShipmentRole
): AdminUserShipment => {
  const id = uuid(r[0])
  return {
    id,
    shortId: id.slice(0, 8).toUpperCase(),
    status: r[1],
    pickupAddress: r[2],
    deliveryAddress: r[3],
    priceArs: r[7],
    createdAt: at(r[8]),
    userRole,
    sender: ref(r[4]),
    carrier: r[5] ? ref(r[5]) : null,
    receiver: ref(r[6]),
  }
}

const shipsOf = (name: string) => ({
  sender: SHIPS.filter((s) => s[4] === name).map((r) =>
    toShipment(r, "sender")
  ),
  carrier: SHIPS.filter((s) => s[5] === name).map((r) =>
    toShipment(r, "carrier")
  ),
  receiver: SHIPS.filter((s) => s[6] === name).map((r) =>
    toShipment(r, "receiver")
  ),
})

// --- Respuestas por sección -----------------------------------------------------------------

const extraOf = (s: Seed): Extra =>
  s.name === BULK_NAME ? { ...EXTRA[s.name], ...BULK } : (EXTRA[s.name] ?? {})
const isCarrier = (s: Seed) => s.roles.includes("carrier")

export function mockProfile(s: Seed): AdminUserProfile {
  const [firstName, ...rest] = s.name.split(" ")
  const grantedLicense = extraOf(s).kycLicAttempts?.find(
    (a) => a.s === "approved"
  )?.at
  return {
    id: s.id,
    firstName,
    lastName: rest.join(" "),
    fullName: s.name,
    email: s.email,
    emailVerified: true,
    phone: s.phone,
    phoneVerified: true,
    dni: s.dni,
    birthdate: s.birth,
    photoUrl: null,
    createdAt: at(s.created),
    deletedAt: extraOf(s).deletedAt ? at(extraOf(s).deletedAt as string) : null,
    roles: s.roles.map((role, i) => ({
      role,
      grantedAt: at(i === 0 ? s.created : (grantedLicense ?? s.created)),
    })),
    accountStatus: s.status,
    bannedUntil: s.until,
  }
}

function kycCard(
  status: AdminKycStatus,
  attempts: { s: AdminKycStatus; at: string; note?: string }[] | undefined,
  created: string,
  seed: string,
  expiresAt?: string | null
): AdminKycCard {
  const list =
    attempts ?? (status === "not_started" ? [] : [{ s: status, at: created }])
  return {
    status,
    lastSessionId:
      status === "not_started" ? null : `ses_${uuid(seed).slice(0, 12)}`,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    attempts: list.map((a) => ({
      status: a.s,
      requestedAt: at(a.at),
      resolvedAt: a.s === "pending" ? null : at(a.at),
      reason: a.note ?? null,
    })),
  }
}

export function mockKyc(s: Seed): AdminUserKyc {
  const x = extraOf(s)
  const h = hash(s.name)
  const licExp =
    x.licExp ??
    (s.kycLic === "approved" ? `20${28 + (h % 4)}-0${1 + (h % 9)}-15` : null)
  const mp =
    x.mp ?? (isCarrier(s) && s.kycLic === "approved" ? "linked" : "not_linked")
  return {
    identity: kycCard(s.kycId, x.kycIdAttempts, s.created, `${s.name}kid`),
    license: kycCard(
      s.kycLic,
      x.kycLicAttempts,
      s.created,
      `${s.name}lic`,
      licExp
    ),
    mercadoPago: {
      status: mp,
      nickname:
        mp === "not_linked" ? null : s.name.toUpperCase().replace(/\s+/g, "_"),
      connectedAt: mp === "not_linked" ? null : at("2026-03-02"),
      unlinkedAt: mp === "revoked" ? at("2026-09-30") : null,
    },
  }
}

export function mockVehicle(s: Seed): AdminUserVehicle {
  const x = extraOf(s)
  if (x.vehicle !== undefined) return { vehicle: x.vehicle }
  if (!isCarrier(s)) return { vehicle: null }
  const h = hash(s.name)
  const v = VEH[h % VEH.length]
  return {
    vehicle: {
      brand: v[0],
      model: v[1],
      cargoCapacityLabel: v[2],
      licensePlate: `A${"BCDEF"[h % 5]} ${100 + (h % 900)} ${"KLMNP"[h % 5]}Q`,
    },
  }
}

export function mockShipments(
  s: Seed,
  role: AdminShipmentRole,
  page: number,
  pageSize: number,
  status?: AdminShipmentStatus
) {
  const all = shipsOf(s.name)
  const list = status ? all[role].filter((r) => r.status === status) : all[role]
  const start = (page - 1) * pageSize
  return {
    items: list.slice(start, start + pageSize),
    page,
    pageSize,
    total: list.length,
    counts: {
      sender: all.sender.length,
      carrier: all.carrier.length,
      receiver: all.receiver.length,
    },
  }
}

export function mockTrips(
  s: Seed,
  page: number,
  pageSize: number
): AdminUserTripPage {
  if (!isCarrier(s)) return { items: [], page, pageSize, total: 0 }
  const trips: AdminUserTripPage["items"] = [
    {
      id: uuid(`${s.name}t1`),
      originAddress: "Nueva Córdoba, Córdoba",
      destinationAddress: "Villa Carlos Paz, Córdoba",
      departureAt: "2026-10-22T11:00:00.000Z",
      vehicleType: "Auto",
      status: "declared",
      recurring: true,
    },
    {
      id: uuid(`${s.name}t2`),
      originAddress: "Centro, Córdoba",
      destinationAddress: "Jardín, Córdoba",
      departureAt: "2026-10-19T13:30:00.000Z",
      vehicleType: "Auto",
      status: "active",
      recurring: false,
    },
    {
      id: uuid(`${s.name}t3`),
      originAddress: "Alta Córdoba, Córdoba",
      destinationAddress: "Argüello, Córdoba",
      departureAt: "2026-10-12T12:00:00.000Z",
      vehicleType: "Auto",
      status: "completed",
      recurring: true,
    },
    {
      id: uuid(`${s.name}t4`),
      originAddress: "General Paz, Córdoba",
      destinationAddress: "Alberdi, Córdoba",
      departureAt: "2026-10-05T10:00:00.000Z",
      vehicleType: "Auto",
      status: "cancelled",
      recurring: false,
    },
  ]
  const start = (page - 1) * pageSize
  return {
    items: trips.slice(start, start + pageSize),
    page,
    pageSize,
    total: trips.length,
  }
}

export function mockRatings(
  s: Seed,
  page: number,
  pageSize: number
): AdminUserRatings {
  const x = extraOf(s)
  const h = hash(s.name)
  const explicit = x.ratings ?? []
  const rows = [
    ...explicit,
    ...(s.nRatings > explicit.length
      ? Array.from(
          { length: s.nRatings - explicit.length },
          (_, k) => k + explicit.length
        )
          .map((i) => ({
            score: 5 - ((h >> (i % 8)) & 1),
            by: RATERS[(h + i) % RATERS.length],
            role: (isCarrier(s) ? "carrier" : "sender") as AdminShipmentRole,
            at: day(i),
            comment: COMMENTS[(h + i) % COMMENTS.length],
            ship: `${s.name}-rating-${i}`,
          }))
          .filter((r) => r.by !== s.name)
      : []),
  ]
  const start = (page - 1) * pageSize
  return {
    average: s.nRatings ? s.rating : null,
    count: s.nRatings,
    page,
    pageSize,
    items: rows.slice(start, start + pageSize).map((r) => ({
      score: r.score,
      comment: r.comment,
      rater: ref(r.by),
      roleOfRated: r.role,
      shipmentId: uuid(r.ship ?? `${s.name}${r.by}`),
      createdAt: at(r.at),
    })),
  }
}

const toReport = (
  r: ExtraReport,
  i: number,
  seed: string
): AdminUserReport => ({
  id: uuid(`${seed}${i}${r.at}`),
  reason: r.reason,
  status: r.status,
  counterpart: { ...ref(r.who), photoUrl: null },
  details: r.details,
  createdAt: at(r.at),
  extraEntries: r.entries,
  photos: r.photos,
})

export function mockModeration(s: Seed): AdminUserModeration {
  const x = extraOf(s)
  const block = (b: { name: string; at: string }) => ({
    user: { ...ref(b.name), photoUrl: null },
    createdAt: at(b.at),
  })
  const cap = <T>(list: T[]) => list.slice(0, ADMIN_USER_MODERATION_LIMIT)
  const recv = (x.reportsRecv ?? []).map((r, i) =>
    toReport(r, i, `${s.name}rv`)
  )
  const made = (x.reportsMade ?? []).map((r, i) =>
    toReport(r, i, `${s.name}mk`)
  )
  const bMade = (x.blocksMade ?? []).map(block)
  const bRecv = (x.blocksRecv ?? []).map(block)
  return {
    reports: { received: cap(recv), made: cap(made) },
    blocks: { made: cap(bMade), received: cap(bRecv) },
    totals: {
      reportsReceived: recv.length,
      reportsMade: made.length,
      blocksMade: bMade.length,
      blocksReceived: bRecv.length,
    },
  }
}

export function mockSanctions(s: Seed): AdminUserSanctions {
  return { items: extraOf(s).sanctions ?? [] }
}

/** El cursor del mock es el desplazamiento; el de `svc-admin` será opaco, el panel no lo interpreta. */
const page = <T>(rows: T[], cursor: string | undefined, limit: number) => {
  const start = Number(cursor) || 0
  const end = start + limit
  return {
    slice: rows.slice(start, end),
    start,
    next: end < rows.length ? String(end) : null,
  }
}

export function mockLedger(
  s: Seed,
  cursor?: string,
  limit = 20
): AdminUserLedger {
  const rows = extraOf(s).ledger ?? []
  const { slice, start, next } = page(rows, cursor, limit)
  return {
    balanceArs: rows
      .filter((r) => r.status !== "voided")
      .reduce((sum, r) => sum + r.amount, 0),
    items: slice.map((r, k) => ledgerRow(s, r, start + k)),
    nextCursor: next,
  }
}

function ledgerRow(
  s: Seed,
  r: ExtraLedger,
  i: number
): AdminUserLedger["items"][number] {
  return {
    id: uuid(`${s.name}l${i}`),
    type: r.type,
    amountArs: r.amount,
    status: r.status,
    shipmentId: r.ship ? uuid(r.ship) : null,
    reason: r.reason ?? null,
    adminName: r.admin ?? null,
    createdAt: at(r.at),
  }
}

export function mockNotes(s: Seed): AdminUserNote[] {
  return (extraOf(s).notes ?? [])
    .map((n, i) => ({
      id: uuid(`${s.name}n${i}`),
      body: n.body,
      adminId: uuid(n.admin),
      adminName: n.admin,
      createdAt: at(n.at),
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function mockDevices(s: Seed): AdminUserDevices {
  const x = extraOf(s)
  const h = hash(s.name)
  const ios = h % 2 === 1
  return {
    devices: x.devices ?? [
      {
        id: uuid(`${s.name}d`),
        platform: ios ? "ios" : "android",
        deviceId: `${uuid(`${s.name}d`).slice(0, 8)}-${ios ? "iPhone14,5" : "XT2347"}`,
        updatedAt: at(`2026-10-1${h % 9}`),
      },
    ],
    handshakeKey:
      x.handshake === null
        ? null
        : { registeredAt: at(x.handshake ?? s.created) },
  }
}

export function mockAudit(
  s: Seed,
  cursor?: string,
  limit = 20
): AdminUserAuditPage {
  const { slice, next } = page(extraOf(s).audit ?? [], cursor, limit)
  return { items: slice, nextCursor: next }
}
