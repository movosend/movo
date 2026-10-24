import { useState } from "react";
import { Text, View } from "react-native";
import type { TripWithAcceptedPackages } from "../../src/api/trips-client";
import { useCarrierRequirementsSheet } from "../../src/hooks/use-carrier-requirements-sheet";
import { useMyTrips, useStartTrip } from "../../src/hooks/use-trips";
import { formatTripStartErrorMessage, splitCarrierHomeTrips } from "../../src/lib/trip-format";
import { CarrierRequirementsSheet } from "../carrier/carrier-requirements-checklist";
import { CarrierTripCta } from "../trips/carrier-trip-cta";
import { HomeSectionSkeleton, TRIP_CARD_SKELETON_HEIGHT } from "./home-section-states";
import { requireCarrierLocation } from "../../src/store/carrier-location-gate-store";

interface CarrierTransportingSectionProps {
  testID?: string;
}

/**
 * Sección operativa "Estoy transportando" en la pantalla de Inicio (Home),
 * fiel al prototipo de Tomás ("Viaje del transportista.dc.html", líneas 52-85).
 *
 * Muestra un solo viaje, con su CTA: el viaje en curso, o si no hay, el primer `declared`
 * con paquetes que sale hoy (`splitCarrierHomeTrips`). El resto de los viajes `declared`
 * con paquetes se lista en "Actividad reciente" (`RecentShipmentsSection`), no acá —
 * antes cada viaje era una card con su propio botón lima y rompía la jerarquía del Inicio.
 *
 * Si no hay viaje en curso ni uno de hoy, no se renderiza.
 */
export function CarrierTransportingSection({
  testID = "app-home-transporting",
}: CarrierTransportingSectionProps) {
  const { data: myTripsData, isLoading } = useMyTrips();
  const startTripMutation = useStartTrip();
  const requirements = useCarrierRequirementsSheet("start");

  const [startingTripId, setStartingTripId] = useState<string | null>(null);
  const [startTripError, setStartTripError] = useState<{ id: string; message: string } | null>(null);

  const { primaryTrip } = splitCarrierHomeTrips(myTripsData?.items ?? []);

  if (!primaryTrip) {
    // MOVO-168: cargando no es lo mismo que "sin viaje de hoy".
    if (isLoading) {
      return <HomeSectionSkeleton testID={`${testID}-skeleton`} cardHeight={TRIP_CARD_SKELETON_HEIGHT} />;
    }
    // Fallida: sin datos no sabemos si estás transportando, el aviso es el de `home.tsx`.
    return null;
  }

  // Iniciar el viaje arranca el tracking: primero pasa por el gate de ubicación.
  const handleStartTrip = (targetTrip: TripWithAcceptedPackages) =>
    requireCarrierLocation(() => startTripNow(targetTrip));

  const startTripNow = async (targetTrip: TripWithAcceptedPackages) => {
    try {
      setStartingTripId(targetTrip.id);
      setStartTripError(null);
      await startTripMutation.mutateAsync(targetTrip.id);
    } catch (err) {
      // MOVO-117: un 403 por licencia/MP faltante abre la checklist en vez de un error genérico.
      if (requirements.handleError(err)) return;
      const msg = formatTripStartErrorMessage(err, targetTrip.departureAt);
      setStartTripError({ id: targetTrip.id, message: msg });
    } finally {
      setStartingTripId(null);
    }
  };

  return (
    <View testID={testID} className="mb-6">
      {/* Mismo encabezado que "Actividad reciente": label + línea divisoria fina. */}
      <Text className="mb-3 font-sans-medium text-caption uppercase text-fg-3">
        Estoy transportando
      </Text>
      <View className="mb-3 h-px w-full bg-border" />

      <CarrierTripCta
        trip={primaryTrip}
        testID={`${testID}-card-${primaryTrip.id}`}
        onStart={handleStartTrip}
        isStarting={startingTripId === primaryTrip.id}
        errorMessage={startTripError?.id === primaryTrip.id ? startTripError.message : null}
      />
      <CarrierRequirementsSheet {...requirements.sheetProps} />
    </View>
  );
}
