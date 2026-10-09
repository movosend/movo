import { router } from "expo-router";
import { Truck } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import type { TripWithAcceptedPackages } from "../../src/api/trips-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  formatDepartureDateOnly,
  formatPackagesCount,
  tripRouteLabel,
  tripStatusLabel,
} from "../../src/lib/trip-format";

/**
 * Fila de un viaje del transportista en "Actividad reciente" (Inicio), mezclada con las
 * filas de envíos (`ShipmentRow`) y con su mismo formato: ícono circular, título +
 * subtítulo, estado como texto plano a la derecha.
 *
 * El estado es el que devuelve el backend (`tripStatusLabel`): la app no marca nada como
 * "vencido" por fecha — un `declared` con salida pasada sigue siendo iniciable para el
 * backend, y cerrar esos viajes es responsabilidad del backend. Toca → `/route?tripId=`,
 * que para un viaje `declared` ya ofrece el CTA de inicio (MOVO-252).
 */
export function CarrierTripRow({
  trip,
  isFirst,
  testID,
}: {
  trip: TripWithAcceptedPackages;
  isFirst: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const subtitle = `${formatDepartureDateOnly(trip.departureAt)} · ${formatPackagesCount(trip.acceptedPackagesCount)}`;

  return (
    <Pressable
      testID={testID}
      onPress={() => router.push({ pathname: "/route", params: { tripId: trip.id } } as never)}
      accessibilityRole="button"
      className={`flex-row items-center gap-3 py-3 ${isFirst ? "" : "border-t border-border"}`}
    >
      <View className="h-11 w-11 items-center justify-center rounded-full border border-border bg-bg-mute">
        <Truck size={19} strokeWidth={1.9} color={colors.fg1} />
      </View>

      <View className="flex-1">
        <Text numberOfLines={1} className="font-sans-semibold text-small text-fg">
          {tripRouteLabel(trip)}
        </Text>
        <Text numberOfLines={1} className="mt-0.5 font-sans text-caption text-fg-3">
          {subtitle}
        </Text>
      </View>

      <Text className="ml-2 font-sans text-small text-fg-2">{tripStatusLabel(trip.status)}</Text>
    </Pressable>
  );
}
