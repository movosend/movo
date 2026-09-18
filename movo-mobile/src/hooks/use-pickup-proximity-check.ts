import { useCallback, useState } from "react";
import { getCurrentLocation } from "../lib/location";
import { haversineDistanceKm } from "../lib/shipment-format";

export const PICKUP_PROXIMITY_THRESHOLD_METERS = 150;

export type PickupProximityStatus = "idle" | "checking" | "within_range" | "out_of_range" | "denied" | "error";

/**
 * Validación de proximidad del paso 1 del wizard de retiro (MOVO-198 AC4): confirma
 * que el transportista está a menos de 150m del punto de retiro ANTES de dejarlo
 * avanzar -- distinto del chequeo de 100m del handshake en sí (MOVO-158/160, que
 * compara emisor vs. transportista en el momento de escanear, no contra la
 * dirección estática del envío). Sin permiso/GPS, nunca se asume "está cerca": el
 * caller queda en `denied`/`error` hasta que el usuario reintente.
 */
export function usePickupProximityCheck(pickupLat: number, pickupLng: number) {
  const [status, setStatus] = useState<PickupProximityStatus>("idle");
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);

  const check = useCallback(async () => {
    setStatus("checking");
    try {
      const location = await getCurrentLocation();
      if (!location.granted) {
        setStatus("denied");
        return;
      }
      const distanceKm = haversineDistanceKm(location.lat, location.lng, pickupLat, pickupLng);
      const meters = distanceKm * 1000;
      setDistanceMeters(meters);
      setStatus(meters <= PICKUP_PROXIMITY_THRESHOLD_METERS ? "within_range" : "out_of_range");
    } catch {
      setStatus("error");
    }
  }, [pickupLat, pickupLng]);

  return { status, distanceMeters, check };
}
