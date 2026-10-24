import { Text, View } from "react-native";
import { formatChatTime } from "../../src/lib/chat-format";
import type { SupportEventCard } from "../../src/lib/support-format";

/** MOVO-324: evento del sistema ("Lucía tomó la conversación") como línea discreta, no la píldora lima del chat del envío. */
export function SupportEventLine({ card, testID }: { card: SupportEventCard; testID?: string }) {
  return (
    <View testID={testID} className="items-center" style={{ marginTop: 12, paddingHorizontal: 24 }}>
      <Text className="text-center font-sans text-fg-3" style={{ fontSize: 12, lineHeight: 16 }}>
        {card.text} · {formatChatTime(card.createdAt)}
      </Text>
    </View>
  );
}
