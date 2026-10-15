import * as Haptics from "expo-haptics";
import { MessageCircle } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { useChatList } from "../../src/hooks/use-chat";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { chatReadOnlyCopy } from "../../src/lib/chat-format";
import { pushOnce } from "../../src/lib/navigation-guard";
import type { LiveTrackingAvailability } from "../../src/lib/shipment-format";

export interface RouteTrackingChatCardProps {
  shipmentId: string;
  /** El mapa de la ruta (sin borde propio: lo pone esta card). */
  children: ReactNode;
  /** `null`: el seguimiento no aplica a quien mira (p. ej. el transportista) o al estado. */
  tracking: LiveTrackingAvailability | null;
  /** `null`: todavía no hay transportista, así que no hay chat y el botón no se muestra. */
  chat: "open" | "read_only" | null;
  /** Estado del envío y si quien mira es el receptor original: deciden el texto de solo lectura. */
  status?: ShipmentStatus;
  isFormerReceiver?: boolean;
  testID?: string;
  trackingTestID?: string;
  chatTestID?: string;
}

/**
 * MOVO-301: mapa de la ruta, estado del seguimiento en vivo y botón de Chat en una sola card (mockup
 * "Mapa + barra de acción"). Reemplaza a las cards sueltas de seguimiento y de chat (`LiveTrackingCard`, `ChatAccessCard`, ya borradas), que
 * cargaban el detalle. Debajo del mapa va una franja: el seguimiento a la izquierda y, a la derecha,
 * el botón negro "Chat" con un punto lima si hay mensajes sin leer. Sin ninguno de los dos, la card es
 * solo el mapa.
 */
export function RouteTrackingChatCard({
  shipmentId,
  children,
  tracking,
  chat,
  status,
  isFormerReceiver = false,
  testID = "route-tracking-chat-card",
  trackingTestID = "route-tracking",
  chatTestID = "route-chat",
}: RouteTrackingChatCardProps) {
  const colors = useThemeColors();
  const { data: chats } = useChatList({ enabled: chat !== null });
  const unread = chat ? (chats ?? []).find((item) => item.shipmentId === shipmentId)?.unreadCount ?? 0 : 0;
  const showFooter = tracking !== null || chat !== null;
  // En solo lectura se dice por qué (entregado, transferiste la recepción) y que se archiva, a la vista y no solo para lectores de pantalla.
  const readOnlyCopy = chat === "read_only" ? chatReadOnlyCopy({ archived: false, status, isFormerReceiver }) : null;

  const trackingBody = (live: boolean) => (
    <View className="flex-1 pr-3">
      <View className="flex-row items-center gap-2">
        <View className="h-2 w-2 rounded-full bg-fg-3" style={live ? { backgroundColor: "#6E8E1E" } : undefined} />
        <Text className="font-sans-semibold text-caption uppercase tracking-wider text-fg-2">En vivo</Text>
      </View>
      <Text className="mt-1 font-sans text-small text-fg-2" numberOfLines={2}>
        {live ? "Mirá en el mapa dónde está el transportista" : "Se activa al iniciar el recorrido"}
      </Text>
    </View>
  );

  return (
    <View testID={testID} className="overflow-hidden rounded-[14px] border border-border bg-bg">
      {children}
      {showFooter ? (
        <View className="flex-row items-center border-t border-border bg-bg px-4 py-3">
          {tracking === "available" ? (
            <Pressable
              testID={trackingTestID}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                pushOnce(`/(app)/shipments/${shipmentId}/tracking`);
              }}
              className="flex-1"
              accessibilityRole="button"
              accessibilityLabel="Ver seguimiento en vivo en el mapa"
            >
              <View className="flex-row">{trackingBody(true)}</View>
            </Pressable>
          ) : tracking === "pending" ? (
            <View
              testID={`${trackingTestID}-pending`}
              className="flex-1"
              accessibilityLabel="Seguimiento en vivo, todavía no disponible"
            >
              <View className="flex-row">{trackingBody(false)}</View>
            </View>
          ) : (
            <View className="flex-1" />
          )}

          {chat ? (
            <Pressable
              testID={chatTestID}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                pushOnce(`/(app)/shipments/${shipmentId}/chat`);
              }}
              accessibilityRole="button"
              accessibilityLabel={
                chat === "open"
                  ? unread > 0
                    ? `Abrir el chat del envío, ${unread} sin leer`
                    : "Abrir el chat del envío"
                  : "Ver la conversación del envío"
              }
              className={`h-11 flex-row items-center gap-2 rounded-[10px] px-4 active:opacity-80 ${
                chat === "open" ? "bg-fg" : "border border-border-strong bg-bg"
              }`}
            >
              <MessageCircle size={17} color={chat === "open" ? colors.bg : colors.fg1} strokeWidth={2} />
              <Text className={`font-sans-semibold text-body ${chat === "open" ? "text-bg" : "text-fg"}`}>Chat</Text>
              {unread > 0 ? (
                <View
                  testID={`${chatTestID}-unread`}
                  className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-bg bg-lime-500"
                />
              ) : null}
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {readOnlyCopy ? (
        <Text testID={`${chatTestID}-readonly-copy`} className="border-t border-border bg-bg px-4 py-2.5 font-sans text-small text-fg-3">
          {readOnlyCopy}
        </Text>
      ) : null}
    </View>
  );
}
