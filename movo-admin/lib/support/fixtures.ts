/**
 * Datos de prueba de la bandeja de soporte (MOVO-323), portados de `Movo Admin Soporte.dc.html`.
 * Solo los usa `mock.ts` mientras MOVO-321/322 no estén desplegados. Se arman con la forma de
 * `@movo/shared` (`Support*`), así el panel no depende de que sea un mock. El prototipo no tiene
 * calificaciones (decisión 4 de MOVO-319), así que no se portan.
 */
import type {
  SupportPriority,
  SupportStatus,
  SupportTag,
  SupportTopic,
  SupportUserRole,
  SupportVerificationBadge,
} from "@movo/shared/src/types/admin-support"
import { uuid } from "@/lib/users/fixtures"

/** Alias del admin logueado en los fixtures: el mock lo reemplaza por el id real de la sesión. */
export const ME = "tf"

export const AGENT_NAMES: Record<string, string> = {
  tf: "Tomás Ferreyra",
  lb: "Lucía Bustos",
  mr: "Martín Ríos",
  sp: "Sofía Peralta",
}

export type FixtureMessage =
  | { k: "u"; ago: number; b: string; img?: number }
  | { k: "a"; ago: number; b: string; by: string; img?: number }
  | { k: "note"; ago: number; b: string; by: string }
  | { k: "sys"; ago: number; b: string; by?: string }

type ShipTone = "success" | "danger" | "info" | "warning" | "neutral"
export interface FixtureShipment {
  code: string
  statusLabel: string
  tone: ShipTone
  route: string
}

export interface FixtureUser {
  name: string
  role: SupportUserRole
  /** "mar 2025" → antigüedad en meses desde `MOCK_NOW`. */
  monthsAgo: number
  email: string
  phone: string
  rating: number | null
  ratingCount: number
  shipmentCount: number
  tripCount: number
  badges: SupportVerificationBadge[]
  ships: FixtureShipment[]
  history: { topic: SupportTopic; status: SupportStatus; daysAgo: number }[]
}

export interface FixtureConversation {
  num: number
  topic: SupportTopic
  priority: SupportPriority
  status: SupportStatus
  agent: string | null
  tags: SupportTag[]
  link: string | null
  unread: number
  /** Minutos que espera sin respuesta (solo `open`). */
  wait: number
  user: FixtureUser
  msgs: FixtureMessage[]
  /** Respuestas que el mock "escribe" por el usuario cuando un agente le contesta. */
  replies: string[]
}

const u = (
  name: string,
  role: SupportUserRole,
  monthsAgo: number,
  email: string,
  phone: string,
  stats: [number | null, number, number, number],
  badges: SupportVerificationBadge[],
  ships: FixtureShipment[],
  history: FixtureUser["history"]
): FixtureUser => ({
  name,
  role,
  monthsAgo,
  email,
  phone,
  rating: stats[0],
  ratingCount: stats[1],
  shipmentCount: stats[2],
  tripCount: stats[3],
  badges,
  ships,
  history,
})

const S = (
  code: string,
  statusLabel: string,
  tone: ShipTone,
  route: string
): FixtureShipment => ({ code, statusLabel, tone, route })

export const SEED: FixtureConversation[] = [
  {
    num: 1042,
    topic: "shipment",
    priority: "urgent",
    status: "open",
    agent: "tf",
    tags: ["Disputa", "Daño"],
    link: "MOVO-48176",
    unread: 1,
    wait: 6,
    user: u(
      "Carolina Sánchez",
      "receiver",
      19,
      "caro.sanchez@gmail.com",
      "+54 351 612 4410",
      [4.9, 12, 12, 0],
      ["identity", "kyc_approved"],
      [
        S("MOVO-48176", "En disputa", "danger", "Güemes → Cofico"),
        S("MOVO-47920", "Completado", "success", "Centro → Cofico"),
      ],
      [{ topic: "shipment", status: "resolved", daysAgo: 59 }]
    ),
    msgs: [
      {
        k: "u",
        ago: 52,
        b: "Hola, me llegó la lámpara partida al medio. ¿Qué hago?",
      },
      { k: "sys", ago: 51, b: "Tomás Ferreyra tomó la conversación", by: "tf" },
      {
        k: "a",
        ago: 46,
        by: "tf",
        b: "Hola Carolina, lo lamento mucho. ¿Me mandás una foto de la caja y de la lámpara?",
      },
      {
        k: "u",
        ago: 40,
        b: "Ahí van. La caja estaba sana por fuera, eso es lo raro.",
        img: 2,
      },
      {
        k: "note",
        ago: 35,
        by: "tf",
        b: "Hernán (transportista) dice que la entregó sana. Pedirle a Florencia fotos del momento del retiro.",
      },
      { k: "u", ago: 6, b: "¿Cuánto tarda en resolverse esto?" },
    ],
    replies: ["Dale, gracias. Espero novedades.", "Perfecto, quedo atenta."],
  },
  {
    num: 1045,
    topic: "payments",
    priority: "high",
    status: "open",
    agent: null,
    tags: ["Cobro"],
    link: "MOVO-48162",
    unread: 2,
    wait: 9,
    user: u(
      "Diego Fernández",
      "carrier",
      21,
      "diegof.moto@gmail.com",
      "+54 351 488 2091",
      [4.8, 64, 3, 64],
      ["identity", "license_valid"],
      [
        S("MOVO-48162", "Completado", "success", "Alta Córdoba → Centro"),
        S("MOVO-48213", "En camino", "info", "Alberdi → Maldonado"),
      ],
      [
        { topic: "payments", status: "resolved", daysAgo: 47 },
        { topic: "account", status: "resolved", daysAgo: 99 },
      ]
    ),
    msgs: [
      {
        k: "u",
        ago: 10,
        b: "Hice 3 entregas ayer y no me aparece la plata en Mercado Pago.",
      },
      { k: "u", ago: 9, b: "La última fue la MOVO-48162." },
    ],
    replies: [
      "Ah, buenísimo. Entonces espero a mañana.",
      "Gracias por la rapidez.",
    ],
  },
  {
    num: 1039,
    topic: "account",
    priority: "normal",
    status: "open",
    agent: null,
    tags: ["KYC"],
    link: null,
    unread: 1,
    wait: 23,
    user: u(
      "Martina López",
      "sender",
      0,
      "martilopez@hotmail.com",
      "+54 351 700 1182",
      [null, 0, 0, 0],
      ["kyc_pending"],
      [],
      []
    ),
    msgs: [
      {
        k: "u",
        ago: 23,
        b: "La app me rechaza la foto del DNI, ya probé 4 veces. ¿Qué estoy haciendo mal?",
      },
    ],
    replies: ["¡Ahora sí! Me la aceptó.", "Lo pruebo y te aviso."],
  },
  {
    num: 1047,
    topic: "security",
    priority: "urgent",
    status: "open",
    agent: "mr",
    tags: ["Escalado"],
    link: "MOVO-48176",
    unread: 0,
    wait: 3,
    user: u(
      "Hernán Molina",
      "carrier",
      23,
      "hernan.molina@gmail.com",
      "+54 351 655 7720",
      [4.7, 118, 0, 118],
      ["identity", "license_valid"],
      [S("MOVO-48176", "En disputa", "danger", "Güemes → Cofico")],
      [{ topic: "payments", status: "resolved", daysAgo: 18 }]
    ),
    msgs: [
      {
        k: "u",
        ago: 8,
        b: "La receptora de un envío me está acusando de romper un paquete y me escribió por WhatsApp de mala manera.",
      },
      { k: "sys", ago: 7, b: "Martín Ríos tomó la conversación", by: "mr" },
      {
        k: "note",
        ago: 5,
        by: "mr",
        b: "Mismo envío que SOP-1042. Coordinar con Tomás antes de responder.",
      },
    ],
    replies: [
      "Ok, no le respondo más por fuera.",
      "Gracias, me quedo más tranquilo.",
    ],
  },
  {
    num: 1036,
    topic: "shipment",
    priority: "normal",
    status: "awaiting_user",
    agent: "lb",
    tags: [],
    link: "MOVO-48224",
    unread: 0,
    wait: 0,
    user: u(
      "Ramiro Quiroga",
      "receiver",
      0,
      "rquiroga@gmail.com",
      "+54 351 590 3317",
      [null, 0, 0, 0],
      ["identity"],
      [
        S(
          "MOVO-48224",
          "Esperando receptor",
          "warning",
          "Nueva Córdoba → General Paz"
        ),
      ],
      []
    ),
    msgs: [
      {
        k: "u",
        ago: 100,
        b: "Me llegó un envío para aceptar pero no conozco a la persona. ¿Es seguro?",
      },
      {
        k: "a",
        ago: 93,
        by: "lb",
        b: "Hola Ramiro. Sí: verificamos la identidad de quien envía y el paquete viaja con seguimiento en vivo. Si no esperabas nada, podés rechazarlo sin problema.",
      },
    ],
    replies: ["Ah, es mi tía. Ya lo acepté, gracias."],
  },
  {
    num: 1033,
    topic: "payments",
    priority: "normal",
    status: "awaiting_user",
    agent: "tf",
    tags: ["Cobro"],
    link: null,
    unread: 0,
    wait: 0,
    user: u(
      "Lorena Paz",
      "sender",
      16,
      "lorepaz@gmail.com",
      "+54 351 433 9065",
      [5, 8, 8, 0],
      ["identity", "kyc_approved"],
      [
        S(
          "MOVO-48224",
          "Esperando receptor",
          "warning",
          "Nueva Córdoba → General Paz"
        ),
      ],
      []
    ),
    msgs: [
      { k: "u", ago: 167, b: "Me cobraron dos veces el mismo envío." },
      {
        k: "a",
        ago: 161,
        by: "tf",
        b: "Hola Lorena. Veo un solo cobro; el otro movimiento es una reserva que se libera sola en hasta 48 h.",
      },
    ],
    replies: ["Ahí se liberó, gracias."],
  },
  {
    num: 1040,
    topic: "carrier",
    priority: "low",
    status: "open",
    agent: "sp",
    tags: ["Onboarding"],
    link: null,
    unread: 0,
    wait: 14,
    user: u(
      "Agustina Ríos",
      "sender",
      6,
      "agus.rios@gmail.com",
      "+54 351 377 2240",
      [4.6, 3, 3, 0],
      ["identity"],
      [],
      []
    ),
    msgs: [
      {
        k: "u",
        ago: 14,
        b: "Quiero empezar a llevar paquetes en mi camino al trabajo. ¿Necesito auto o puedo ir en bici?",
      },
    ],
    replies: ["¡Genial! Ya empiezo el registro."],
  },
  {
    num: 1028,
    topic: "shipment",
    priority: "normal",
    status: "resolved",
    agent: "tf",
    tags: [],
    link: "MOVO-48162",
    unread: 0,
    wait: 0,
    user: u(
      "Nicolás Paz",
      "carrier",
      20,
      "nico.paz@gmail.com",
      "+54 351 512 6604",
      [4.9, 41, 0, 41],
      ["identity", "license_valid"],
      [S("MOVO-48162", "Completado", "success", "Alta Córdoba → Centro")],
      []
    ),
    msgs: [
      {
        k: "u",
        ago: 1170,
        b: "El receptor no me abre y no contesta el teléfono.",
      },
      {
        k: "a",
        ago: 1167,
        by: "tf",
        b: "Le escribimos desde soporte. Esperá 10 minutos y si no aparece, coordinamos la devolución.",
      },
      { k: "u", ago: 1159, b: "Ya bajó, listo. Gracias." },
      {
        k: "sys",
        ago: 1158,
        b: "Tomás Ferreyra resolvió la conversación",
        by: "tf",
      },
    ],
    replies: [],
  },
  {
    num: 1021,
    topic: "account",
    priority: "low",
    status: "resolved",
    agent: "lb",
    tags: [],
    link: null,
    unread: 0,
    wait: 0,
    user: u(
      "Abril Romero",
      "receiver",
      17,
      "abril.romero@gmail.com",
      "+54 351 621 0098",
      [4.8, 6, 6, 0],
      ["identity"],
      [S("MOVO-48170", "Entregado", "success", "Centro → Nueva Córdoba")],
      []
    ),
    msgs: [
      { k: "u", ago: 1308, b: "¿Cómo cambio mi número de teléfono?" },
      {
        k: "a",
        ago: 1304,
        by: "lb",
        b: "Desde Perfil → Datos personales. Te va a llegar un código al número nuevo.",
      },
      {
        k: "sys",
        ago: 1290,
        b: "Lucía Bustos resolvió la conversación",
        by: "lb",
      },
    ],
    replies: [],
  },
]

/** Consulta que "entra" sola a los ~16 s (el `simulate` del prototipo). */
export const NEWCOMER: FixtureConversation = {
  num: 1048,
  topic: "shipment",
  priority: "high",
  status: "open",
  agent: null,
  tags: [],
  link: "MOVO-48213",
  unread: 1,
  wait: 0,
  user: u(
    "Valentina Gómez",
    "receiver",
    2,
    "valegomez@gmail.com",
    "+54 351 744 5531",
    [4.7, 5, 5, 0],
    ["identity"],
    [S("MOVO-48213", "En camino", "info", "Alberdi → Maldonado")],
    []
  ),
  msgs: [
    {
      k: "u",
      ago: 0,
      b: "Hace 20 minutos que el transportista no se mueve en el mapa. ¿Está todo bien?",
    },
  ],
  replies: ["Ahí se movió. Gracias por avisar."],
}

/**
 * Consulta del propio admin logueado: ejercita `403 ADMIN_CONFLICT_OF_INTEREST` (decisión 5 de
 * MOVO-286). El `user` se reemplaza por el admin de la sesión en el mock.
 */
export const OWN: FixtureConversation = {
  num: 1050,
  topic: "account",
  priority: "normal",
  status: "open",
  agent: "lb",
  tags: [],
  link: null,
  unread: 0,
  wait: 4,
  user: u(
    "",
    "sender",
    10,
    "",
    "+54 351 000 0000",
    [null, 0, 0, 0],
    ["identity"],
    [],
    []
  ),
  msgs: [
    {
      k: "u",
      ago: 4,
      b: "Probando cómo se ve una consulta mía en la bandeja.",
    },
  ],
  replies: [],
}

export const convId = (num: number) => uuid(`support-${num}`)
/** Mismo id que en `lib/users/fixtures`: el link a la ficha abre al usuario si existe allá. */
export const userId = (name: string) => uuid(name)
export const shipmentId = (code: string) => uuid(`support-ship-${code}`)
export const agentId = (key: string) => uuid(`support-agent-${key}`)

/** Imágenes de los fixtures: SVG chicos con la forma de una foto, servidos por el mock. */
export const MOCK_IMAGE_SIZES: [number, number][] = [
  [640, 480],
  [480, 640],
  [800, 450],
]
