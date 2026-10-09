import { ArrowRight, Package } from "lucide-react-native";
import { Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { shortAddressLabel } from "../../src/lib/shipment-format";
import { tripCarriedChipLabel, tripHistoryDate, tripHistorySubtext } from "../../src/lib/trip-format";
import { TripStatus, type TripWithAcceptedPackages } from "../../src/api/trips-client";
import { PressableScale } from "./pressable-scale";
import { TripStatusPill } from "./trip-status-pill";

/**
 * Fila del tab "Historial" (rediseño MOVO-262): `bg-sub`, sin sombra, pill con ícono + fecha.
 * Tocarla abre el detalle del viaje (AC5), igual que las cards de "Próximos".
 */
export function TripHistoryCard({
  trip,
  onPress,
  testID,
}: {
  trip: TripWithAcceptedPackages;
  onPress?: () => void;
  testID?: string;
}) {
  const colors = useThemeColors();
  const subtext = tripHistorySubtext(trip);

  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      className="gap-2 rounded-[10px] border border-border bg-bg-sub px-4 py-3.5"
    >
      <View className="flex-row items-center justify-between gap-2">
        <TripStatusPill status={trip.status} compact />
        <Text className="font-sans text-[12px] text-fg-3">{tripHistoryDate(trip.departureAt)}</Text>
      </View>
      <View className="flex-row items-center gap-2">
        <Text className="shrink font-sans-medium text-[15px] text-fg-2" numberOfLines={1}>
          {shortAddressLabel(trip.originAddress)}
        </Text>
        <ArrowRight size={16} color={colors.fg3} strokeWidth={1.75} />
        <Text className="shrink font-sans-medium text-[15px] text-fg-2" numberOfLines={1}>
          {shortAddressLabel(trip.destinationAddress)}
        </Text>
      </View>
      {/* "Llevaste N paquetes", no "entregados": `acceptedPackagesCount` incluye los que
          quedaron en disputa, que el cierre del viaje cuenta como terminados. */}
      {trip.status === TripStatus.COMPLETED ? (
        <View
          testID={testID ? `${testID}-delivered-chip` : undefined}
          className="h-6 flex-row items-center gap-1.5 self-start rounded-full bg-bg-mute px-[9px]"
        >
          <Package size={14} color="#1B7A4C" strokeWidth={2} />
          <Text className="font-sans-medium text-[12px] text-fg-2">
            {tripCarriedChipLabel(trip.acceptedPackagesCount)}
          </Text>
        </View>
      ) : null}
      {subtext ? (
        <Text testID={testID ? `${testID}-subtext` : undefined} className="font-sans text-[13px] leading-[18px] text-fg-3">
          {subtext}
        </Text>
      ) : null}
    </PressableScale>
  );
}
