import { Pressable, ScrollView, Text } from "react-native";

/** MOVO-284: respuestas rápidas por rol (prototipo: píldoras de 36 px, borde `strong`, 13/500). */
export function QuickReplies({ replies, onPick, testID }: { replies: readonly string[]; onPick: (text: string) => void; testID?: string }) {
  if (replies.length === 0) return null;
  return (
    <ScrollView
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      className="border-t border-border"
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 2 }}
      keyboardShouldPersistTaps="handled"
    >
      {replies.map((reply) => (
        <Pressable
          key={reply}
          testID={`${testID}-${reply}`}
          onPress={() => onPick(reply)}
          className="items-center justify-center rounded-full border border-border-strong bg-bg active:bg-bg-mute"
          style={{ height: 36, paddingHorizontal: 14 }}
        >
          <Text className="font-sans-medium text-small text-fg">{reply}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
