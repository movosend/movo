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
import { createRouteGameRepository } from "../../repositories/route-game-repository";
import {
  createPricingLogisticsClient,
  PricingLogisticsClient,
} from "../../adapters/pricing-logistics-client";
import {
  createRouteGameService,
  RouteGameCreateInput,
  RouteGameSaveInput,
  RouteGameService,
} from "./route-game.service";
import { createRouteGameMatrixStore } from "./route-game-matrix-store";
import { createRouteGameStore } from "./route-game-store";

/**
 * El optimizador (OR-Tools con `routing_time_limit_seconds`, ~1 s) más, en el primer
 * juego de cada ciudad, la matriz de Google: los 1000 ms default del cliente no alcanzan.
 * Queda por debajo de los 8 s del proxy de `movo-institucional`.
 */
const ROUTE_GAME_ROUTING_TIMEOUT_MS = 6000;

export interface DemoRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests — mismo criterio que `ShipmentsRoutesOptions.pricingClient`. */
  pricingClient?: PricingClient;
  /** Override solo para tests — inyecta el servicio completo. */
  pricingGameService?: PricingGameService;
  pricingLogisticsClient?: PricingLogisticsClient;
  /** Override solo para tests — inyecta el servicio completo del juego del optimizador. */
  routeGameService?: RouteGameService;
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

  // Se arma en la primera request: los tests que solo prueban el juego de precios
  // registran este plugin sin `app.config`/`app.redis`.
  let routeGame: RouteGameService | undefined = opts.routeGameService;
  const routeGameService = (): RouteGameService => {
    if (!routeGame) {
      const pricingLogisticsClient =
        opts.pricingLogisticsClient ??
        createPricingLogisticsClient({
          PRICING_SERVICE_URL: app.config.PRICING_SERVICE_URL,
          timeoutMs: ROUTE_GAME_ROUTING_TIMEOUT_MS,
        });
      routeGame = createRouteGameService({
        pricingLogisticsClient,
        matrixStore: createRouteGameMatrixStore({ redis: app.redis, pricingLogisticsClient, logger: app.log }),
        gameStore: createRouteGameStore(app.redis),
        repository: createRouteGameRepository(app.db),
      });
    }
    return routeGame;
  };

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

  // --- Juego del optimizador ----------------------------------------------------------

  app.post(
    "/route-game/games",
    {
      schema: {
        summary: "Juego del optimizador: crear una partida",
        description:
          "Elige una ciudad y las paradas al azar y resuelve el orden óptimo con OR-Tools " +
          "(`POST /optimize/route` de pricing-logistics, `objective: distance`) sobre la matriz " +
          "de la ciudad, cacheada en Redis 30 días. El óptimo no se devuelve hasta registrar la " +
          "partida. `matrix` dice si la matriz salió de la cache o se facturó a Google (indicador " +
          "de costo del juego). 503 si el optimizador no responde.",
        tags: ["demo"],
        body: demoSchemas.routeGameCreateBody,
        response: {
          200: demoSchemas.routeGameCreateResponse,
          400: demoSchemas.errorResponse,
          401: demoSchemas.errorResponse,
          502: demoSchemas.errorResponse,
          503: demoSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      requireDemoClient(request);
      return routeGameService().createGame(request.body as RouteGameCreateInput);
    }
  );

  app.put(
    "/route-game/games/:id",
    {
      schema: {
        summary: "Juego del optimizador: registrar una partida",
        description:
          "Upsert idempotente por `id` (el `gameId` de la creación): el kiosco la manda al " +
          "terminar la carrera y otra vez al anotarse en el ranking. Los km del jugador se miden " +
          "con la misma matriz que usó OR-Tools (`computedBy: server`). Si la partida venció en " +
          "Redis, se aceptan los números de `offline` (`computedBy: client`); sin ellos, 404 " +
          "`ROUTE_GAME_NOT_FOUND`. Con `name` entra al ranking; el email solo se guarda con " +
          "`emailConsent: true`.",
        tags: ["demo"],
        params: demoSchemas.sessionParams,
        body: demoSchemas.routeGameSaveBody,
        response: {
          200: demoSchemas.routeGameSaveResponse,
          201: demoSchemas.routeGameSaveResponse,
          400: demoSchemas.errorResponse,
          401: demoSchemas.errorResponse,
          404: demoSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply) => {
      requireDemoClient(request);
      const { id } = request.params as { id: string };
      const result = await routeGameService().saveGame(id, request.body as RouteGameSaveInput);
      reply.code(result.created ? 201 : 200);
      return result;
    }
  );

  app.get(
    "/route-game/ranking",
    {
      schema: {
        summary: "Juego del optimizador: ranking del día",
        description:
          "Top 7 del día (hora de Argentina) de un evento: más eficiencia primero, a igual " +
          "eficiencia el más rápido. Con `gameId`, `position` dice su puesto y, si quedó fuera " +
          "del top, su fila reemplaza a la séptima. Compartido entre todos los iPads del stand.",
        tags: ["demo"],
        querystring: demoSchemas.routeGameRankingQuery,
        response: {
          200: demoSchemas.routeGameRankingResponse,
          400: demoSchemas.errorResponse,
          401: demoSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      requireDemoClient(request);
      const { eventTag, gameId } = request.query as { eventTag?: string; gameId?: string };
      return routeGameService().ranking(eventTag, gameId);
    }
  );

  app.post(
    "/route-game/ranking/reset",
    {
      schema: {
        summary: "Juego del optimizador: reiniciar el ranking de hoy",
        description:
          "Botón del modo stand: saca del ranking las partidas de hoy de un evento (no las borra, " +
          "siguen contando para métricas y el sorteo).",
        tags: ["demo"],
        body: demoSchemas.routeGameRankingResetBody,
        response: {
          200: demoSchemas.routeGameRankingResetResponse,
          400: demoSchemas.errorResponse,
          401: demoSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      requireDemoClient(request);
      const { eventTag } = (request.body ?? {}) as { eventTag?: string };
      return routeGameService().resetRanking(eventTag);
    }
  );
}
