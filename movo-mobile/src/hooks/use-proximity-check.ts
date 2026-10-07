import { useCallback, useState } from "react";
import { getCurrentLocation } from "../lib/location";
import { haversineDistanceKm } from "../lib/shipment-format";

export const PROXIMITY_THRESHOLD_METERS = 100;

export type ProximityStatus = "idle" | "checking" | "within_range" | "out_of_range" | "denied" | "error";

/**
 * Validación de proximidad del paso 1 del wizard de retiro (MOVO-198 AC4) y del
 * wizard de entrega (MOVO-199, extensión de alcance pedida explícitamente por el
 * usuario -- "es una de las características principales de Movo"): confirma que el
 * transportista está a menos de 100m del punto de retiro/entrega ANTES de dejarlo
 * avanzar -- distinto del chequeo de 100m del handshake en sí (MOVO-158/160, que
 * compara cedente vs. receptor de custodia en el momento de escanear, no contra la
 * dirección estática del envío). Sin permiso/GPS, nunca se asume "está cerca": el
 * caller queda en `denied`/`error` hasta que el usuario reintente.
 *
 * Genérico desde su creación en MOVO-198 (ya recibía `targetLat`/`targetLng` como
 * parámetros) -- solo el nombre delataba que era pickup-only. Renombrado en MOVO-199
 * para reflejar que sirve a los dos wizards del transportista, sin cambio de
 * comportamiento.
 */
export interface LatLng {
  lat: number;
  lng: number;
}

export function useProximityCheck(targetLat: number, targetLng: number) {
  const [status, setStatus] = useState<ProximityStatus>("idle");
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);
  const [currentLocation, setCurrentLocation] = useState<LatLng | null>(null);

  const check = useCallback(async () => {
    setStatus("checking");
    try {
      const location = await getCurrentLocation();
      if (!location.granted) {
        setStatus("denied");
        return;
      }
      setCurrentLocation({ lat: location.lat, lng: location.lng });
      const distanceKm = haversineDistanceKm(location.lat, location.lng, targetLat, targetLng);
      const meters = distanceKm * 1000;
      setDistanceMeters(meters);
      setStatus(meters <= PROXIMITY_THRESHOLD_METERS ? "within_range" : "out_of_range");
    } catch {
      setStatus("error");
    }
  }, [targetLat, targetLng]);

  return { status, distanceMeters, currentLocation, check };
}
