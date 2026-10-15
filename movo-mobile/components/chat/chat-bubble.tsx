import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { useReducedMotion, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { deliveryStatusLabel, formatChatTime, type LocalChatMessage } from "../../src/lib/chat-format";
import { ChatAvatar } from "./chat-avatar";

export interface ChatBubbleProps {
  message: LocalChatMessage;
  mine: boolean;
  /** "Ana M. · Emisor", solo en la primera burbuja de un grupo ajeno. */
  authorLabel?: string;
  showName: boolean;
  /** Última burbuja del grupo: lleva el avatar (en las demás queda el hueco, como el prototipo). */
  showAvatar: boolean;
  groupStart: boolean;
  avatar?: { fullName: string; photoUrl: string | null };
  /** Tocar el avatar de quien escribió abre el detalle del envío. */
  onPressAvatar?: () => void;
  onRetry?: (clientMessageId: string) => void;
  onDiscard?: (clientMessageId: string) => void;
  /** Mensaje que llegó en vivo: entra con una animación corta (el historial no se anima). */
  animateIn?: boolean;
  testID?: string;
}

const AVATAR = 28;
export const CHAT_ENTER_MS = 200;

/**
 * Entrada de un mensaje nuevo y del botón "ir al final": fade + slide corto. La lista va invertida
 * (`scaleY: -1` en cada celda), así que el eje Y local está espejado: un `translateY` negativo se
 * ve como venir desde abajo.
 */
export function chatEnteringAnimation() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateY: -12 }] },
    animations: {
      opacity: withTiming(1, { duration: CHAT_ENTER_MS }),
      transform: [{ translateY: withTiming(0, { duration: CHAT_ENTER_MS }) }],
    },
  };
}
/** Verde lima del tilde en el prototipo (`tick: "#C6F24A"`, igual en claro y oscuro). */
const TICK_COLOR = "#C6F24A";

/** Tilde del prototipo: un check (enviado) o dos (entregado/leído), trazo de 2.2. */
function Ticks({ double }: { double: boolean }) {
  return (
    <Svg width={16} height={11} viewBox="0 0 24 16" fill="none" stroke={TICK_COLOR} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M18 3 7 14l-5-5" />
      {double ? <Path d="M22 9l-7.5 7.5L13 15" /> : null}
    </Svg>
  );
}

/**
 * MOVO-284: una burbuja de la conversación, calcada del prototipo. Propia: fondo `fg` y texto `bg`
 * (negra en claro, blanca en oscuro). Ajena: `bg-mute`. Radios 20/20/6; el tilde se toca para ver
 * "Enviado / Entregado / Leído por todos".
 */
export function ChatBubble({ message, mine, authorLabel, showName, showAvatar, groupStart, avatar, onPressAvatar, onRetry, onDiscard, animateIn, testID }: ChatBubbleProps) {
  const reduceMotion = useReducedMotion();
  const [statusOpen, setStatusOpen] = useState(false);
  const failed = message.localState === "failed";
  const sending = message.localState === "sending";
  const status = message.deliveryStatus ?? (mine && !sending && !failed ? "sent" : null);

  return (
    <Animated.View
      testID={testID}
      entering={animateIn && !reduceMotion ? chatEnteringAnimation : undefined}
      className={`flex-row items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}
      style={{ marginTop: groupStart ? 14 : 4 }}
    >
      {!mine ? (
        <Pressable
          testID={`${testID}-avatar`}
          accessibilityRole="button"
          accessibilityLabel="Ver el detalle del envío"
          disabled={!showAvatar || !onPressAvatar}
          onPress={onPressAvatar}
          style={{ width: AVATAR, height: AVATAR, opacity: showAvatar ? 1 : 0 }}
        >
          {avatar ? <ChatAvatar fullName={avatar.fullName} photoUrl={avatar.photoUrl} size={AVATAR} fontSize={9} /> : null}
        </Pressable>
      ) : null}

      <View className={`${mine ? "items-end" : "items-start"}`} style={{ maxWidth: "76%", gap: 3 }}>
        {showName && authorLabel ? (
          <Text className="px-1 pt-1 font-sans-semibold text-caption uppercase text-fg-3">{authorLabel}</Text>
        ) : null}

        <View
          className={mine ? "bg-fg" : "bg-bg-mute"}
          style={{
            borderRadius: 20,
            borderBottomRightRadius: mine ? 6 : 20,
            borderBottomLeftRadius: mine ? 20 : 6,
            paddingHorizontal: 14,
            paddingVertical: 10,
            opacity: sending ? 0.6 : 1,
          }}
        >
          {message.hidden ? (
            <Text className="font-sans text-body italic text-fg-3">Mensaje de un usuario bloqueado</Text>
          ) : (
            <Text className={`font-sans text-body ${mine ? "text-bg" : "text-fg"}`}>{message.body}</Text>
          )}
        </View>

        {failed ? (
          <View className="flex-row items-center gap-2 px-1">
            <Text className="font-sans text-[11px] text-danger-500">No se envió.</Text>
            <Pressable testID={`${testID}-retry`} onPress={() => onRetry?.(message.clientMessageId)} hitSlop={8}>
              <Text className="font-sans-semibold text-[11px] text-fg">Reintentar</Text>
            </Pressable>
            <Pressable testID={`${testID}-discard`} onPress={() => onDiscard?.(message.clientMessageId)} hitSlop={8}>
              <Text className="font-sans text-[11px] text-fg-3">Descartar</Text>
            </Pressable>
          </View>
        ) : (
          <View className="flex-row items-center px-1" style={{ gap: 5 }}>
            <Text className="font-sans text-[11px] text-fg-3">{sending ? "Enviando…" : formatChatTime(message.createdAt)}</Text>
            {mine && status ? (
              <Pressable
                testID={`${testID}-ticks`}
                accessibilityRole="button"
                accessibilityLabel={deliveryStatusLabel(status)}
                onPress={() => setStatusOpen((open) => !open)}
                className="flex-row items-center"
                style={{ gap: 5 }}
                hitSlop={8}
              >
                <Ticks double={status !== "sent"} />
                {statusOpen ? (
                  <Text testID={`${testID}-status`} className="font-sans text-[11px] text-fg-3">
                    {deliveryStatusLabel(status)}
                  </Text>
                ) : null}
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </Animated.View>
  );
}
