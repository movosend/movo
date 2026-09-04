import { router } from "expo-router";
import { AlertCircle, MapPin, Package as PackageIcon, Route } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { packageTypeLabel } from "../send/category-grid";
import type { AvailableShipment } from "../../src/api/shipments-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  formatPickupDateLabel,
  formatPickupWindowLabel,
  formatPriceArs,
  formatTripDistanceKm,
  haversineDistanceKm,
  shortAddressLabel,
} from "../../src/lib/shipment-format";

export interface AvailableShipmentCardProps {
  shipment: AvailableShipment;
  testID?: string;
}

/** Distancia al punto de retiro formateada para la card (MOVO-148, AC1) — siempre un
 * decimal, nunca redondeada a entero (la diferencia entre 0.4km y 0.9km importa para
 * decidir si vale la pena ir a buscar el paquete). */
function formatDistanceKm(distanceKm: number): string {
  return `a ${distanceKm.toFixed(1)} km`;
}

/**
 * Card de un envío disponible para el tab "Transportar" (MOVO-148, AC1/AC4).
 * Reinterpretación de `ShipmentCard` (`components/shipments/shipment-card.tsx`) sin
 * badge de estado/rol (acá todos los envíos están `published` y sin contraparte
 * asignada) — en su lugar, distancia al retiro y las marcas `urgent`/`hasMyOffer`.
 */
export function AvailableShipmentCard({ shipment, testID }: AvailableShipmentCardProps) {
  const colors = useThemeColors();
  const pickupDateLabel = formatPickupDateLabel(shipment.pickupDate) ?? shipment.pickupDate;
  const windowLabel = formatPickupWindowLabel(shipment.pickupTimeWindowStart, shipment.pickupTimeWindowEnd);
  const tripDistanceKm = haversineDistanceKm(
    shipment.pickupLat,
    shipment.pickupLng,
    shipment.deliveryLat,
    shipment.deliveryLng,
  );

  return (
    <Pressable
      testID={testID}
      // `/transport/[id]` se extrajo a MOVO-166 (branch propia, ver movo-mobile/CLAUDE.md
      // MOVO-148) — no existe todavía en esta branch, así que Expo Router no puede tipar
      // la ruta acá. El cast se saca solo cuando MOVO-166 se mergea encima de esta branch.
      onPress={() => router.push(`/transport/${shipment.id}` as never)}
      className="gap-3.5 rounded-[16px] border border-border bg-bg-sub p-4"
    >
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-1.5">
          <MapPin size={13} strokeWidth={1.8} color={colors.fg3} />
          <Text className="font-sans-medium text-[12px] text-fg-2">{formatDistanceKm(shipment.pickupDistanceKm)}</Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          {shipment.hasMyOffer ? (
            <View testID={testID ? `${testID}-has-offer` : undefined} className="rounded-md bg-info-100 px-2 py-0.5">
              <Text className="font-sans-medium text-[11px] text-info-700">Ya ofertaste</Text>
            </View>
          ) : null}
          {shipment.urgent ? (
            <View testID={testID ? `${testID}-urgent` : undefined} className="flex-row items-center gap-1 rounded-md bg-warning-100 px-2 py-0.5">
              <AlertCircle size={11} strokeWidth={2} color="#B45309" />
              <Text className="font-sans-medium text-[11px] text-warning-700">Urgente</Text>
            </View>
          ) : null}
        </View>
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
        <Route size={13} strokeWidth={1.8} color={colors.fg3} />
        <Text testID={testID ? `${testID}-trip-distance` : undefined} className="font-sans text-caption text-fg-3">
          {formatTripDistanceKm(tripDistanceKm)} de viaje
        </Text>
      </View>

      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1.5">
          <PackageIcon size={13} strokeWidth={1.8} color={colors.fg3} />
          <Text className="font-sans text-caption text-fg-3">
            {packageTypeLabel(shipment.packageType)} · {shipment.weightKg} kg
          </Text>
        </View>
        <Text className="font-sans-semibold text-small text-fg">
          {formatPriceArs(shipment.suggestedPriceArs)}
        </Text>
      </View>

      <Text className="font-sans text-caption text-fg-3">
        {pickupDateLabel} · {windowLabel}
      </Text>
    </Pressable>
  );
}
