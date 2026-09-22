import { router, useLocalSearchParams } from "expo-router";
import { ProximityGeoScreen } from "../../../../../components/shipments/proximity-geo-screen";
import { useShipment } from "../../../../../src/hooks/use-shipments";

/**
 * Paso 1 del wizard de retiro (MOVO-198, rediseño): validación de proximidad (AC4)
 * contra el punto de retiro del envío. Wrapper delgado sobre `ProximityGeoScreen`
 * (MOVO-199: componente extraído de acá, compartido con el paso equivalente del
 * wizard de entrega) -- el mapa/pulso/lógica de GPS en sí viven ahí, este archivo
 * solo resuelve las coordenadas/copy específicos de retiro. Historial completo de
 * los 5 ajustes post-feedback sobre el diseño de esta pantalla: ver `git log` de
 * `components/shipments/proximity-geo-screen.tsx`.
 */
export default function PickupGeoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: shipment } = useShipment(id);

  return (
    <ProximityGeoScreen
      testIDPrefix="pickup-geo"
      title="Confirmá que llegaste"
      step={1}
      totalSteps={5}
      targetLat={shipment?.pickupLat}
      targetLng={shipment?.pickupLng}
      counterpartId={shipment?.senderId}
      counterpartFallbackLabel="Emisor"
      arrivedTitle="Llegaste al punto de retiro"
      outOfRangeHint="Acercate y volvé a probar. El retiro se habilita dentro de los 100 m."
      deniedHint="Sin GPS no podemos confirmar que estás en el punto de retiro."
      onBack={() => (router.canGoBack() ? router.back() : router.replace(`/shipments/${id}`))}
      onContinue={() => router.push(`/shipments/${id}/pickup/resumen`)}
    />
  );
}
