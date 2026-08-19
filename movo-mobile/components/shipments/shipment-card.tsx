import { router } from "expo-router";
import { Clock } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  formatPickupDateLabel,
  formatPickupWindowLabel,
  formatShipmentPrice,
  shortAddressLabel,
} from "../../src/lib/shipment-format";
import { ShipmentStatusBadge } from "./status-badge";

export interface ShipmentCardProps {
  shipment: ShipmentSummary;
  testID?: string;
}

/**
 * Card de envío para el listado completo "Mis Envíos" (MOVO-127, feedback post-QA: la
 * fila de una sola línea de `ShipmentRow` — reusada en el preview de Home — "quedaba
 * horrible" repetida en un listado largo). Reinterpretación de una card de
 * viaje/transportista de referencia (mini-ruta con dos puntos + línea, badge de
 * estado, hora), sin la foto/nombre de esa referencia porque acá no hay contraparte
 * todavía asignada — el precio ocupa ese lugar en la fila superior en su lugar.
 *
 * Es una card propia por envío (`gap`/gruesa, sin `border-t` entre filas) en vez de la
 * lista densa de líneas divididas por borde — la que "Actividad reciente" sigue usando
 * porque ahí el objetivo es otro (preview compacto de 3, no la pantalla principal).
 */
export function ShipmentCard({ shipment, testID }: ShipmentCardProps) {
  const colors = useThemeColors();
  const pickupDateLabel = formatPickupDateLabel(shipment.pickupDate) ?? shipment.pickupDate;
  const windowLabel = formatPickupWindowLabel(shipment.pickupTimeWindowStart, shipment.pickupTimeWindowEnd);

  return (
    <Pressable
      testID={testID}
      onPress={() => router.push(`/shipments/${shipment.id}`)}
      className="gap-3.5 rounded-[16px] border border-border bg-bg-sub p-4"
    >
      <View className="flex-row items-center justify-between">
        <Text className="font-sans-semibold text-body text-fg">
          {formatShipmentPrice(shipment.agreedPriceArs, shipment.suggestedPriceArs)}
        </Text>
        <ShipmentStatusBadge status={shipment.status} />
      </View>

      <View className="flex-row items-center gap-2">
        <View className="h-2 w-2 rounded-full bg-fg" />
        <Text numberOfLines={1} className="font-sans-medium text-small text-fg">
          {shortAddressLabel(shipment.pickupAddress)}
        </Text>
        <View className="h-px flex-1 bg-border" />
        <Text numberOfLines={1} className="font-sans-medium text-small text-fg">
          {shortAddressLabel(shipment.deliveryAddress)}
        </Text>
        <View className="h-2 w-2 rounded-full bg-lime-500" />
      </View>

      <View className="flex-row items-center gap-1.5">
        <Clock size={13} strokeWidth={1.8} color={colors.fg3} />
        <Text className="font-sans text-caption text-fg-3">
          {pickupDateLabel} · {windowLabel}
        </Text>
      </View>
    </Pressable>
  );
}
