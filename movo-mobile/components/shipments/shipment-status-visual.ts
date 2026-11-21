import type { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { ShipmentStatus as Status } from "@movo/shared/dist/types/shipment";
import {
  AlertTriangle,
  BadgeCheck,
  CircleSlash,
  Clock,
  Megaphone,
  PackageCheck,
  Scale,
  Truck,
  UserCheck,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react-native";
import { shipmentStatusTone } from "../../src/lib/shipment-format";

/** Ícono y tono de cada estado del envío: los comparten la línea de tiempo del detalle y las tarjetas del chat. */
export const SHIPMENT_STATUS_ICON: Record<ShipmentStatus, LucideIcon> = {
  [Status.AWAITING_RECEIVER_CONFIRMATION]: Clock,
  [Status.REJECTED_BY_RECEIVER]: CircleSlash,
  [Status.PUBLISHED]: Megaphone,
  // Entrar a `assignment_pending`/`assigned_unfunded` es aceptar una oferta, o sea elegir
  // al transportista (retiro cercano o lejano, MOVO-208).
  [Status.ASSIGNMENT_PENDING]: UserCheck,
  [Status.ASSIGNED_UNFUNDED]: UserCheck,
  // Pasar a `assigned` es reservar el pago: el transportista ya estaba elegido.
  [Status.ASSIGNED]: Wallet,
  [Status.IN_TRANSIT]: Truck,
  [Status.DELIVERED]: PackageCheck,
  // MOVO-208: entregado y pago liberado (MOVO-212) -- inalcanzable hasta esa historia.
  [Status.COMPLETED]: BadgeCheck,
  [Status.CANCELLED]: XCircle,
  [Status.DISPUTED]: AlertTriangle,
};

/** Mismo mapa de tonos que `ShipmentStatusBadge`, pero acá se necesita el hex del
 * icono además de la clase de fondo (los iconos de lucide reciben `color` en JS, no
 * className — mismo criterio que `CounterpartCard`). */
export const SHIPMENT_STATUS_TONE_STYLE: Record<
  ReturnType<typeof shipmentStatusTone>,
  { bgClass: string; iconColor: string | null }
> = {
  success: { bgClass: "bg-success-100", iconColor: "#16754A" },
  warning: { bgClass: "bg-warning-100", iconColor: "#A97714" },
  danger: { bgClass: "bg-danger-100", iconColor: "#972327" },
  info: { bgClass: "bg-info-100", iconColor: "#173EA3" },
  // Único tono sin hex propio: su fondo (`bg-mute`) sí cambia con el tema, así que el
  // icono tiene que seguir a `fg-3` en vez de quedar fijo en el valor light.
  neutral: { bgClass: "bg-bg-mute", iconColor: null },
};

/** Resolución de una disputa (`disputed → completed|cancelled`, DD-056): balanza en neutro, igual para todos los roles
 * y resultados. Con el color del estado de llegada, una resolución a favor del emisor (`cancelled`) se pintaba en rojo
 * aunque le dio la razón. El estado final lo dicen la etiqueta de la hoja y el texto por rol. */
export const DISPUTE_RESOLUTION_VISUAL: { Icon: LucideIcon; bgClass: string; iconColor: string | null } = {
  Icon: Scale,
  ...SHIPMENT_STATUS_TONE_STYLE.neutral,
};

/** Ícono y estilo de un estado, con el reloj neutro de respaldo. */
export function shipmentStatusVisual(status: ShipmentStatus): { Icon: LucideIcon; bgClass: string; iconColor: string | null } {
  return { Icon: SHIPMENT_STATUS_ICON[status] ?? Clock, ...SHIPMENT_STATUS_TONE_STYLE[shipmentStatusTone(status)] };
}
