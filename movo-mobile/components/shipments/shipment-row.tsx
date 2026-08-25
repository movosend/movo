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

  // Emisor → fondo oscuro, ícono caja blanco nítido, flecha lima con contorno oscuro.
  // Receptor → fondo claro con borde sutil, ícono caja negro/fg1, flecha negra/fg1 con contorno claro.
  const iconBg = isReceiver
    ? "bg-bg-mute border border-border"
    : "bg-ink-950 dark:bg-ink-900";
  const packageColor = isReceiver ? colors.fg1 : "#FFFFFF";
  const arrowColor = isReceiver ? colors.fg1 : "#C6F24A";
  const outlineColor = isReceiver ? colors.bg : "#0A0A0B";
  const ArrowIcon = isReceiver ? ArrowDown : ArrowUp;

  return (
    <Pressable
      testID={testID}
      onPress={() => router.push(`/shipments/${shipment.id}`)}
      className={`flex-row items-center gap-3 py-3 ${isFirst ? "" : "border-t border-border"}`}
    >
      {/* Icono de caja con flecha direccional con contorno (sin círculo de fondo) */}
      <View className={`relative h-11 w-11 items-center justify-center rounded-full ${iconBg}`}>
        <Package size={20} strokeWidth={1.9} color={packageColor} />
        <View
          style={{
            position: "absolute",
            bottom: -3,
            right: -3,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Contorno exterior de la flecha */}
          <ArrowIcon
            size={18}
            strokeWidth={6.0}
            color={outlineColor}
            style={{ position: "absolute" }}
          />
          {/* Flecha principal */}
          <ArrowIcon
            size={18}
            strokeWidth={3.4}
            color={arrowColor}
          />
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

