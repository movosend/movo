import { useState } from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { TripStatus, type TripWithAcceptedPackages } from "../../src/api/trips-client";
import { useMyTrips, useStartTrip } from "../../src/hooks/use-trips";
import { useTransportingShipments } from "../../src/hooks/use-active-shipments";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatTripStartErrorMessage, isTripDepartureToday } from "../../src/lib/trip-format";
import { CarrierTripCta } from "../trips/carrier-trip-cta";

interface CarrierTransportingSectionProps {
  testID?: string;
}

/**
 * Sección operativa "Estoy transportando" en la pantalla de Inicio (Home),
 * fiel al prototipo de Tomás ("Viaje del transportista.dc.html", líneas 52-85).
 *
 * Muestra el viaje activo o los viajes declarados listos para iniciar (`hasAcceptedPackages: true`).
 * Si no hay ningún viaje activo ni declarado con paquetes aceptados, no se renderiza.
 */
export function CarrierTransportingSection({
  testID = "app-home-transporting",
}: CarrierTransportingSectionProps) {
  const colors = useThemeColors();
  const { data: myTripsData } = useMyTrips();
  const { data: transportingShipments } = useTransportingShipments();
  const startTripMutation = useStartTrip();

  const [startingTripId, setStartingTripId] = useState<string | null>(null);
  const [startTripError, setStartTripError] = useState<{ id: string; message: string } | null>(null);

  const trips = myTripsData?.items ?? [];

  const activeTrip = trips.find((t) => t.status === TripStatus.ACTIVE);
  const readyDeclaredTrips = trips
    .filter((t) => t.status === TripStatus.DECLARED && t.hasAcceptedPackages)
    .sort((a, b) => {
      // Priorizar el viaje de hoy sobre fechas futuras o pasadas
      const aIsToday = isTripDepartureToday(a.departureAt) ? 1 : 0;
      const bIsToday = isTripDepartureToday(b.departureAt) ? 1 : 0;
      if (aIsToday !== bIsToday) return bIsToday - aIsToday;
      return a.departureAt.localeCompare(b.departureAt);
    });

  const tripsToShow: TripWithAcceptedPackages[] = activeTrip
    ? [activeTrip]
    : readyDeclaredTrips;

  if (tripsToShow.length === 0) {
    return null;
  }

  // Número real de paradas calculadas a partir de los envíos que transporta el carrier
  const stopsCount =
    transportingShipments != null
      ? transportingShipments.reduce(
          (acc, s) => acc + (s.status === "in_transit" ? 1 : 2),
          0,
        )
      : undefined;

  const handleStartTrip = async (targetTrip: TripWithAcceptedPackages) => {
    try {
      setStartingTripId(targetTrip.id);
      setStartTripError(null);
      await startTripMutation.mutateAsync(targetTrip.id);
    } catch (err) {
      const msg = formatTripStartErrorMessage(err, targetTrip.departureAt);
      setStartTripError({ id: targetTrip.id, message: msg });
    } finally {
      setStartingTripId(null);
    }
  };

  return (
    <View testID={testID} className="mb-6 gap-2.5">
      <View className="flex-row items-center gap-2">
        <View className="h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-bg-mute">
          <Svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke={colors.fg2}
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <Circle cx={12} cy={4.5} r={2} />
            <Path d="M10 9l2-1 2 1 2 3-2 2v6" />
            <Path d="M10 9l-1.5 4.5 2 1.5v6" />
            <Rect x={15} y={10.5} width={5} height={4} rx={0.8} />
          </Svg>
        </View>
        <Text className="font-sans-semibold text-[11px] uppercase tracking-wider text-fg">
          Estoy transportando
        </Text>
        <Text className="font-mono text-[11px] text-fg-3">
          {tripsToShow.length}
        </Text>
      </View>

      {tripsToShow.map((trip) => (
        <CarrierTripCta
          key={trip.id}
          trip={trip}
          stopsCount={stopsCount}
          testID={`${testID}-card-${trip.id}`}
          onStart={handleStartTrip}
          isStarting={startingTripId === trip.id}
          errorMessage={startTripError?.id === trip.id ? startTripError.message : null}
        />
      ))}
    </View>
  );
}
