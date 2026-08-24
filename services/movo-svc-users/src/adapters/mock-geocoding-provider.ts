import { createHash } from "node:crypto";
import { GeocodeAddressInput, GeocodeResult, GeocodingProvider, ReverseGeocodeResult } from "./geocoding-provider";

// Córdoba Capital, Argentina — sede de la UTN FRC (contexto del TFG), centro de la
// pequeña grilla determinística que arma este mock.
const BASE_LAT = -31.4201;
const BASE_LONG = -64.1888;

/**
 * Implementación de desarrollo (GEOCODING_PROVIDER=mock, default): deriva un lat/long
 * determinístico a partir de un hash de la dirección, sin red — mismo criterio que
 * `MockDiditClient`/`ConsoleSmsProvider`. Determinístico (no aleatorio) para que los
 * tests puedan afirmar el mismo resultado dado el mismo input.
 */
export function createMockGeocodingProvider(): GeocodingProvider {
  return {
    async geocode(input: GeocodeAddressInput): Promise<GeocodeResult> {
      const key = `${input.street}|${input.number}|${input.city}|${input.province}|${input.zip}`;
      const digest = createHash("sha256").update(key).digest();
      // Offsets chicos (~0.01°, unos cientos de metros) para que el pin quede cerca
      // de la base en vez de saltar a cualquier lugar del mapa.
      const latOffset = (digest.readUInt16BE(0) / 0xffff - 0.5) * 0.02;
      const longOffset = (digest.readUInt16BE(2) / 0xffff - 0.5) * 0.02;
      return {
        lat: BASE_LAT + latOffset,
        long: BASE_LONG + longOffset,
        formattedAddress: `${input.street} ${input.number}, ${input.city}, ${input.province}`,
      };
    },

    // MOVO-125: determinístico sobre lat/long redondeados (no sobre el string crudo,
    // que tendría precisión de punto flotante distinta entre llamadas al mismo lugar)
    // — mismo criterio de "no depender de red/credenciales reales" que `geocode()`.
    async reverseGeocode(lat: number, long: number): Promise<ReverseGeocodeResult> {
      const key = `${lat.toFixed(4)}|${long.toFixed(4)}`;
      const digest = createHash("sha256").update(key).digest();
      const streetNumber = 100 + (digest.readUInt16BE(0) % 9000);
      return {
        formattedAddress: `Dirección simulada ${streetNumber}, Córdoba, Córdoba`,
      };
    },
  };
}
