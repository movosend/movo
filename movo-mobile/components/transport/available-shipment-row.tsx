import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import type { AvailableShipment } from "../../src/api/shipments-client";
import {
  formatDetourKm,
  formatPickupDayLabel,
  formatPriceArs,
  formatTripDistanceKm,
  haversineDistanceKm,
  zoneLabelFromAddress,
} from "../../src/lib/shipment-format";

export interface AvailableShipmentRowProps {
  shipment: AvailableShipment;
  testID?: string;
  /** MOVO-183/rediseño de lista: mismo resultado de `computeOnTripDetour` que ya
   * consumía `AvailableShipmentCard` — cuando existe, el desvío mostrado es el km de
   * más por desviarse a buscar el paquete sobre ESE viaje declarado (y se muestra el
   * chip "En tu ruta"). Cuando no, la fila cae a `pickupDistanceKm` (distancia desde
   * el origen elegido en la pantalla hasta el punto de retiro) como una aproximación
   * de "cuánto te desviás", sin chip -- decisión tomada con el usuario, ver el
   * comentario de `TransportScreen`. */
  detour?: { detourKm: number } | null;
}

/**
 * Fila de un envío disponible para el tab "Transportar" (rediseño MOVO-183 sobre un
 * mockup de referencia: lista con divisores en vez de cards individuales). Reemplaza
 * a `AvailableShipmentCard` únicamente en el feed genérico (radio/GPS) -- el modo
 * filtrado por viaje (`?tripId=`) y el carrusel de `TripMatchAlertBanner` (MOVO-163)
 * siguen usando la card tal cual, sin tocar.
 */
export function AvailableShipmentRow({ shipment, testID, detour }: AvailableShipmentRowProps) {
  const dayLabel = formatPickupDayLabel(shipment.pickupDate);
  const onTrip = detour != null;
  const detourKm = detour ? detour.detourKm : shipment.pickupDistanceKm;
  const tripDistanceKm = haversineDistanceKm(
    shipment.pickupLat,
    shipment.pickupLng,
    shipment.deliveryLat,
    shipment.deliveryLng,
  );

  return (
    <Pressable
      testID={testID}
      onPress={() =>
        router.push(`/transport/${shipment.id}?pickupDistanceKm=${shipment.pickupDistanceKm}`)
      }
      className="flex-row items-stretch justify-between gap-3 py-[18px]"
    >
      <View className="flex-1 gap-2 pr-2">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="font-sans-medium text-[12.5px] text-fg-3">{dayLabel}</Text>
          {onTrip ? (
            <View
              testID={testID ? `${testID}-detour` : undefined}
              className="flex-row items-center gap-1.5 rounded-full bg-lime-200/70 px-2.5 py-1 dark:bg-lime-500/20"
            >
              <View className="h-1.5 w-1.5 rounded-full bg-lime-600 dark:bg-lime-400" />
              <Text className="font-sans-semibold text-[10px] uppercase tracking-wide text-lime-800 dark:text-lime-300">
                En tu ruta
              </Text>
            </View>
          ) : null}
          {shipment.urgent ? (
            <View testID={testID ? `${testID}-urgent` : undefined} className="rounded-full bg-warning-100 px-2.5 py-1">
              <Text className="font-sans-semibold text-[10px] uppercase tracking-wide text-warning-700">
                Urgente
              </Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} className="font-sans-semibold text-h3 text-fg">
          {zoneLabelFromAddress(shipment.pickupAddress)}
        </Text>
        <Text className="font-sans text-[13px] text-fg-2">
          +{formatDetourKm(detourKm)} km de desvío · {formatTripDistanceKm(tripDistanceKm)}
        </Text>
      </View>
      <View className="justify-center">
        {/* Lima "muted", mismo tono que el chip "En tu ruta" de arriba
            (`bg-lime-200/70` claro / `bg-lime-500/20` oscuro) -- no el lima sólido
            de `PrimaryButton variant="lime"`, demasiado fuerte para un dato que
            aparece en cada fila de la lista. */}
        <View className="items-end gap-0.5 rounded-[12px] bg-lime-200/70 px-3 py-2 dark:bg-lime-500/20">
          <Text className="font-sans-semibold text-[17px] leading-[20px] tracking-[-0.02em] text-lime-800 dark:text-lime-300">
            {formatPriceArs(shipment.suggestedPriceArs)}
          </Text>
          <Text className="font-sans text-[10px] text-lime-700 dark:text-lime-400/80">sugerido</Text>
        </View>
      </View>
    </Pressable>
  );
}
