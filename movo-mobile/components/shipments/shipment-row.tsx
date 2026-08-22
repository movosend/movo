import { router } from "expo-router";
import { Package } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatShipmentPrice } from "../../src/lib/shipment-format";
import { useAuthStore } from "../../src/store/auth-store";
import { ShipmentStatusBadge } from "./status-badge";

/**
 * Fila de envío reusada por `RecentShipmentsSection` (preview de Home, MOVO-83) y por
 * el listado completo "Mis Envíos" (`app/(app)/shipments/index.tsx`, MOVO-127 / MOVO-132).
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
  const currentUserId = useAuthStore((s) => s.user?.userId);
  const isReceiver = currentUserId === shipment.receiverId;

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
        <View className="flex-row items-center gap-1.5">
          <View
            testID={testID ? `${testID}-role-tag` : undefined}
            className={`rounded px-1.5 py-0.5 ${isReceiver ? "bg-info-100" : "bg-bg-mute"}`}
          >
            <Text className={`font-sans-medium text-[10px] ${isReceiver ? "text-info-700" : "text-fg-2"}`}>
              {isReceiver ? "Recibís" : "Enviás"}
            </Text>
          </View>
          <Text numberOfLines={1} className="flex-1 font-sans-medium text-small text-fg">
            {shipment.deliveryAddress}
          </Text>
        </View>
        <Text className="mt-0.5 font-sans text-caption text-fg-3">
          {formatShipmentPrice(shipment.agreedPriceArs, shipment.suggestedPriceArs)}
        </Text>
      </View>
      <ShipmentStatusBadge status={shipment.status} isReceiver={isReceiver} />
    </Pressable>
  );
}
