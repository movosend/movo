import type { ChatListItem } from "@movo/shared/dist/types/chat";
import { Pressable, Text, View } from "react-native";
import { activeShipmentDisplayCode } from "../../src/lib/active-shipment-format";
import { formatListTime, formatUnreadCount } from "../../src/lib/chat-format";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { ChatAvatar } from "./chat-avatar";

export function chatLastMessagePreview(item: ChatListItem, meId: string | undefined): string {
  const last = item.lastMessage;
  if (!last) return "Todavía no hay mensajes";
  if (last.hidden) return "Mensaje de un usuario bloqueado";
  const who = last.authorId === meId ? "Vos" : (last.authorName ?? "Alguien");
  return `${who}: ${last.body}`;
}

/** Posiciones del trío de avatares dentro de los 44x44 del prototipo (`cx`/`cy`). */
const CLUSTER = [
  { left: 0, top: 2 },
  { left: 18, top: 2 },
  { left: 9, top: 18 },
];

/**
 * MOVO-284: una fila de la lista "Chats", calcada del prototipo: tarjeta con borde y radio 14, trío de
 * avatares de 26 px a la izquierda, título 14/600 + hora, ruta y último mensaje con el contador lima.
 * Los chats archivados o de solo lectura van sin fondo y al 55 % de opacidad. Los avatares salen de
 * `item.participants` (emisor, transportista, receptor).
 */
export function ChatListRow({
  item,
  meId,
  onPress,
  testID,
}: {
  item: ChatListItem;
  meId: string | undefined;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useThemeColors();
  const dimmed = item.archived || item.access === "read_only";
  const unread = item.unreadCount > 0;
  const bg = dimmed ? "transparent" : colors.bgSub;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      className="flex-row items-center"
      style={{ gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: bg, opacity: dimmed ? 0.55 : 1 }}
    >
      <View style={{ width: 44, height: 44 }}>
        {CLUSTER.map((pos, index) => {
          // `participants` es nuevo en el backend: contra uno que todavía no lo manda (orden de deploy) la fila se dibuja
          // con círculos vacíos en vez de romper la lista.
          const avatar = (item.participants as ChatListItem["participants"] | undefined)?.[index];
          return (
            <View
              key={index}
              style={{
                position: "absolute",
                left: pos.left - 2,
                top: pos.top - 2,
                borderWidth: 2,
                borderColor: bg === "transparent" ? colors.bg : bg,
                borderRadius: 15,
              }}
            >
              <ChatAvatar fullName={avatar?.fullName ?? ""} photoUrl={avatar?.photoUrl ?? null} size={26} fontSize={8} />
            </View>
          );
        })}
      </View>
      <View className="min-w-0 flex-1" style={{ gap: 2 }}>
        <View className="flex-row items-baseline justify-between" style={{ gap: 8 }}>
          <Text className="font-sans-semibold text-fg" style={{ fontSize: 14 }} numberOfLines={1}>
            {activeShipmentDisplayCode(item.shipmentId)}
          </Text>
          <Text className="font-sans text-fg-3" style={{ fontSize: 11 }}>
            {formatListTime(item.lastActivityAt)}
          </Text>
        </View>
        <Text className="font-sans text-fg-3" style={{ fontSize: 12 }} numberOfLines={1}>
          {item.route}
        </Text>
        <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
          <Text className="flex-1 font-sans text-small text-fg-2" numberOfLines={1}>
            {chatLastMessagePreview(item, meId)}
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
      </View>
    </Pressable>
  );
}
