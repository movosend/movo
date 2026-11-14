import { AlertTriangle, ArrowRight, Package } from "lucide-react-native";
import { Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { shortAddressLabel } from "../../src/lib/shipment-format";
import {
  tripCarriedChipLabel,
  tripCarriedCount,
  tripDisputedChipLabel,
  tripHistoryDate,
  tripHistorySubtext,
} from "../../src/lib/trip-format";
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
  const carried = tripCarriedCount(trip);
  const disputed = trip.disputedPackagesCount ?? 0;

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
      {/* El cierre del viaje cuenta un paquete en disputa como terminado, pero no se llevó:
          va en su propio chip y no suma a "Llevaste N paquetes". */}
      {trip.status === TripStatus.COMPLETED && (carried > 0 || disputed > 0) ? (
        <View className="flex-row flex-wrap gap-1.5">
          {carried > 0 ? (
            <View
              testID={testID ? `${testID}-delivered-chip` : undefined}
              className="h-6 flex-row items-center gap-1.5 rounded-full bg-bg-mute px-[9px]"
            >
              <Package size={14} color="#1B7A4C" strokeWidth={2} />
              <Text className="font-sans-medium text-[12px] text-fg-2">{tripCarriedChipLabel(carried)}</Text>
            </View>
          ) : null}
          {disputed > 0 ? (
            <View
              testID={testID ? `${testID}-disputed-chip` : undefined}
              className="h-6 flex-row items-center gap-1.5 rounded-full bg-warning-100 px-[9px]"
            >
              <AlertTriangle size={13} color="#A97714" strokeWidth={2} />
              <Text className="font-sans-medium text-[12px] text-warning-700">{tripDisputedChipLabel(disputed)}</Text>
            </View>
          ) : null}
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
