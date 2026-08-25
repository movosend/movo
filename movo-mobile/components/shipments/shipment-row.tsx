import { router } from "expo-router";
import { ArrowDown, ArrowUp, Package } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { usePublicProfile } from "../../src/hooks/use-profile";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { getFirstName } from "../../src/lib/profile-format";
import { formatShipmentRowTime } from "../../src/lib/shipment-format";
import { useAuthStore } from "../../src/store/auth-store";
import { ShipmentStatusBadge } from "./status-badge";

/**
 * Fila de envío usada por `RecentShipmentsSection` (preview de Home, MOVO-83).
 *
 * Diseño 1-b: icono de caja con mini-flecha direccional superpuesta (↑ emisor / ↓ receptor),
 * fondo oscuro para saliente y claro para entrante, título en semibold, timestamp
 * secundario debajo del nombre, y pill de estado alineada a la derecha.
 */
export function ShipmentRow({
  shipment,
  isFirst,
  testID,
}: {
  shipment: ShipmentSummary;
  isFirst: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const currentUserId = useAuthStore((s) => s.user?.userId);
  const isReceiver = currentUserId === shipment.receiverId;
  const counterpartId = isReceiver ? shipment.senderId : shipment.receiverId;
  const { data: counterpartProfile } = usePublicProfile(counterpartId);
  const counterpartName = getFirstName(counterpartProfile?.fullName);

  const title = isReceiver
    ? counterpartName
      ? `Envío de ${counterpartName}`
      : "Envío recibido"
    : counterpartName
      ? `Envío a ${counterpartName}`
      : "Envío realizado";

  const relativeTime = formatShipmentRowTime(shipment);

  // Emisor → fondo oscuro (ink-950 con borde sutil), ícono caja blanco nítido, mini-flecha lima de marca.
  // Receptor → fondo bg-mute con borde, ícono caja de alto contraste (fg2), mini-flecha fg1 con fondo sólido.
  const iconBg = isReceiver
    ? "bg-bg-mute border border-border"
    : "bg-ink-950 dark:bg-ink-900 border border-border-strong";
  const packageColor = isReceiver ? colors.fg2 : "#FFFFFF";
  const arrowColor = isReceiver ? colors.fg1 : "#C6F24A";
  const ArrowIcon = isReceiver ? ArrowDown : ArrowUp;

  // Fondo y borde sólidos para que la mini-flecha tenga un recorte limpio sobre el círculo principal
  const badgeBg = isReceiver ? colors.bg : "#0A0A0B";
  const badgeBorder = isReceiver ? colors.fg3 + "33" : "#C6F24A44";

  return (
    <Pressable
      testID={testID}
      onPress={() => router.push(`/shipments/${shipment.id}`)}
      className={`flex-row items-center gap-3 py-3 ${isFirst ? "" : "border-t border-border"}`}
    >
      {/* Icono de caja con mini-flecha direccional superpuesta con alto contraste */}
      <View className={`relative h-10 w-10 items-center justify-center rounded-full ${iconBg}`}>
        <Package size={18} strokeWidth={2} color={packageColor} />
        <View
          style={{
            position: "absolute",
            bottom: -1,
            right: -1,
            width: 16,
            height: 16,
            borderRadius: 8,
            borderWidth: 1.5,
            borderColor: badgeBorder,
            backgroundColor: badgeBg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ArrowIcon size={9} strokeWidth={2.8} color={arrowColor} />
        </View>
      </View>

      {/* Título + timestamp secundario */}
      <View className="flex-1">
        <Text numberOfLines={1} className="font-sans-semibold text-small text-fg">
          {title}
        </Text>
        {relativeTime ? (
          <Text className="mt-0.5 font-sans text-caption text-fg-3">
            {relativeTime}
          </Text>
        ) : null}
      </View>

      {/* Pill de estado */}
      <ShipmentStatusBadge status={shipment.status} isReceiver={isReceiver} />
    </Pressable>
  );
}

