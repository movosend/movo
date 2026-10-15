import { MessageCircle } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { totalUnread, useChatList } from "../../src/hooks/use-chat";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { pushOnce } from "../../src/lib/navigation-guard";
import { formatUnreadCount } from "../../src/lib/chat-format";

/** MOVO-284: acceso a la lista "Chats" desde el header de Inicio, con el total de mensajes sin leer. */
export function HomeChatButton({ testID = "app-home-chats" }: { testID?: string }) {
  const colors = useThemeColors();
  const { data } = useChatList();
  const unread = totalUnread(data);

  return (
    <Pressable
      testID={testID}
      onPress={() => pushOnce("/(app)/chats")}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Chats, ${unread} sin leer` : "Chats"}
      className="h-9 w-9 items-center justify-center rounded-full bg-bg-mute"
    >
      <MessageCircle size={17} color={colors.fg1} strokeWidth={2} />
      {unread > 0 ? (
        <View
          testID={`${testID}-badge`}
          className="absolute -right-1 -top-1 h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-bg-sub bg-lime-500 px-1"
        >
          <Text className="font-sans-semibold text-[10px] text-ink-950">{formatUnreadCount(unread)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
