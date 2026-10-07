import { router, useLocalSearchParams } from "expo-router";
import { ProximityGeoScreen } from "../../../../../components/shipments/proximity-geo-screen";
import { useShipment } from "../../../../../src/hooks/use-shipments";

/**
 * Paso 1 del wizard de entrega (MOVO-199, extensión de alcance pedida
 * explícitamente por el usuario -- no está en el AC2 literal del ticket, que lista
 * solo 4 pasos, pero replica la validación de proximidad del retiro, AC4 de
 * MOVO-198: "es una de las características principales de Movo"). Wrapper delgado
 * sobre `ProximityGeoScreen` (compartido con el paso equivalente de `pickup/index.tsx`)
 * contra el punto de entrega del envío (`shipment.deliveryLat/Lng`), con el receptor
 * como contraparte del pin (en vez del emisor).
 */
export default function DeliveryGeoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: shipment } = useShipment(id);

  return (
    <ProximityGeoScreen
      testIDPrefix="delivery-geo"
      title="Confirmá que llegaste"
      step={1}
      totalSteps={5}
      targetLat={shipment?.deliveryLat}
      targetLng={shipment?.deliveryLng}
      counterpartId={shipment?.receiverId}
      counterpartFallbackLabel="Receptor"
      arrivedTitle="Llegaste al punto de entrega"
      outOfRangeHint="Acercate y volvé a probar. La entrega se habilita dentro de los 100 m."
      deniedHint="Sin GPS no podemos confirmar que estás en el punto de entrega."
      onBack={() => (router.canGoBack() ? router.back() : router.replace(`/shipments/${id}`))}
      onContinue={() => router.push(`/shipments/${id}/delivery/resumen`)}
    />
  );
}
