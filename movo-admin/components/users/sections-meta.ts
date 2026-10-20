import {
  Car,
  Flag,
  Gavel,
  NotebookPen,
  Route,
  ScanFace,
  ScrollText,
  Smartphone,
  Star,
  UserRound,
  UserX,
  Wallet,
  type LucideIcon,
} from "lucide-react"

export const SECTION_IDS = [
  "perfil",
  "kyc",
  "vehiculo",
  "actividad",
  "calificaciones",
  "reportes",
  "bloqueos",
  "sanciones",
  "cuenta",
  "dispositivos",
  "notas",
  "bitacora",
] as const

export type SectionId = (typeof SECTION_IDS)[number]

export interface SectionMeta {
  title: string
  /** Etiqueta corta del índice lateral. */
  label: string
  /** Complemento de "No pudimos cargar …". */
  noun: string
  hint?: string
  icon: LucideIcon
  /** Ruta de `svc-admin` que alimenta la sección (para mostrar en el error). */
  route: string
}

export const SECTION_META: Record<SectionId, SectionMeta> = {
  perfil: {
    title: "Datos y roles",
    label: "Datos y roles",
    noun: "los datos",
    icon: UserRound,
    route: "",
  },
  kyc: {
    title: "KYC",
    label: "KYC",
    noun: "el KYC",
    hint: "Verificación con didit",
    icon: ScanFace,
    route: "/kyc",
  },
  vehiculo: {
    title: "Vehículo",
    label: "Vehículo",
    noun: "el vehículo",
    icon: Car,
    route: "/vehicle",
  },
  actividad: {
    title: "Actividad",
    label: "Actividad",
    noun: "la actividad",
    icon: Route,
    route: "/shipments",
  },
  calificaciones: {
    title: "Calificaciones recibidas",
    label: "Calificaciones",
    noun: "las calificaciones",
    icon: Star,
    route: "/ratings",
  },
  reportes: {
    title: "Reportes",
    label: "Reportes",
    noun: "los reportes",
    icon: Flag,
    route: "/moderation",
  },
  bloqueos: {
    title: "Bloqueos",
    label: "Bloqueos",
    noun: "los bloqueos",
    hint: "El efecto es simétrico: ninguno de los dos se ve en la red",
    icon: UserX,
    route: "/moderation",
  },
  sanciones: {
    title: "Sanciones",
    label: "Sanciones",
    noun: "las sanciones",
    hint: "Historial · aplicar sanciones llega con MOVO-36",
    icon: Gavel,
    route: "/suspensions",
  },
  cuenta: {
    title: "Cuenta corriente",
    label: "Cuenta corriente",
    noun: "la cuenta corriente",
    icon: Wallet,
    route: "/ledger",
  },
  dispositivos: {
    title: "Dispositivos",
    label: "Dispositivos",
    noun: "los dispositivos",
    icon: Smartphone,
    route: "/devices",
  },
  notas: {
    title: "Notas internas",
    label: "Notas",
    noun: "las notas",
    hint: "Solo las ven admins · no se editan ni se borran",
    icon: NotebookPen,
    route: "/notes",
  },
  bitacora: {
    title: "Bitácora",
    label: "Bitácora",
    noun: "la bitácora",
    hint: "Acciones de admins sobre esta cuenta",
    icon: ScrollText,
    route: "/audit-log",
  },
}
