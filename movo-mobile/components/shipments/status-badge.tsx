import { Text, View } from "react-native";
import type { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { shipmentStatusLabel, shipmentStatusTone } from "../../src/lib/shipment-format";

const TONE_BADGE_CLASS: Record<"success" | "warning" | "danger" | "info" | "neutral", string> = {
  success: "bg-success-100 text-success-700",
  warning: "bg-warning-100 text-warning-700",
  danger: "bg-danger-100 text-danger-700",
  info: "bg-info-100 text-info-700",
  neutral: "bg-bg-mute text-fg-2",
};

export interface ShipmentStatusBadgeProps {
  status: ShipmentStatus;
  testID?: string;
}

/** Extraído de `[id].tsx`/`recent-shipments-section.tsx` (duplicaban el mismo mapeo
 * tono→clase, MOVO-127) — único lugar que traduce `shipmentStatusTone` a clases de
 * NativeWind. */
export function ShipmentStatusBadge({ status, testID }: ShipmentStatusBadgeProps) {
  const tone = shipmentStatusTone(status);
  const [badgeBg, badgeText] = TONE_BADGE_CLASS[tone].split(" ");

  return (
    <View testID={testID} className={`rounded-full px-3 py-1.5 ${badgeBg}`}>
      <Text className={`font-sans-medium text-[12px] ${badgeText}`}>{shipmentStatusLabel(status)}</Text>
    </View>
  );
}
