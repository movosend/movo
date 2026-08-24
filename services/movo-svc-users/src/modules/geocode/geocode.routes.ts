import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { GeocodeAddressInput, createGeocodingProvider, GeocodingProvider } from "../../adapters/geocoding-provider";
import { geocodeSchemas } from "./geocode.schema";
import { requireUserIdFromHeader } from "../../utils/require-user-id";

export interface GeocodeRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests de integración — evita depender de red/credenciales
   * reales de Google Maps, mismo criterio que `diditClient` en `kyc.routes.ts`. */
  geocodingProvider?: GeocodingProvider;
}

/**
 * `POST /` (forward) es público a propósito (MOVO-73): se llama durante el wizard de
 * registro, antes de que exista una cuenta o un token — mismo momento del onboarding
 * en el que también son públicos `send-otp`/`verify-otp`. Queda bajo el rate limit
 * del gateway para no quedar abierto como proxy gratuito de la API de Google (ver
 * routes-map.ts). `POST /reverse` (MOVO-125) es distinto: protegida, ver su propio
 * comentario más abajo.
 */
export default async function geocodeRoutes(app: FastifyInstance, opts: GeocodeRoutesOptions) {
  const provider = opts.geocodingProvider ?? createGeocodingProvider(app.config);

  app.post<{ Body: GeocodeAddressInput }>(
    "/",
    {
      schema: {
        summary: "Geocodificar una dirección",
        description:
          "Centra el paso de mapa del wizard de registro (MOVO-73): recibe la dirección " +
          "cargada a mano y devuelve un lat/long inicial para el pin, que el usuario " +
          "puede ajustar antes de confirmar. Proxea la Geocoding API de Google " +
          "server-side (GEOCODING_PROVIDER) para no exponer esa API key en el bundle " +
          "del mobile.",
        tags: ["geocode"],
        body: geocodeSchemas.geocodeBody,
        response: {
          200: geocodeSchemas.geocodeResponse,
          400: geocodeSchemas.errorResponse,
          422: geocodeSchemas.errorResponse,
          502: geocodeSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Body: GeocodeAddressInput }>, reply: FastifyReply) => {
      const result = await provider.geocode(request.body);
      reply.code(200);
      return result;
    }
  );

  app.post<{ Body: { lat: number; long: number } }>(
    "/reverse",
    {
      schema: {
        summary: "Geocodificar coordenadas de forma inversa",
        description:
          "MOVO-125: resuelve una dirección legible a partir de lat/long — usado por " +
          "\"usar mi ubicación actual\" en el wizard de envío. A diferencia de `/geocode` " +
          "(público, se llama pre-auth durante el registro), esta ruta está PROTEGIDA: " +
          "su único caller real ya está logueado, no hay razón de negocio para dejarla " +
          "abierta a pegarle gratis a la Geocoding API de Google.",
        tags: ["geocode"],
        body: geocodeSchemas.reverseGeocodeBody,
        response: {
          200: geocodeSchemas.reverseGeocodeResponse,
          400: geocodeSchemas.errorResponse,
          401: geocodeSchemas.errorResponse,
          422: geocodeSchemas.errorResponse,
          502: geocodeSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Body: { lat: number; long: number } }>, reply: FastifyReply) => {
      requireUserIdFromHeader(request);
      const result = await provider.reverseGeocode(request.body.lat, request.body.long);
      reply.code(200);
      return result;
    }
  );
}
