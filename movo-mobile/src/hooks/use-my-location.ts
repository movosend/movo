import { useCallback, useState } from "react";
import { geocodeClient } from "../api/geocode-client";
import { getCurrentLocation } from "../lib/location";
import type { AddressSelection } from "../types/address-selection";

/**
 * GPS + reverse geocoding, resuelto a un `AddressSelection` listo para usar (MOVO-83,
 * extraído del wizard de envíos en MOVO-121 — sin dependencias del store del wizard,
 * reusado también por la pantalla de gestión de direcciones guardadas vía
 * `address-search-sheet.tsx`).
 */
const FALLBACK_ADDRESS = "Ubicación actual";

export function useMyLocation() {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolveCurrentLocation = useCallback(async (): Promise<AddressSelection | null> => {
    setLocating(true);
    setError(null);
    try {
      const result = await getCurrentLocation();
      if (!result.granted) {
        setError("Necesitamos permiso de ubicación para usar tu posición actual.");
        return null;
      }
      // MOVO-125: resuelve una dirección real en vez del string fijo — sin esto, el
      // envío quedaba con "Ubicación actual" para siempre, sin forma de saber después
      // cuál era la dirección real. Fallback silencioso si el reverse-geocode falla
      // (red, proveedor caído): nunca bloquea el flujo por esto, el pin sigue siendo
      // la fuente de verdad (lat/lng), solo se pierde el label legible.
      let address = FALLBACK_ADDRESS;
      try {
        const reverse = await geocodeClient.reverseGeocode(result.lat, result.lng);
        address = reverse.formattedAddress;
      } catch {
        // silencioso a propósito, ver comentario arriba.
      }
      return { address, lat: result.lat, lng: result.lng, source: "gps" };
    } catch {
      setError("No pudimos obtener tu ubicación actual. Intentá de nuevo.");
      return null;
    } finally {
      setLocating(false);
    }
  }, []);

  return { resolveCurrentLocation, locating, error, clearError: () => setError(null) };
}
