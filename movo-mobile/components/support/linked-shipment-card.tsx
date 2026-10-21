import type { SupportConversationShipment } from "@movo/shared/dist/types/support";
import { ChevronRight, Package } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

/** MOVO-324: tarjeta del envío vinculado bajo el encabezado de la conversación. Tocarla abre el detalle del envío. */
export function LinkedShipmentCard({
  shipment,
  onPress,
  testID,
}: {
  shipment: SupportConversationShipment;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`Ver el envío ${shipment.code}`}
      onPress={onPress}
      className="mx-4 flex-row items-center rounded-[12px] border border-border bg-bg-sub px-3.5 py-3"
      style={{ gap: 10 }}
    >
      <Package size={18} color={colors.fg2} strokeWidth={1.8} />
      <View className="min-w-0 flex-1">
        <Text className="font-sans-semibold text-small text-fg" numberOfLines={1}>
          {shipment.code}
        </Text>
        <Text className="font-sans text-fg-3" style={{ fontSize: 12 }}>
          Envío vinculado
        </Text>
      </View>
      <ChevronRight size={18} color={colors.fg3} strokeWidth={1.8} />
    </Pressable>
  );
}
