import { ApiError } from "@movo/shared";
import { PlaceDetails, PlacePrediction, PlacesProvider } from "./places-provider";

interface MockPlace {
  placeId: string;
  description: string;
  lat: number;
  long: number;
}

// Córdoba Capital + Villa Carlos Paz — misma zona que usa el resto de los mocks/fixtures
// del repo (ver `mock-geocoding-provider.ts`, base Córdoba Capital; y el spike de
// VRPTW de MOVO-50, que usa Córdoba → Villa Carlos Paz como ruta de referencia).
const MOCK_PLACES: MockPlace[] = [
  { placeId: "mock-1", description: "Av. Colón 1234, Córdoba, Argentina", lat: -31.4152, long: -64.1932 },
  { placeId: "mock-2", description: "Av. Rafael Núñez 4250, Córdoba, Argentina", lat: -31.3897, long: -64.2312 },
  { placeId: "mock-3", description: "Bv. Chacabuco 800, Córdoba, Argentina", lat: -31.4224, long: -64.1858 },
  { placeId: "mock-4", description: "Duarte Quirós 1000, Córdoba, Argentina", lat: -31.4203, long: -64.2011 },
  { placeId: "mock-5", description: "Av. Fuerza Aérea 5000, Córdoba, Argentina", lat: -31.3103, long: -64.2126 },
  { placeId: "mock-6", description: "San Martín 450, Villa Carlos Paz, Córdoba, Argentina", lat: -31.4238, long: -64.4977 },
  { placeId: "mock-7", description: "Av. San Martín 1200, Villa Carlos Paz, Córdoba, Argentina", lat: -31.4165, long: -64.5011 },
  { placeId: "mock-8", description: "Formosa 890, Villa Carlos Paz, Córdoba, Argentina", lat: -31.4291, long: -64.4933 },
];

/**
 * Implementación de desarrollo (PLACES_PROVIDER=mock, default): sin red,
 * determinística — mismo criterio que `createMockGeocodingProvider`. `autocomplete`
 * hace un substring case-insensitive contra una lista fija; `details` busca por
 * `placeId` en la misma lista.
 */
export function createMockPlacesProvider(): PlacesProvider {
  return {
    async autocomplete(input: string): Promise<PlacePrediction[]> {
      const needle = input.trim().toLowerCase();
      if (!needle) return [];
      return MOCK_PLACES.filter((place) => place.description.toLowerCase().includes(needle))
        .slice(0, 5)
        .map(({ placeId, description }) => ({ placeId, description }));
    },

    async details(placeId: string): Promise<PlaceDetails> {
      const place = MOCK_PLACES.find((p) => p.placeId === placeId);
      if (!place) {
        throw new ApiError(404, "PLACE_NOT_FOUND", "No encontramos esa dirección.");
      }
      return { formattedAddress: place.description, lat: place.lat, long: place.long };
    },
  };
}
