import { Package } from "lucide-react-native";
import { Text, View } from "react-native";
import { shortAddressLabel } from "../../src/lib/shipment-format";
import { tripStubParts } from "../../src/lib/trip-format";
import { TripStatus, type TripWithAcceptedPackages } from "../../src/api/trips-client";
import { PressableScale } from "./pressable-scale";
import { TripStatusPill } from "./trip-status-pill";

interface TripCardProps {
  trip: TripWithAcceptedPackages;
  onPress?: () => void;
  testID?: string;
}

const CARD_SHADOW = {
  shadowColor: "#0A0A0B",
  shadowOpacity: 0.04,
  shadowRadius: 2,
  shadowOffset: { width: 0, height: 1 },
  elevation: 1,
};

/**
 * Card "Horario" de "Mis viajes" (rediseño MOVO-262, mockup de Claude Design): talón con
 * día/mes/hora a la izquierda, pill de estado, timeline origen → destino y, abajo, el chip de
 * paquetes (o "Sin paquetes todavía"). Tocar la card abre el detalle
 * (MOVO-263); editar/cancelar/iniciar, el vehículo y buscar paquetes viven ahí.
 */
export function TripCard({ trip, onPress, testID }: TripCardProps) {
  const live = trip.status === TripStatus.ACTIVE;
  const stub = tripStubParts(trip.departureAt);
  const n = trip.acceptedPackagesCount;

  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      style={CARD_SHADOW}
      className="flex-row overflow-hidden rounded-[10px] border border-ink-950/[0.08] bg-bg"
    >
      <View
        className={`w-[78px] items-center justify-center gap-0.5 border-r-[1.5px] border-dashed border-ink-950/[0.14] py-3.5 ${
          live ? "bg-ink-50" : "bg-ink-950"
        }`}
      >
        <Text className={`font-sans-semibold text-[11px] tracking-[0.88px] opacity-70 ${live ? "text-ink-950" : "text-white"}`}>
          {stub.dow}
        </Text>
        <Text className={`font-sans-semibold text-[30px] leading-[30px] tracking-[-1.2px] ${live ? "text-ink-950" : "text-white"}`}>
          {stub.day}
        </Text>
        <Text className={`font-sans-semibold text-[11px] tracking-[0.88px] opacity-70 ${live ? "text-ink-950" : "text-white"}`}>
          {stub.mon}
        </Text>
        <Text
          className={`mt-2 font-sans-medium text-[12px] ${live ? "text-ink-500" : "text-lime-500"}`}
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {stub.time}
        </Text>
      </View>

      <View className="min-w-0 flex-1 gap-3 py-3.5 pl-4 pr-3.5">
        <View className="flex-row items-center justify-between">
          <TripStatusPill status={trip.status} />
        </View>

        <View className="gap-0">
          <View className="flex-row items-center gap-2.5">
            <View className="w-3 items-center">
              <View className="h-2 w-2 rounded-full border-2 border-ink-950" />
            </View>
            <Text className="flex-1 font-sans-semibold text-[15px] text-ink-950" numberOfLines={1}>
              {shortAddressLabel(trip.originAddress)}
            </Text>
          </View>
          <View className="w-3 items-center py-[1px]">
            <View className="h-3 w-0.5 bg-ink-200" />
          </View>
          <View className="flex-row items-center gap-2.5">
            <View className="w-3 items-center">
              <View className="h-2 w-2 rounded-full bg-ink-950" />
            </View>
            <Text className="flex-1 font-sans-semibold text-[15px] text-ink-950" numberOfLines={1}>
              {shortAddressLabel(trip.destinationAddress)}
            </Text>
          </View>
        </View>

        {n > 0 ? (
          <View
            testID={testID ? `${testID}-accepted-badge` : undefined}
            className="h-6 flex-row items-center gap-1.5 self-start rounded-full bg-ink-100 px-[9px]"
          >
            <Package size={14} color="#1A1A1D" strokeWidth={2} />
            <Text className="font-sans-medium text-[12px] text-ink-800">
              {n} {live ? "a bordo" : n === 1 ? "aceptado" : "aceptados"}
            </Text>
          </View>
        ) : (
          <Text testID={testID ? `${testID}-no-packages` : undefined} className="font-sans text-[12px] text-ink-500">
            Sin paquetes todavía
          </Text>
        )}
      </View>
    </PressableScale>
  );
}
