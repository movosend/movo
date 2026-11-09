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
const UNNAMED_LOCATION_LABEL = "Ubicación actual";

export const REVERSE_GEOCODE_FAILED_MESSAGE =
  "No pudimos obtener la dirección de tu ubicación. Escribila en el buscador.";

export interface ResolveCurrentLocationOptions {
  /**
   * `true` (default): si el reverse-geocode falla, no devuelve nada y deja el error para
   * mostrar. Es el caso de toda dirección que se guarda (retiro, entrega, extremos de un
   * viaje): un "Ubicación actual" guardado no le dice nada al transportista ni al
   * receptor (feedback de TestFlight, build 17).
   *
   * `false`: devuelve igual el punto con un label genérico. Solo para usos que no guardan
   * la dirección, como el origen del feed de Transportar, donde lo que importa es lat/lng.
   */
  requireAddress?: boolean;
}

export function useMyLocation() {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolveCurrentLocation = useCallback(
    async ({ requireAddress = true }: ResolveCurrentLocationOptions = {}): Promise<AddressSelection | null> => {
      setLocating(true);
      setError(null);
      try {
        const result = await getCurrentLocation();
        if (!result.granted) {
          setError("Necesitamos permiso de ubicación para usar tu posición actual.");
          return null;
        }
        // MOVO-125: resuelve una dirección real en vez del string fijo.
        let address: string;
        try {
          const reverse = await geocodeClient.reverseGeocode(result.lat, result.lng);
          address = reverse.formattedAddress;
        } catch {
          if (requireAddress) {
            setError(REVERSE_GEOCODE_FAILED_MESSAGE);
            return null;
          }
          address = UNNAMED_LOCATION_LABEL;
        }
        return { address, lat: result.lat, lng: result.lng, source: "gps" };
      } catch {
        setError("No pudimos obtener tu ubicación actual. Intentá de nuevo.");
        return null;
      } finally {
        setLocating(false);
      }
    },
    [],
  );

  return { resolveCurrentLocation, locating, error, clearError: () => setError(null) };
}
