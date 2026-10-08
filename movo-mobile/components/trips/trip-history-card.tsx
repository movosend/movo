import { ArrowRight, Check, Package, Timer, X } from "lucide-react-native";
import { Text, View } from "react-native";
import { shortAddressLabel } from "../../src/lib/shipment-format";
import { tripDeliveredChipLabel, tripHistoryDate, tripHistorySubtext, tripStatusLabel } from "../../src/lib/trip-format";
import { TripStatus, type TripWithAcceptedPackages } from "../../src/api/trips-client";

// [fondo, texto, ícono] por estado, tal cual el mockup.
const PILL: Partial<Record<TripStatus, { bg: string; fg: string; Icon: typeof Check }>> = {
  [TripStatus.COMPLETED]: { bg: "rgba(43,182,115,0.14)", fg: "#1B7A4C", Icon: Check },
  [TripStatus.EXPIRED]: { bg: "#E6E6EA", fg: "#5A5A62", Icon: Timer },
  [TripStatus.CANCELLED]: { bg: "rgba(229,72,77,0.1)", fg: "#B42A2F", Icon: X },
};

/** Fila del tab "Historial" (rediseño MOVO-262): `ink-50`, sin sombra, pill con ícono + fecha. */
export function TripHistoryCard({ trip, testID }: { trip: TripWithAcceptedPackages; testID?: string }) {
  const pill = PILL[trip.status] ?? PILL[TripStatus.EXPIRED]!;
  const subtext = tripHistorySubtext(trip);

  return (
    <View
      testID={testID}
      className="gap-2 rounded-[10px] border border-ink-950/[0.06] bg-ink-50 px-4 py-3.5"
    >
      <View className="flex-row items-center justify-between gap-2">
        <View
          className="h-[22px] flex-row items-center gap-[5px] rounded-full pl-[7px] pr-[9px]"
          style={{ backgroundColor: pill.bg }}
        >
          <pill.Icon size={12} color={pill.fg} strokeWidth={2} />
          <Text className="font-sans-semibold text-[12px]" style={{ color: pill.fg }}>
            {tripStatusLabel(trip.status)}
          </Text>
        </View>
        <Text className="font-sans text-[12px] text-ink-400">{tripHistoryDate(trip.departureAt)}</Text>
      </View>
      <View className="flex-row items-center gap-2">
        <Text className="shrink font-sans-medium text-[15px] text-ink-600" numberOfLines={1}>
          {shortAddressLabel(trip.originAddress)}
        </Text>
        <ArrowRight size={16} color="#B4B4BC" strokeWidth={1.75} />
        <Text className="shrink font-sans-medium text-[15px] text-ink-600" numberOfLines={1}>
          {shortAddressLabel(trip.destinationAddress)}
        </Text>
      </View>
      {trip.status === TripStatus.COMPLETED ? (
        <View
          testID={testID ? `${testID}-delivered-chip` : undefined}
          className="h-6 flex-row items-center gap-1.5 self-start rounded-full bg-ink-100 px-[9px]"
        >
          <Package size={14} color="#1B7A4C" strokeWidth={2} />
          <Text className="font-sans-medium text-[12px] text-ink-800">
            {tripDeliveredChipLabel(trip.acceptedPackagesCount)}
          </Text>
        </View>
      ) : null}
      {subtext ? (
        <Text testID={testID ? `${testID}-subtext` : undefined} className="font-sans text-[13px] leading-[18px] text-ink-500">
          {subtext}
        </Text>
      ) : null}
    </View>
  );
}
