import { ChevronDown } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeOut, useReducedMotion } from "react-native-reanimated";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatUnreadCount } from "../../src/lib/chat-format";
import { chatEnteringAnimation } from "./chat-bubble";

/**
 * MOVO-301: botón flotante "Ir al último mensaje". Aparece cuando el usuario se aleja del final de la
 * conversación y cuenta los mensajes ajenos que llegaron mientras estaba arriba (badge lima, el mismo
 * estilo que el de Inicio). Entra y sale con la animación de los mensajes nuevos.
 */
export function ScrollToBottomButton({
  visible,
  newCount,
  onPress,
  testID = "chat-scroll-bottom",
}: {
  visible: boolean;
  newCount: number;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useThemeColors();
  const reduceMotion = useReducedMotion();
  if (!visible) return null;
  return (
    <Animated.View
      testID={testID}
      entering={reduceMotion ? undefined : chatEnteringAnimation}
      exiting={reduceMotion ? undefined : FadeOut.duration(150)}
      style={{ position: "absolute", right: 14, bottom: 12 }}
    >
      <Pressable
        testID={`${testID}-btn`}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={newCount > 0 ? `Ir al último mensaje, ${newCount} nuevos` : "Ir al último mensaje"}
        className="h-11 w-11 items-center justify-center rounded-full border border-border-strong bg-bg"
        style={{ shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 }}
      >
        <ChevronDown size={20} color={colors.fg1} strokeWidth={2.2} />
        {newCount > 0 ? (
          <View
            testID={`${testID}-badge`}
            className="absolute -right-1 -top-1 h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-bg bg-lime-500 px-1"
          >
            <Text className="font-sans-semibold text-[10px] text-ink-950">{formatUnreadCount(newCount)}</Text>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
