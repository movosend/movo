import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { ApiError } from "@movo/shared";
import { demoSchemas } from "./demo.schema";
import {
  createPricingGameService,
  PricingGameQuoteInput,
  PricingGameService,
  PricingGameSessionInput,
} from "./pricing-game.service";
import { createPricingGameQuoteStore } from "./pricing-game-quote-store";
import { createPricingClient, PricingClient } from "../../adapters/pricing-client";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { createTripRepository } from "../../repositories/trip-repository";
import { createPricingGameRepository } from "../../repositories/pricing-game-repository";

export interface DemoRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests — mismo criterio que `ShipmentsRoutesOptions.pricingClient`. */
  pricingClient?: PricingClient;
  /** Override solo para tests — inyecta el servicio completo. */
  pricingGameService?: PricingGameService;
}

/**
 * Juegos interactivos del sitio institucional (`movo-institucional`, /juegos) que
 * muestran módulos reales de Movo. Sin usuario: el gateway autentica estas rutas con
 * API key (`DEMO_API_KEYS`) en vez de JWT e inyecta `x-client-id`. Igual que con
 * `x-user-id` en el resto del servicio (ADR-010), se confía en ese header porque el
 * puerto del servicio no se publica fuera de `movo-net`; exigirlo evita que una ruta
 * demo quede accesible por error si alguien la proxea sin pasar por el chequeo de key.
 */
function requireDemoClient(request: FastifyRequest): string {
  const clientId = request.headers["x-client-id"];
  if (typeof clientId !== "string" || !clientId.startsWith("demo")) {
    throw new ApiError(401, "AUTH_API_KEY_INVALID", "Falta la credencial del cliente demo.");
  }
  return clientId;
}

export default async function demoRoutes(app: FastifyInstance, opts: DemoRoutesOptions) {
  const service =
    opts.pricingGameService ??
    createPricingGameService({
      quoteDeps: {
        pricingClient: opts.pricingClient ?? createPricingClient(app.config),
        shipmentRepository: createShipmentRepository(app.db),
        tripRepository: createTripRepository(app.db),
        logger: app.log,
      },
      quoteStore: createPricingGameQuoteStore(app.redis),
      repository: createPricingGameRepository(app.db),
    });

  app.post(
    "/pricing-game/quote",
    {
      schema: {
        summary: "Juego de precios: cotizar un envío de ejemplo",
        description:
          "Precio sugerido real (`demand_fuel_routes_v1`, misma lógica que `POST /shipments/quote`, " +
          "con la demanda de la zona de retiro) para un paquete predefinido, más el desglose de la " +
          "fórmula y la ganancia neta del transportista (comisión real). Devuelve un `quoteId` " +
          "(1 h) para atar la partida al precio cotizado por el servidor. 503 si pricing no responde.",
        tags: ["demo"],
        body: demoSchemas.quoteBody,
        response: {
          200: demoSchemas.quoteResponse,
          400: demoSchemas.errorResponse,
          401: demoSchemas.errorResponse,
          503: demoSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      requireDemoClient(request);
      return service.quote(request.body as PricingGameQuoteInput);
    }
  );

  app.put(
    "/pricing-game/sessions/:id",
    {
      schema: {
        summary: "Juego de precios: registrar una partida",
        description:
          "Upsert idempotente por `id` (UUID generado por el kiosco): el reenvío de la cola " +
          "offline no duplica filas. Precio, desglose y ganancia salen de la cotización guardada " +
          "por `quoteId` (`quoteVerified: true`); si venció, se usan los del body y queda en " +
          "`false`. El email solo se guarda con `emailConsent: true`.",
        tags: ["demo"],
        params: demoSchemas.sessionParams,
        body: demoSchemas.sessionBody,
        response: {
          200: demoSchemas.sessionResponse,
          201: demoSchemas.sessionResponse,
          400: demoSchemas.errorResponse,
          401: demoSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply) => {
      requireDemoClient(request);
      const { id } = request.params as { id: string };
      const result = await service.saveSession(id, request.body as PricingGameSessionInput);
      reply.code(result.created ? 201 : 200);
      return result;
    }
  );

  app.get(
    "/pricing-game/stats",
    {
      schema: {
        summary: "Juego de precios: métricas agregadas",
        description:
          "Aceptación del precio (emisor) y de la ganancia (transportista), y mediana/cuartiles de " +
          "`disposición a pagar / precio` y `pedido / ganancia`, en total, por paquete y por tramo " +
          "de distancia. Sin datos personales. `eventTag` filtra un evento (ej. `feria-utn-2026`).",
        tags: ["demo"],
        querystring: demoSchemas.statsQuery,
        response: {
          200: demoSchemas.statsResponse,
          400: demoSchemas.errorResponse,
          401: demoSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      requireDemoClient(request);
      const { eventTag } = request.query as { eventTag?: string };
      return service.stats(eventTag);
    }
  );
}
