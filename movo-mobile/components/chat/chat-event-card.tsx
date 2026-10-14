import { Text, View } from "react-native";
import { formatChatTime, type ChatEventCard as ChatEventCardData } from "../../src/lib/chat-format";

/**
 * MOVO-284: tarjeta del envío intercalada en la conversación. En el prototipo todas son iguales: píldora
 * de 28 px en verde lima claro (`#EEFCBF`, igual en los dos temas) con punto y texto en tinta fija.
 */
export function ChatEventCard({ card, testID }: { card: ChatEventCardData; testID?: string }) {
  return (
    <View testID={testID} className="items-center" style={{ marginTop: 12 }}>
      <View className="flex-row items-center" style={{ height: 28, gap: 8, borderRadius: 999, paddingHorizontal: 12, backgroundColor: "#EEFCBF" }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#0A0A0B" }} />
        <Text style={{ fontSize: 12, lineHeight: 16, color: "#0A0A0B" }} className="font-sans-semibold">
          {card.text}
        </Text>
        <Text style={{ fontSize: 11, color: "#0A0A0B", opacity: 0.75 }} className="font-sans-medium">
          {formatChatTime(card.createdAt)}
        </Text>
      </View>
    </View>
  );
}
