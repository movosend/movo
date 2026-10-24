import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { createGeocodingProvider, GeocodingProvider } from "../../adapters/geocoding-provider";
import { createPlacesProvider, PlacePrediction, PlacesProvider } from "../../adapters/places-provider";
import { formatCoordinates, parseCoordinates } from "./coordinates";
import { placesSchemas } from "./places.schema";

export interface PlacesRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests de integración — evita depender de red/credenciales
   * reales de Google Maps, mismo criterio que `geocodingProvider` en
   * `geocode.routes.ts`. */
  placesProvider?: PlacesProvider;
  /** Override solo para tests: resuelve la dirección de una búsqueda por coordenadas. */
  geocodingProvider?: GeocodingProvider;
}

interface AutocompleteBody {
  input: string;
  sessionToken?: string;
}

interface DetailsBody {
  placeId: string;
  sessionToken?: string;
}

/**
 * Proxea la Places API (New) de Google para el paso de direcciones del wizard de
 * envío (MOVO-83): búsqueda de dirección estilo Uber/Pedidos Ya (un campo de texto
 * libre con sugerencias, en vez del formulario estructurado que usa `/geocode` para
 * el wizard de registro) — mismo motivo para ser server-side: no exponer
 * `GOOGLE_MAPS_API_KEY` (restringida por IP) en el bundle del mobile.
 *
 * Público a propósito, igual que `/geocode`: en la práctica solo lo llama un usuario
 * ya logueado (el wizard de envío vive detrás del login), pero no hay ninguna razón
 * de negocio para exigir un token acá — mantenerlo público lo deja simple y
 * consistente con el precedente ya establecido.
 */
export default async function placesRoutes(app: FastifyInstance, opts: PlacesRoutesOptions) {
  const provider = opts.placesProvider ?? createPlacesProvider(app.config);
  const geocoding = opts.geocodingProvider ?? createGeocodingProvider(app.config);

  /**
   * MOVO-340: el autocompletado de Google busca lugares por texto y no entiende
   * coordenadas. Si el texto lo son, no se llama a Places: se devuelve una única
   * sugerencia con el punto tal cual lo escribió el usuario (no el de la dirección más
   * cercana) y la dirección del reverse geocoding como etiqueta. Si no hay dirección
   * para ese punto (o el geocoding falla), la etiqueta son las coordenadas.
   */
  async function coordinatesPrediction(input: string): Promise<PlacePrediction | null> {
    const coords = parseCoordinates(input);
    if (!coords) return null;
    let description = formatCoordinates(coords);
    try {
      description = (await geocoding.reverseGeocode(coords.lat, coords.long)).formattedAddress;
    } catch (err) {
      app.log.warn({ err }, "places: reverse geocoding de coordenadas sin resultado");
    }
    return { placeId: `coords:${coords.lat},${coords.long}`, description, ...coords };
  }

  app.post<{ Body: AutocompleteBody }>(
    "/autocomplete",
    {
      schema: {
        summary: "Sugerencias de direcciones (Places Autocomplete)",
        description:
          "Devuelve hasta 5 sugerencias de dirección completas a partir de un texto " +
          "libre, para el paso de direcciones del wizard de creación de envío " +
          "(MOVO-83). Proxea la Places API (New) de Google server-side " +
          "(PLACES_PROVIDER) para no exponer esa API key en el bundle del mobile. " +
          "Si el texto son coordenadas (decimal o grados/minutos/segundos, MOVO-340) " +
          "devuelve una sola sugerencia con `lat`/`long`, sin pasar por Places.",
        tags: ["places"],
        body: placesSchemas.autocompleteBody,
        response: {
          200: placesSchemas.autocompleteResponse,
          400: placesSchemas.errorResponse,
          502: placesSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Body: AutocompleteBody }>, reply: FastifyReply) => {
      const fromCoordinates = await coordinatesPrediction(request.body.input);
      const predictions = fromCoordinates
        ? [fromCoordinates]
        : await provider.autocomplete(request.body.input, request.body.sessionToken);
      reply.code(200);
      return { predictions };
    }
  );

  app.post<{ Body: DetailsBody }>(
    "/details",
    {
      schema: {
        summary: "Detalle de una dirección (Places Details)",
        description:
          "Resuelve un `placeId` devuelto por /autocomplete a su dirección formateada " +
          "y coordenadas — el paso siguiente al elegir una sugerencia en el wizard de " +
          "envío (MOVO-83).",
        tags: ["places"],
        body: placesSchemas.detailsBody,
        response: {
          200: placesSchemas.detailsResponse,
          400: placesSchemas.errorResponse,
          404: placesSchemas.errorResponse,
          422: placesSchemas.errorResponse,
          502: placesSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest<{ Body: DetailsBody }>, reply: FastifyReply) => {
      const details = await provider.details(request.body.placeId, request.body.sessionToken);
      reply.code(200);
      return details;
    }
  );
}
