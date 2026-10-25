import { Text, View } from "react-native";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { shipmentStatusLabel, shipmentStatusTone } from "../../src/lib/shipment-format";
import { TRANSIT_DELAYED_LABEL } from "../../src/lib/active-shipment-format";

const TONE_BADGE_CLASS: Record<"success" | "warning" | "danger" | "info" | "neutral", string> = {
  success: "bg-success-100 text-success-700",
  warning: "bg-warning-100 text-warning-700",
  danger: "bg-danger-100 text-danger-700",
  info: "bg-info-100 text-info-700",
  neutral: "bg-bg-mute text-fg-2",
};

export interface ShipmentStatusBadgeProps {
  status: ShipmentStatus;
  isReceiver?: boolean;
  /** MOVO-278 (DD-045): `in_transit` demorado -> "Demorado" en tono warning. */
  delayed?: boolean;
  /** Header del detalle: pill más chica y "Por confirmar" en vez de "Esperando al
   * receptor"/"Requiere tu confirmación", que empujaban el título a dos líneas. Para el
   * emisor va en neutro: no tiene nada que hacer, y la fila del receptor ya marca
   * "Pendiente" en ámbar. */
  compact?: boolean;
  testID?: string;
}

/** Extraído de `[id].tsx`/`recent-shipments-section.tsx` (duplicaban el mismo mapeo
 * tono→clase, MOVO-127) — único lugar que traduce `shipmentStatusTone` a clases de
 * NativeWind. */
export function ShipmentStatusBadge({ status, isReceiver, delayed, compact, testID }: ShipmentStatusBadgeProps) {
  const awaitingInHeader = compact && status === ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION;
  const tone = delayed ? "warning" : awaitingInHeader && !isReceiver ? "neutral" : shipmentStatusTone(status);
  const [badgeBg, badgeText] = TONE_BADGE_CLASS[tone].split(" ");
  const label = delayed
    ? TRANSIT_DELAYED_LABEL
    : awaitingInHeader
      ? "Por confirmar"
      : shipmentStatusLabel(status, { isReceiver });

  return (
    <View testID={testID} className={`rounded-full ${compact ? "px-2.5 py-1" : "px-3 py-1.5"} ${badgeBg}`}>
      <Text numberOfLines={1} className={`font-sans-medium text-[12px] ${badgeText}`}>
        {label}
      </Text>
    </View>
  );
}
