import { type ReactNode, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
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
export const CHAT_ENTER_MS = 220;
const SENDING_OPACITY = 0.6;
const SPRING = { damping: 16, stiffness: 240, mass: 0.8 };

/**
 * Entrada del botón "ir al final": fade + deslizamiento corto desde abajo (las burbujas usan un valor compartido
 * propio, ver `ChatBubble`). La
 * `FlatList inverted` espeja la lista y también cada celda, así que el contenido de una burbuja queda
 * derecho (el doble espejo se cancela) y un `translateY` positivo se ve como venir desde abajo.
 */
export function chatEnteringAnimation() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 14 }] },
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
 * Envoltorio de una burbuja que llegó EN VIVO (MOVO-301): fade + deslizamiento desde abajo y, si es propia, un resorte
 * que la hace crecer desde su esquina; mientras se envía va atenuada y al confirmarse se "asienta". Solo las burbujas
 * que se animan lo montan: las del historial son `View`s simples sin valores compartidos ni mappers (con 30-60 mensajes
 * serían cientos de mappers al abrir y por cada página vieja).
 *
 * Los valores compartidos ARRANCAN en el estado inicial y se animan desde un efecto, en vez de usar `entering`: con
 * `entering` la burbuja se dibuja un cuadro en su estado final (blanca en modo oscuro) antes de que se aplique el
 * inicial, y se veía como un parpadeo.
 */
function LiveBubbleEnter({ mine, sending, children }: { mine: boolean; sending: boolean; children: ReactNode }) {
  const enter = useSharedValue(0);
  const opacity = useSharedValue(sending ? SENDING_OPACITY : 1);
  useEffect(() => {
    enter.value = mine ? withSpring(1, SPRING) : withTiming(1, { duration: CHAT_ENTER_MS });
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    opacity.value = withTiming(sending ? SENDING_OPACITY : 1, { duration: 180 });
    // `opacity` es un shared value (referencia estable en runtime real).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending]);
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, enter.value * 1.4) * opacity.value,
    transform: [{ translateY: (1 - enter.value) * 14 }, { scale: mine ? 0.82 + 0.18 * enter.value : 1 }],
  }));
  return (
    <Animated.View style={[{ transformOrigin: mine ? "right bottom" : "left bottom" }, style]}>{children}</Animated.View>
  );
}

/**
 * MOVO-284: una burbuja de la conversación, calcada del prototipo. Propia: fondo `fg` y texto `bg`
 * (negra en claro, blanca en oscuro). Ajena: `bg-mute`. Radios 20/20/6; el tilde se toca para ver
 * "Enviado / Entregado / Leído por todos".
 */
export function ChatBubble(props: ChatBubbleProps) {
  const reduceMotion = useReducedMotion();
  // Se decide al montar: si la burbuja entró en vivo queda con el envoltorio animado (para asentarse al confirmarse).
  const [animated] = useState(!!props.animateIn && !reduceMotion);
  const sending = props.message.localState === "sending";
  const row = <BubbleRow {...props} sending={sending} dimWhileSending={!animated} />;
  return animated ? (
    <LiveBubbleEnter mine={props.mine} sending={sending}>
      {row}
    </LiveBubbleEnter>
  ) : (
    row
  );
}

function BubbleRow({
  message,
  mine,
  authorLabel,
  showName,
  showAvatar,
  groupStart,
  avatar,
  onPressAvatar,
  onRetry,
  onDiscard,
  testID,
  sending,
  dimWhileSending,
}: ChatBubbleProps & { sending: boolean; dimWhileSending: boolean }) {
  const [statusOpen, setStatusOpen] = useState(false);
  const failed = message.localState === "failed";
  const status = message.deliveryStatus ?? (mine && !sending && !failed ? "sent" : null);

  return (
    <View
      testID={testID}
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
          testID={`${testID}-bubble`}
          className={mine ? "bg-fg" : "bg-bg-mute"}
          style={{
            borderRadius: 20,
            borderBottomRightRadius: mine ? 6 : 20,
            borderBottomLeftRadius: mine ? 20 : 6,
            paddingHorizontal: 14,
            paddingVertical: 10,
            // Con el envoltorio animado la atenuación la maneja él (y se asienta al confirmarse).
            opacity: dimWhileSending && sending ? SENDING_OPACITY : 1,
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
    </View>
  );
}
