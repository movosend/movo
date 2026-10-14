import { CHAT_MODERATION_WARNING } from "@movo/shared/dist/types/chat";
import { TriangleAlert, X } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

/** MOVO-284: aviso al autor cuando el filtro tapó palabras de su mensaje. */
export function ModerationBanner({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const colors = useThemeColors();
  if (!visible) return null;
  return (
    <View testID="chat-moderation-banner" className="mx-4 mb-2 flex-row items-start gap-2.5 rounded-[12px] border border-border-strong bg-bg-sub px-3.5 py-3">
      <TriangleAlert size={18} color={colors.fg1} strokeWidth={2} />
      <Text className="flex-1 font-sans text-small text-fg-2">{CHAT_MODERATION_WARNING}</Text>
      <Pressable testID="chat-moderation-dismiss" accessibilityLabel="Cerrar aviso" onPress={onDismiss} hitSlop={10}>
        <X size={16} color={colors.fg3} strokeWidth={2} />
      </Pressable>
    </View>
  );
}
