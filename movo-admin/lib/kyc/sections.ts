import {
  Globe,
  IdCard,
  LayoutGrid,
  ScanFace,
  ShieldAlert,
  UserRound,
  type LucideIcon,
} from "lucide-react"

export type KycSectionId = "resumen" | "perfil" | "documentos" | "red" | "alertas" | "historial"

/** Secciones del caso, en el orden de la página y del índice lateral. */
export const KYC_SECTIONS: { id: KycSectionId; label: string; icon: LucideIcon }[] = [
  { id: "resumen", label: "Resumen", icon: LayoutGrid },
  { id: "perfil", label: "Perfil", icon: UserRound },
  { id: "documentos", label: "Documentos", icon: IdCard },
  { id: "red", label: "Red y dispositivo", icon: Globe },
  { id: "alertas", label: "Alertas", icon: ShieldAlert },
  { id: "historial", label: "Intentos", icon: ScanFace },
]

export const sectionAnchor = (id: KycSectionId) => `kyc-${id}`
