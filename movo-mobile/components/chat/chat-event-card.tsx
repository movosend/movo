import { ArrowLeftRight } from "lucide-react-native";
import { Text, View } from "react-native";
import {
  formatChatTime,
  type ChatEventCard as ChatEventCardData,
  type ChatEventGroupPosition,
} from "../../src/lib/chat-format";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { shipmentStatusVisual } from "../shipments/shipment-status-visual";

const ICON_SIZE = 32;
const PADDING_Y = 10;
const PADDING_LEFT = 12;

/**
 * Cambio del envío intercalado en la conversación, con el mismo lenguaje que la línea de tiempo del detalle: círculo
 * con el ícono y el color del estado, título y hora. Una transferencia de receptor, sin estado, lleva el ícono de
 * intercambio en neutro. Las tarjetas seguidas (`position`) forman un solo bloque: comparten el borde y un riel une
 * los círculos. Todas tienen el mismo ancho para que el riel quede alineado.
 */
export function ChatEventCard({
  card,
  position = "single",
  testID,
}: {
  card: ChatEventCardData;
  position?: ChatEventGroupPosition;
  testID?: string;
}) {
  const colors = useThemeColors();
  const visual = card.status
    ? shipmentStatusVisual(card.status)
    : { Icon: ArrowLeftRight, bgClass: "bg-bg-mute", iconColor: null };
  const { Icon } = visual;
  const isTop = position === "single" || position === "first";
  const isBottom = position === "single" || position === "last";
  const railLeft = PADDING_LEFT + ICON_SIZE / 2 - 1;
  const iconCenter = PADDING_Y + ICON_SIZE / 2;

  return (
    <View
      testID={testID}
      className="items-center"
      style={{ marginTop: isTop ? 12 : 0 }}
    >
      <View
        className="flex-row items-start border-border bg-bg"
        style={{
          width: "86%",
          gap: 10,
          paddingTop: PADDING_Y,
          paddingBottom: PADDING_Y,
          paddingLeft: PADDING_LEFT,
          paddingRight: 14,
          borderLeftWidth: 1,
          borderRightWidth: 1,
          borderTopWidth: isTop ? 1 : 0,
          borderBottomWidth: isBottom ? 1 : 0,
          borderTopLeftRadius: isTop ? 14 : 0,
          borderTopRightRadius: isTop ? 14 : 0,
          borderBottomLeftRadius: isBottom ? 14 : 0,
          borderBottomRightRadius: isBottom ? 14 : 0,
        }}
      >
        {/* Riel: del borde de arriba al círculo y del círculo al de abajo, según con qué se une. */}
        {!isTop ? (
          <View
            testID={testID ? `${testID}-rail-top` : undefined}
            className="absolute bg-border"
            style={{ left: railLeft, top: 0, width: 2, height: iconCenter }}
          />
        ) : null}
        {!isBottom ? (
          <View
            testID={testID ? `${testID}-rail-bottom` : undefined}
            className="absolute bg-border"
            style={{ left: railLeft, top: iconCenter, bottom: 0, width: 2 }}
          />
        ) : null}
        <View
          className={`items-center justify-center rounded-full ${visual.bgClass}`}
          style={{ width: ICON_SIZE, height: ICON_SIZE }}
        >
          <Icon
            size={16}
            strokeWidth={2}
            color={visual.iconColor ?? colors.fg3}
          />
        </View>
        <View className="shrink" style={{ gap: 2, paddingTop: 1 }}>
          <Text className="font-sans-semibold text-[13px] text-fg">
            {card.text}
          </Text>
          <Text
            testID={testID ? `${testID}-time` : undefined}
            className="font-sans text-[12px] text-fg-3"
          >
            {formatChatTime(card.createdAt)}
          </Text>
          {card.detail ? (
            <Text
              testID={testID ? `${testID}-detail` : undefined}
              className="font-sans text-[12px] leading-[17px] text-fg-2"
            >
              {card.detail}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}
