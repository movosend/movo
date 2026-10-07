import type { CarrierRouteStop } from "@movo/shared/dist/types/routing";
import { usePublicProfile } from "./use-profile";
import { useShipment } from "./use-shipments";

/**
 * Nombre de pila de la persona con la que el transportista se encuentra en una parada:
 * el emisor en un retiro, el receptor en una entrega. Reemplaza el ID del envío en la
 * card de la parada ("Retirás de Julia"), que no le dice nada a quien maneja.
 *
 * Las queries comparten clave con el resto de la app (`useShipment`/`usePublicProfile`),
 * así que una parada ya visitada en otra pantalla no vuelve a pedir nada. Las paradas del
 * modo demo no existen en el backend y devuelven `null` sin hacer requests.
 */
export function useStopCounterpartName(stop: CarrierRouteStop): string | null {
  const isDemo = stop.shipmentId.startsWith("demo-");
  const { data: shipment } = useShipment(isDemo ? undefined : stop.shipmentId);
  const personId = stop.type === "pickup" ? shipment?.senderId : shipment?.receiverId;
  const { data: profile } = usePublicProfile(personId);
  const first = profile?.fullName?.trim().split(/\s+/)[0];
  return first ? first : null;
}
