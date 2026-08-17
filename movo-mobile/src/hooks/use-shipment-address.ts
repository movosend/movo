import { useCallback, useState } from "react";
import { geocodeClient } from "../api/geocode-client";
import { getCurrentLocation } from "../lib/location";
import type { AddressSelection } from "../store/shipment-wizard-store";

/**
 * Wrapper del paso de direcciones del wizard de envíos (MOVO-83) alrededor de
 * `src/lib/location.ts` (GPS). Devuelve un `AddressSelection` listo para el store en
 * vez de tocarlo directo — el paso decide cuándo llamar `setPickup`/`setDelivery`.
 *
 * El geocoding de dirección cargada a mano (`POST /geocode`, MOVO-73) se sacó de acá:
 * el rediseño tipo Uber/PedidosYa del paso de direcciones usa `placesClient`
 * (autocomplete + details) en `address-search-sheet.tsx` en su lugar — no queda
 * ningún caller de un geocode estructurado (calle/número/ciudad/CP) en este wizard.
 */
const FALLBACK_ADDRESS = "Ubicación actual";

export function useShipmentAddress() {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const useMyLocation = useCallback(async (): Promise<AddressSelection | null> => {
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

  return { useMyLocation, locating, error, clearError: () => setError(null) };
}
