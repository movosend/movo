import { router } from "expo-router";
import { AlertCircle, MapPin, Package as PackageIcon, Route } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { packageTypeLabel } from "../send/category-grid";
import type { AvailableShipment } from "../../src/api/shipments-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  formatPickupDateLabel,
  formatPriceArs,
  formatTripDistanceKm,
  haversineDistanceKm,
  shortAddressLabel,
} from "../../src/lib/shipment-format";

export interface AvailableShipmentCardProps {
  shipment: AvailableShipment;
  testID?: string;
  /** Sin borde/fondo propio (MOVO-163, `TripMatchAlertBanner`): dentro de una card ya
   * enmarcada (el aviso global tiene su propio borde lima + fondo), el marco propio
   * de esta card se leía como una "card dentro de otra card" — un doble recuadro
   * redundante, no dos superficies distintas de verdad. Default `false`: el feed de
   * MOVO-148 (`transport.tsx`) sí necesita distinguirse del fondo de la pantalla. */
  bare?: boolean;
  /** `false` (MOVO-163, `TripMatchAlertBanner`): la card no navega al tocarla — en
   * ese contexto el detalle se ve solo apretando el botón "Ver envío" explícito, no
   * tocando la card en sí. Default `true`: el feed de MOVO-148 sí navega al tocarla
   * (AC9 de esa US). */
  interactive?: boolean;
  /** MOVO-183: "te queda de paso" — resultado de `computeOnTripDetour` (aproximación
   * client-side, sin endpoint que cruce el feed general contra los viajes activos, ver
   * ese helper en `shipment-format.ts`). `undefined`/`null` no muestra la franja. */
  detour?: { onTrip: string; detourKm: number } | null;
}

/** Distancia al punto de retiro formateada para la card (MOVO-148, AC1) — siempre un
 * decimal, nunca redondeada a entero (la diferencia entre 0.4km y 0.9km importa para
 * decidir si vale la pena ir a buscar el paquete). */
function formatDistanceKm(distanceKm: number): string {
  return `a ${distanceKm.toFixed(1)} km`;
}

/** "+0,8" — un decimal con coma, mismo criterio de localización que el resto de la
 * card (nunca redondeado a entero para el desvío, que suele ser un número chico donde
 * la diferencia entre 0,8 y 1,4 km sí importa para la decisión). */
function formatDetourKm(detourKm: number): string {
  return detourKm.toFixed(1).replace(".", ",");
}

/**
 * Card de un envío disponible para el tab "Transportar" (MOVO-148, AC1/AC4;
 * rediseño de jerarquía MOVO-183): ruta origen→destino sobre un timeline vertical,
 * franja de desvío cuando el envío queda de paso en un viaje declarado, y
 * paquete/fecha vs. precio (más prominente que antes) en la fila final.
 */
export function AvailableShipmentCard({
  shipment,
  testID,
  bare = false,
  interactive = true,
  detour,
}: AvailableShipmentCardProps) {
  const colors = useThemeColors();
  const pickupDateLabel = formatPickupDateLabel(shipment.pickupDate) ?? shipment.pickupDate;
  const tripDistanceKm = haversineDistanceKm(
    shipment.pickupLat,
    shipment.pickupLng,
    shipment.deliveryLat,
    shipment.deliveryLng,
  );

  return (
    <Pressable
      testID={testID}
      onPress={
        interactive
          ? () =>
              router.push(
                `/transport/${shipment.id}?pickupDistanceKm=${shipment.pickupDistanceKm}`,
              )
          : undefined
      }
      disabled={!interactive}
      className={`gap-3 rounded-[16px] p-4 ${bare ? "" : "border border-border bg-bg-sub"}`}
    >
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-2.5">
          <View className="flex-row items-center gap-1.5">
            <MapPin size={13} strokeWidth={1.8} color={colors.fg3} />
            <Text className="font-sans-medium text-[12px] text-fg-2">{formatDistanceKm(shipment.pickupDistanceKm)}</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <Route size={13} strokeWidth={1.8} color={colors.fg3} />
            <Text testID={testID ? `${testID}-trip-distance` : undefined} className="font-sans-medium text-[12px] text-fg-2">
              {formatTripDistanceKm(tripDistanceKm)} de viaje
            </Text>
          </View>
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

      <View>
        <View className="flex-row gap-3">
          <View className="items-center" style={{ width: 8 }}>
            <View className="h-2 w-2 rounded-[2px] bg-fg" />
            <View className="mt-1 w-px flex-1 bg-border-strong" />
          </View>
          <View className="flex-1 pb-3.5">
            <Text numberOfLines={1} className="font-sans-semibold text-small text-fg">
              {shortAddressLabel(shipment.pickupAddress)}
            </Text>
          </View>
        </View>
        <View className="flex-row items-center gap-3">
          <View className="items-center" style={{ width: 8 }}>
            <View className="h-2 w-2 rounded-full bg-fg" />
          </View>
          <View className="flex-1">
            <Text numberOfLines={1} className="font-sans-semibold text-small text-fg">
              {shortAddressLabel(shipment.deliveryAddress)}
            </Text>
          </View>
        </View>
      </View>

      {detour ? (
        <View testID={testID ? `${testID}-detour` : undefined} className="flex-row items-center gap-2 rounded-md bg-lime-200/60 px-2.5 py-2">
          <Route size={14} strokeWidth={1.8} color="#4A5A20" />
          <Text className="flex-1 font-sans-medium text-[12.5px] leading-[17px] text-[#4A5A20]">
            Te queda de paso en {detour.onTrip} · +{formatDetourKm(detour.detourKm)} km de desvío
          </Text>
        </View>
      ) : null}

      <View className="flex-row items-start justify-between gap-3">
        <View className="gap-1.5">
          <View className="flex-row items-center gap-1.5">
            <PackageIcon size={13} strokeWidth={1.8} color={colors.fg3} />
            <Text className="font-sans text-caption text-fg-3">
              {packageTypeLabel(shipment.packageType)} · {shipment.weightKg} kg
            </Text>
          </View>
          <Text className="font-sans text-caption text-fg-3">{pickupDateLabel}</Text>
        </View>
        <View className="items-end">
          <Text className="font-sans-semibold text-[19px] leading-[22px] tracking-[-0.02em] text-fg">
            {formatPriceArs(shipment.suggestedPriceArs)}
          </Text>
          <Text className="mt-0.5 font-sans text-[11px] text-fg-3">precio sugerido</Text>
        </View>
      </View>
    </Pressable>
  );
}
