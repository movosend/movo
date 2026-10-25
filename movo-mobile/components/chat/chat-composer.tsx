import { CHAT_MESSAGE_MAX_LENGTH } from "@movo/shared/dist/types/chat";
import * as Haptics from "expo-haptics";
import { type ReactNode, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import Svg, { Path, Rect } from "react-native-svg";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

/** Desde este largo se muestra el contador (el prototipo no lo tiene; es un aviso funcional discreto). */
const COUNTER_THRESHOLD = 800;

export interface ChatComposerProps {
  /** `false` cuando el chat está en solo lectura: se muestra la franja con el candado. */
  canWrite: boolean;
  readOnlyCopy: string;
  onSend: (body: string) => boolean;
  /** Largo máximo del texto; el chat del envío usa 1000 y soporte 2000 (MOVO-324). */
  maxLength?: number;
  /** Botón a la izquierda del campo (adjuntar fotos en soporte). */
  leftAction?: ReactNode;
  /** Franja sobre el campo (miniaturas de las fotos pendientes). */
  attachmentsSlot?: ReactNode;
  /** Deja enviar sin texto (hay fotos listas). */
  allowEmpty?: boolean;
  /** Bloquea el envío aunque haya texto (hay una foto subiendo o con error). */
  sendDisabled?: boolean;
  testID?: string;
}

/**
 * MOVO-284: campo + enviar, o la franja de solo lectura. Calcado del prototipo: campo de 44 px con
 * borde (`strong`, `fg` al enfocar) y sin relleno, y botón circular lima siempre lima.
 */
export function ChatComposer({
  canWrite,
  readOnlyCopy,
  onSend,
  maxLength = CHAT_MESSAGE_MAX_LENGTH,
  leftAction,
  attachmentsSlot,
  allowEmpty = false,
  sendDisabled = false,
  testID,
}: ChatComposerProps) {
  const colors = useThemeColors();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  // Al enviar, el botón "rebota" y el campo se vacía: así se nota que el mensaje salió.
  const reduceMotion = useReducedMotion();
  const sendScale = useSharedValue(1);
  const sendStyle = useAnimatedStyle(() => ({ transform: [{ scale: sendScale.value }] }));

  if (!canWrite) {
    return (
      <View testID={`${testID}-readonly`} className="flex-row items-center border-t border-border bg-bg-sub" style={{ paddingTop: 14, paddingHorizontal: 18, paddingBottom: 30, gap: 12 }}>
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={colors.fg3} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Rect x={5} y={11} width={14} height={9} rx={2} />
          <Path d="M8 11V8a4 4 0 018 0v3" />
        </Svg>
        <Text className="flex-1 font-sans text-small text-fg-2">{readOnlyCopy}</Text>
      </View>
    );
  }

  const trimmed = text.trim();
  const canSend = (trimmed.length > 0 || allowEmpty) && trimmed.length <= maxLength && !sendDisabled;
  const handleSend = () => {
    if (!canSend) return;
    if (onSend(trimmed)) {
      setText("");
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (!reduceMotion) sendScale.value = withSequence(withTiming(0.82, { duration: 70 }), withSpring(1, { damping: 8, stiffness: 300 }));
    }
  };

  return (
    <View className="bg-bg" style={{ paddingTop: 10, paddingHorizontal: 16, paddingBottom: 10 }}>
      {attachmentsSlot ? <View style={{ paddingBottom: 8 }}>{attachmentsSlot}</View> : null}
      <View className="flex-row items-end" style={{ gap: 8 }}>
        {leftAction}
        <View
          className="flex-1 justify-center"
          style={{ minHeight: 44, borderWidth: 1, borderColor: focused ? colors.fg1 : colors.borderStrong, borderRadius: 22, paddingHorizontal: 16 }}
        >
          <TextInput
            testID={`${testID}-input`}
            value={text}
            onChangeText={setText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Escribí un mensaje…"
            placeholderTextColor={colors.fg3}
            multiline
            maxLength={maxLength + 50}
            className="font-sans text-fg"
            style={{ fontSize: 15, minHeight: 42, maxHeight: 112, paddingVertical: 10 }}
          />
        </View>
        <Animated.View style={sendStyle}>
          <Pressable
            testID={`${testID}-send`}
            accessibilityLabel="Enviar"
            disabled={!canSend}
            onPress={handleSend}
            className="items-center justify-center"
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#C6F24A" }}
          >
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#0A0A0B" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <Path d="m5 12 7-7 7 7M12 19V5" />
            </Svg>
          </Pressable>
        </Animated.View>
      </View>
      {text.length >= Math.round((COUNTER_THRESHOLD * maxLength) / CHAT_MESSAGE_MAX_LENGTH) ? (
        <Text testID={`${testID}-counter`} className={`mt-1 text-right font-mono text-[10.5px] ${text.length > maxLength ? "text-danger-500" : "text-fg-3"}`}>
          {text.length}/{maxLength}
        </Text>
      ) : null}
    </View>
  );
}
