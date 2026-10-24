import type { SupportConversationItem } from "@movo/shared/dist/types/support";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatListTime, formatUnreadCount } from "../../src/lib/chat-format";
import { supportLastMessagePreview, supportTopicLabel } from "../../src/lib/support-format";
import { SupportStatusPill } from "./support-status-pill";

/**
 * MOVO-324: una fila de "Mis consultas", calcada de `ChatListRow` sin el trío de avatares (todas son con Movo):
 * tarjeta con borde y radio 14, tema + hora, píldora de estado con el código, vista previa y contador lima.
 * Las resueltas van sin fondo y atenuadas, como los chats archivados.
 */
export function SupportListRow({
  item,
  onPress,
  testID,
}: {
  item: SupportConversationItem;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useThemeColors();
  const dimmed = item.status === "resolved";
  const unread = item.unreadCount > 0;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{
        gap: 6,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 14,
        paddingVertical: 14,
        paddingHorizontal: 16,
        backgroundColor: dimmed ? "transparent" : colors.bgSub,
        opacity: dimmed ? 0.6 : 1,
      }}
    >
      <View className="flex-row items-baseline justify-between" style={{ gap: 8 }}>
        <Text className="flex-1 font-sans-semibold text-fg" style={{ fontSize: 14 }} numberOfLines={1}>
          {supportTopicLabel(item.topic)}
        </Text>
        <Text className="font-sans text-fg-3" style={{ fontSize: 11 }}>
          {formatListTime(item.lastActivityAt)}
        </Text>
      </View>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <SupportStatusPill status={item.status} testID={`${testID}-status`} />
        <Text className="font-mono text-fg-3" style={{ fontSize: 11 }}>
          {item.code}
        </Text>
      </View>
      <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
        <Text className="flex-1 font-sans text-small text-fg-2" numberOfLines={1}>
          {supportLastMessagePreview(item)}
        </Text>
        {unread ? (
          <View
            testID={`${testID}-unread`}
            className="items-center justify-center"
            style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "#C6F24A", paddingHorizontal: 6 }}
          >
            <Text className="font-sans-semibold" style={{ fontSize: 11, color: "#0A0A0B" }}>
              {formatUnreadCount(item.unreadCount)}
            </Text>
          </View>
        ) : null}
      </View>
      {item.shipment ? (
        <Text className="font-sans text-fg-3" style={{ fontSize: 12 }} numberOfLines={1}>
          Envío · {item.shipment.code}
        </Text>
      ) : null}
    </Pressable>
  );
}
