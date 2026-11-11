import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { useShipmentChatUnread } from "../../src/hooks/use-shipment-chat-unread";
import { chatReadOnlyCopy } from "../../src/lib/chat-format";
import { ShipmentChatButton } from "./shipment-chat-button";
import { pushOnce } from "../../src/lib/navigation-guard";
import type { LiveTrackingAvailability } from "../../src/lib/shipment-format";

export interface RouteTrackingChatCardProps {
  shipmentId: string;
  /** El mapa de la ruta (sin borde propio: lo pone esta card). */
  children: ReactNode;
  /** Lo mismo desde el lado del transportista: si su ubicación se está compartiendo (`available`) o todavía no. `null`: no aplica. */
  sharing?: LiveTrackingAvailability | null;
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
 *
 * MOVO-361: el seguimiento de emisor y receptor vive en el mapa (`RouteMapCard` con `live`, su aviso
 * y su pantalla completa con el sheet); la franja "En vivo" que llevaba a la pantalla aparte se fue.
 * Queda la del transportista ("Compartiendo") y el Chat.
 */
export function RouteTrackingChatCard({
  shipmentId,
  children,
  chat,
  sharing = null,
  status,
  isFormerReceiver = false,
  testID = "route-tracking-chat-card",
  trackingTestID = "route-tracking",
  chatTestID = "route-chat",
}: RouteTrackingChatCardProps) {
  const unread = useShipmentChatUnread(shipmentId, chat);
  const showFooter = sharing !== null || chat !== null;
  // En solo lectura se dice por qué (entregado, transferiste la recepción) y que se archiva, a la vista y no solo para lectores de pantalla.
  const readOnlyCopy = chat === "read_only" ? chatReadOnlyCopy({ archived: false, status, isFormerReceiver }) : null;

  const trackingBody = (live: boolean, copy?: { label: string; live: string; idle: string }) => (
    <View className="flex-1 pr-3">
      <View className="flex-row items-center gap-2">
        <View className="h-2 w-2 rounded-full bg-fg-3" style={live ? { backgroundColor: "#6E8E1E" } : undefined} />
        <Text className="font-sans-semibold text-caption uppercase tracking-wider text-fg-2">
          {copy?.label ?? "En vivo"}
        </Text>
      </View>
      <Text className="mt-1 font-sans text-small text-fg-2" numberOfLines={2}>
        {live
          ? (copy?.live ?? "Mirá en el mapa dónde está el transportista")
          : (copy?.idle ?? "Se activa al iniciar el recorrido")}
      </Text>
    </View>
  );

  return (
    <View testID={testID} className="overflow-hidden rounded-[14px] border border-border bg-bg">
      {children}
      {showFooter ? (
        <View className="flex-row items-center border-t border-border bg-bg px-4 py-3">
          {sharing !== null ? (
            <View
              testID={`${trackingTestID}-sharing`}
              className="flex-1"
              accessibilityLabel={
                sharing === "available" ? "Estás compartiendo tu ubicación" : "Tu ubicación se comparte al iniciar el recorrido"
              }
            >
              <View className="flex-row">
                {trackingBody(sharing === "available", {
                  label: sharing === "available" ? "Compartiendo" : "Ubicación",
                  live: "Quien envía y quien recibe ven dónde estás",
                  idle: "Se comparte al iniciar el recorrido",
                })}
              </View>
            </View>
          ) : readOnlyCopy ? (
            // Sin franja del transportista, el porqué del solo lectura va al lado del botón, en la misma
            // fila (feedback 10/11: abajo quedaba un hueco vacío y el texto en otra fila).
            <Text
              testID={`${chatTestID}-readonly-copy`}
              className="flex-1 pr-3 font-sans text-small text-fg-3"
            >
              {readOnlyCopy}
            </Text>
          ) : (
            <View className="flex-1" />
          )}

          {chat ? (
            <ShipmentChatButton
              chat={chat}
              unread={unread}
              layout="inline"
              testID={chatTestID}
              unreadTestID={`${chatTestID}-unread`}
              onPress={() => pushOnce(`/(app)/shipments/${shipmentId}/chat`)}
            />
          ) : null}
        </View>
      ) : null}
      {readOnlyCopy && sharing !== null ? (
        <Text testID={`${chatTestID}-readonly-copy`} className="border-t border-border bg-bg px-4 py-2.5 font-sans text-small text-fg-3">
          {readOnlyCopy}
        </Text>
      ) : null}
    </View>
  );
}
