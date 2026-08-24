import { router } from "expo-router";
import { Package } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { usePublicProfile } from "../../src/hooks/use-profile";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { getFirstName } from "../../src/lib/profile-format";
import { useAuthStore } from "../../src/store/auth-store";
import { ShipmentStatusBadge } from "./status-badge";

/**
 * Fila de envío usada por `RecentShipmentsSection` (preview de Home, MOVO-83).
 * Muestra "Envío a [Nombre]" o "Envío de [Nombre]" según el rol, y el badge de estado.
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
  const counterpartId = isReceiver ? shipment.senderId : shipment.receiverId;
  const { data: counterpartProfile } = usePublicProfile(counterpartId);
  const counterpartName = getFirstName(counterpartProfile?.fullName);

  const title = isReceiver
    ? counterpartName
      ? `Envío de ${counterpartName}`
      : "Envío recibido"
    : counterpartName
      ? `Envío a ${counterpartName}`
      : "Envío realizado";

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
          {title}
        </Text>
      </View>
      <ShipmentStatusBadge status={shipment.status} isReceiver={isReceiver} />
    </Pressable>
  );
}
