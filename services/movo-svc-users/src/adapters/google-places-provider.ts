import { ApiError } from "@movo/shared";
import { PlaceDetails, PlacePrediction, PlacesProvider } from "./places-provider";

export interface GooglePlacesProviderConfig {
  apiKey: string;
  autocompleteUrl?: string;
  detailsBaseUrl?: string;
}

const DEFAULT_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DEFAULT_DETAILS_BASE_URL = "https://places.googleapis.com/v1/places";

interface GoogleAutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId: string;
      text?: { text: string };
    };
  }>;
}

interface GoogleDetailsResponse {
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
}

/**
 * Implementación real de `PlacesProvider` sobre la Places API (New) de Google —
 * NOTA: sin verificar contra la doc real de Google en este entorno (sin acceso de
 * red saliente para chequearla al escribir esto); implementado sobre el shape v1
 * conocido de Autocomplete (New)/Place Details (New). Verificar contra
 * https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
 * y .../place-details antes de activar `PLACES_PROVIDER=google` en un ambiente real —
 * mismo criterio de honestidad que otras piezas no validadas contra sandbox real en
 * este repo (p.ej. `DIDIT_MODE=mock` hasta MOVO-72 se probó contra el sandbox real).
 *
 * Reusa la misma `GOOGLE_MAPS_API_KEY` server-side de `GeocodingProvider` (ADR-014) —
 * restringida por IP, nunca embebida en el bundle del mobile. Restringido a Argentina
 * (`includedRegionCodes`) para no devolver sugerencias fuera del alcance de la app.
 */
export function createGooglePlacesProvider(config: GooglePlacesProviderConfig): PlacesProvider {
  const autocompleteUrl = config.autocompleteUrl ?? DEFAULT_AUTOCOMPLETE_URL;
  const detailsBaseUrl = config.detailsBaseUrl ?? DEFAULT_DETAILS_BASE_URL;

  return {
    async autocomplete(input: string): Promise<PlacePrediction[]> {
      let response: Response;
      try {
        response = await fetch(autocompleteUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": config.apiKey,
          },
          body: JSON.stringify({ input, includedRegionCodes: ["ar"] }),
        });
      } catch {
        throw new ApiError(502, "PLACES_PROVIDER_ERROR", "No se pudo conectar con el proveedor de direcciones.");
      }

      if (!response.ok) {
        throw new ApiError(502, "PLACES_PROVIDER_ERROR", "El proveedor de direcciones devolvió un error.");
      }

      const body = (await response.json()) as GoogleAutocompleteResponse;
      return (body.suggestions ?? [])
        .map((s) => s.placePrediction)
        .filter((p): p is { placeId: string; text?: { text: string } } => Boolean(p?.placeId))
        .map((p) => ({ placeId: p.placeId, description: p.text?.text ?? "" }));
    },

    async details(placeId: string): Promise<PlaceDetails> {
      let response: Response;
      try {
        response = await fetch(`${detailsBaseUrl}/${encodeURIComponent(placeId)}`, {
          method: "GET",
          headers: {
            "X-Goog-Api-Key": config.apiKey,
            "X-Goog-FieldMask": "formattedAddress,location",
          },
        });
      } catch {
        throw new ApiError(502, "PLACES_PROVIDER_ERROR", "No se pudo conectar con el proveedor de direcciones.");
      }

      if (!response.ok) {
        throw new ApiError(422, "PLACE_NOT_FOUND", "No encontramos esa dirección.");
      }

      const body = (await response.json()) as GoogleDetailsResponse;
      if (!body.formattedAddress || !body.location) {
        throw new ApiError(422, "PLACE_NOT_FOUND", "No encontramos esa dirección.");
      }

      return {
        formattedAddress: body.formattedAddress,
        lat: body.location.latitude,
        long: body.location.longitude,
      };
    },
  };
}
