import { router } from "expo-router";
import { Package } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatShipmentPrice } from "../../src/lib/shipment-format";
import { ShipmentStatusBadge } from "./status-badge";

/**
 * Fila de envío reusada por `RecentShipmentsSection` (preview de Home, MOVO-83) y por
 * el listado completo "Mis Envíos" (`app/(app)/shipments/index.tsx`, MOVO-127) — antes
 * vivía duplicada como función interna de la primera.
 */
export function ShipmentRow({
  shipment,
  isFirst,
  testID,
}: {
  shipment: ShipmentSummary;
  isFirst: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();

  return (
    <Pressable
      testID={testID}
      onPress={() => router.push(`/shipments/${shipment.id}`)}
      className={`flex-row items-center gap-3 py-3 ${isFirst ? "" : "border-t border-border"}`}
    >
      <View className="h-9 w-9 items-center justify-center rounded-full bg-bg-mute">
        <Package size={16} strokeWidth={1.8} color={colors.fg3} />
      </View>
      <View className="flex-1">
        <Text numberOfLines={1} className="font-sans-medium text-small text-fg">
          {shipment.deliveryAddress}
        </Text>
        <Text className="mt-0.5 font-sans text-caption text-fg-3">
          {formatShipmentPrice(shipment.agreedPriceArs, shipment.suggestedPriceArs)}
        </Text>
      </View>
      <ShipmentStatusBadge status={shipment.status} />
    </Pressable>
  );
}
