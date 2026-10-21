import type {
  SupportPriority,
  SupportStatus,
  SupportTopic,
  SupportUserRole,
} from "@movo/shared/src/types/admin-support"

/** Textos y tonos de la bandeja, tal cual el prototipo (`Movo Admin Soporte.dc.html`). */
export const TOPIC_LABEL: Record<SupportTopic, string> = {
  shipment: "Envío",
  payments: "Pagos",
  account: "Cuenta",
  carrier: "Ser transportista",
  security: "Seguridad",
}

/** Nombre del ícono de lucide por tema (se resuelve en `components/support/topic-icon.tsx`). */
export const TOPIC_ICON: Record<SupportTopic, string> = {
  shipment: "Package",
  payments: "Wallet",
  account: "BadgeCheck",
  carrier: "Bike",
  security: "ShieldAlert",
}

export const PRIORITY_LABEL: Record<SupportPriority, string> = {
  urgent: "Urgente",
  high: "Alta",
  normal: "Normal",
  low: "Baja",
}

export const STATUS_LABEL: Record<SupportStatus, string> = {
  open: "Abierto",
  awaiting_user: "Esperando al usuario",
  resolved: "Resuelto",
}

export const TAB_LABEL: Record<SupportStatus, string> = {
  open: "Abiertos",
  awaiting_user: "Esperando",
  resolved: "Resueltos",
}

export const EMPTY_TEXT: Record<SupportStatus, string> = {
  open: "Todo tranquilo por acá.",
  awaiting_user: "No hay conversaciones esperando respuesta del usuario.",
  resolved: "Todavía no hay conversaciones resueltas.",
}

export const ROLE_LABEL: Record<SupportUserRole, string> = {
  sender: "Emisor",
  carrier: "Transportista",
  receiver: "Receptor",
}
