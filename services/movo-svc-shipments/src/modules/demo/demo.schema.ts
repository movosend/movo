// Autocontenido a propósito (no importa de otros *.schema.ts), mismo criterio que
// shipments.schema.ts.
import { PRICING_GAME_SCREENS } from "../../models/pricing-game";
import { PRICING_GAME_PRESET_IDS } from "./pricing-game.presets";
import { ROUTE_GAME_MAX_STOPS, ROUTE_GAME_MIN_STOPS, ROUTE_GAME_SCENARIO_IDS } from "./route-game.scenarios";

// El juego solo ofrece localidades argentinas (bbox de la búsqueda de Photon en el front).
const AR_LAT = { type: "number", minimum: -56, maximum: -21 } as const;
const AR_LNG = { type: "number", minimum: -74, maximum: -53 } as const;
const ARS_AMOUNT = { type: ["number", "null"], minimum: 0, maximum: 100_000_000 } as const;
const ANSWER = { type: ["string", "null"], enum: ["yes", "maybe", "no", null] } as const;
// -10/-20/-30 (emisor), +10/+20/+30 (transportista), slider propio o "ni así".
const ALT_CHOICE = {
  type: ["string", "null"],
  enum: ["-10", "-20", "-30", "+10", "+20", "+30", "custom", "none", null],
} as const;
// Minúsculas, dígitos y guiones (ej. "feria-utn-2026"): se usa como filtro en stats.
const EVENT_TAG = { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,63}$" } as const;

const point = {
  type: "object",
  required: ["lat", "lng"],
  properties: { lat: AR_LAT, lng: AR_LNG },
  additionalProperties: false,
} as const;

const place = {
  type: ["object", "null"],
  required: ["name", "province", "lat", "lng"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    province: { type: "string", maxLength: 120 },
    lat: AR_LAT,
    lng: AR_LNG,
  },
  additionalProperties: false,
} as const;

const breakdown = {
  type: ["object", "null"],
  properties: {
    distanceKm: { type: "number" },
    distanceSource: { type: "string" },
    fuelArsPerLiter: { type: "number" },
    fuelSource: { type: "string" },
    perKmArs: { type: "number" },
    base: { type: "number" },
    distance: { type: "number" },
    weight: { type: "number" },
    packageFactor: { type: "number" },
    demandRatio: { type: "number" },
    demandMultiplier: { type: "number" },
  },
} as const;

const answerCounts = {
  type: "object",
  properties: { yes: { type: "integer" }, maybe: { type: "integer" }, no: { type: "integer" } },
} as const;

const sideStats = {
  type: "object",
  properties: {
    answers: answerCounts,
    rejectedAll: { type: "integer" },
    ratio: {
      type: "object",
      properties: {
        n: { type: "integer" },
        median: { type: ["number", "null"] },
        p25: { type: ["number", "null"] },
        p75: { type: ["number", "null"] },
      },
    },
  },
} as const;

const groupStatsProperties = {
  sessions: { type: "integer" },
  sender: sideStats,
  courier: sideStats,
} as const;

// --- Juego del optimizador ---------------------------------------------------------

const routePoint = {
  type: "object",
  required: ["name", "zone", "lat", "lng"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    zone: { type: "string", maxLength: 120 },
    lat: AR_LAT,
    lng: AR_LNG,
  },
  additionalProperties: false,
} as const;

const stopOrder = {
  type: "array",
  minItems: ROUTE_GAME_MIN_STOPS,
  maxItems: ROUTE_GAME_MAX_STOPS,
  items: { type: "integer", minimum: 0, maximum: ROUTE_GAME_MAX_STOPS - 1 },
} as const;

const KM = { type: "number", minimum: 0, maximum: 10_000 } as const;
const MINUTES = { type: "number", minimum: 0, maximum: 100_000 } as const;

const routeGameSaveResponse = {
  type: "object",
  required: [
    "id",
    "created",
    "computedBy",
    "userKm",
    "optimalKm",
    "userMin",
    "optimalMin",
    "extraKm",
    "extraMin",
    "efficiencyPct",
    "tie",
    "optimalOrder",
    "distanceMethod",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    created: { type: "boolean" },
    computedBy: { type: "string", enum: ["server", "client"] },
    userKm: { type: "number" },
    optimalKm: { type: "number" },
    userMin: { type: "number" },
    optimalMin: { type: "number" },
    extraKm: { type: "number" },
    extraMin: { type: "number" },
    efficiencyPct: { type: "number" },
    tie: { type: "boolean" },
    optimalOrder: { type: "array", items: { type: "integer" } },
    distanceMethod: { type: ["string", "null"] },
  },
} as const;

const routeGameSchemas = {
  routeGameCreateBody: {
    type: "object",
    required: ["stopCount"],
    properties: {
      stopCount: { type: "integer", minimum: ROUTE_GAME_MIN_STOPS, maximum: ROUTE_GAME_MAX_STOPS },
      lastScenarioId: { type: "string", maxLength: 16 },
    },
    additionalProperties: false,
  },

  routeGameCreateResponse: {
    type: "object",
    required: ["gameId", "scenarioId", "city", "zone", "start", "end", "stops", "initialOrder", "matrix"],
    properties: {
      gameId: { type: "string", format: "uuid" },
      scenarioId: { type: "string" },
      city: { type: "string" },
      zone: { type: "string" },
      start: routePoint,
      end: routePoint,
      stops: { type: "array", items: routePoint },
      initialOrder: { type: "array", items: { type: "integer" } },
      matrix: {
        type: "object",
        required: ["cache", "provider", "elementsBilled"],
        properties: {
          cache: { type: "string", enum: ["hit", "miss"] },
          provider: { type: "string" },
          elementsBilled: { type: "integer" },
        },
      },
    },
  },

  routeGameSaveBody: {
    type: "object",
    required: ["startedAt", "endedAt", "userOrder", "timeUsedSec", "timedOut"],
    properties: {
      eventTag: EVENT_TAG,
      deviceId: { type: "string", maxLength: 64 },
      startedAt: { type: "string", format: "date-time" },
      endedAt: { type: "string", format: "date-time" },
      userOrder: stopOrder,
      timeUsedSec: { type: "integer", minimum: 0, maximum: 3_600 },
      timeLimitSec: { type: ["integer", "null"], minimum: 10, maximum: 600 },
      timedOut: { type: "boolean" },
      name: { type: ["string", "null"], maxLength: 18 },
      email: { type: ["string", "null"], format: "email", maxLength: 254 },
      emailConsent: { type: "boolean" },
      userAgent: { type: ["string", "null"], maxLength: 512 },
      offline: {
        type: "object",
        required: [
          "scenarioId",
          "city",
          "points",
          "optimalOrder",
          "userKm",
          "optimalKm",
          "userMin",
          "optimalMin",
          "distanceMethod",
        ],
        properties: {
          scenarioId: { type: "string", enum: ROUTE_GAME_SCENARIO_IDS },
          city: { type: "string", maxLength: 64 },
          points: {
            type: "object",
            required: ["start", "stops", "end"],
            properties: {
              start: routePoint,
              stops: { type: "array", minItems: ROUTE_GAME_MIN_STOPS, maxItems: ROUTE_GAME_MAX_STOPS, items: routePoint },
              end: routePoint,
            },
            additionalProperties: false,
          },
          optimalOrder: stopOrder,
          userKm: KM,
          optimalKm: KM,
          userMin: MINUTES,
          optimalMin: MINUTES,
          distanceMethod: { type: "string", maxLength: 32 },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },

  routeGameSaveResponse,

  routeGameRankingQuery: {
    type: "object",
    properties: { eventTag: EVENT_TAG, gameId: { type: "string", format: "uuid" } },
    additionalProperties: false,
  },

  routeGameRankingResponse: {
    type: "object",
    required: ["total", "position", "entries"],
    properties: {
      total: { type: "integer" },
      position: { type: ["integer", "null"] },
      entries: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "position", "name", "efficiencyPct", "timeUsedSec", "mine"],
          properties: {
            id: { type: "string" },
            position: { type: "integer" },
            name: { type: "string" },
            efficiencyPct: { type: "number" },
            timeUsedSec: { type: "integer" },
            mine: { type: "boolean" },
          },
        },
      },
    },
  },

  routeGameRankingResetBody: {
    type: "object",
    properties: { eventTag: EVENT_TAG },
    additionalProperties: false,
  },

  routeGameRankingResetResponse: {
    type: "object",
    required: ["hidden"],
    properties: { hidden: { type: "integer" } },
  },
} as const;

export const demoSchemas = {
  ...routeGameSchemas,

  quoteBody: {
    type: "object",
    required: ["origin", "destination", "packagePreset"],
    properties: {
      origin: point,
      destination: point,
      packagePreset: { type: "string", enum: PRICING_GAME_PRESET_IDS },
    },
    additionalProperties: false,
  },

  quoteResponse: {
    type: "object",
    required: [
      "quoteId",
      "suggestedPriceArs",
      "highDemand",
      "calculationMethod",
      "breakdown",
      "commissionRate",
      "courierEarnArs",
    ],
    properties: {
      quoteId: { type: "string", format: "uuid" },
      suggestedPriceArs: { type: "number" },
      highDemand: { type: ["boolean", "null"] },
      calculationMethod: { type: "string" },
      breakdown,
      commissionRate: { type: "number" },
      courierEarnArs: { type: "number" },
    },
  },

  sessionParams: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  },

  sessionBody: {
    type: "object",
    required: ["startedAt", "endedAt", "durationSec", "completed", "lastScreen"],
    properties: {
      eventTag: EVENT_TAG,
      deviceId: { type: "string", maxLength: 64 },
      startedAt: { type: "string", format: "date-time" },
      endedAt: { type: "string", format: "date-time" },
      durationSec: { type: "integer", minimum: 0, maximum: 86_400 },
      completed: { type: "boolean" },
      lastScreen: { type: "string", enum: PRICING_GAME_SCREENS },
      origin: place,
      destination: place,
      packagePreset: { type: ["string", "null"], enum: [...PRICING_GAME_PRESET_IDS, null] },
      quoteId: { type: ["string", "null"], format: "uuid" },
      suggestedPriceArs: ARS_AMOUNT,
      courierEarnArs: ARS_AMOUNT,
      senderAnswer: ANSWER,
      senderAltChoice: ALT_CHOICE,
      senderWtpArs: ARS_AMOUNT,
      courierAnswer: ANSWER,
      courierAltChoice: ALT_CHOICE,
      courierWtaArs: ARS_AMOUNT,
      uberEstimateArs: ARS_AMOUNT,
      email: { type: ["string", "null"], format: "email", maxLength: 254 },
      emailConsent: { type: "boolean" },
      userAgent: { type: ["string", "null"], maxLength: 512 },
    },
    additionalProperties: false,
  },

  sessionResponse: {
    type: "object",
    required: ["id", "created", "quoteVerified"],
    properties: {
      id: { type: "string", format: "uuid" },
      created: { type: "boolean" },
      quoteVerified: { type: "boolean" },
    },
  },

  statsQuery: {
    type: "object",
    properties: { eventTag: EVENT_TAG },
    additionalProperties: false,
  },

  statsResponse: {
    type: "object",
    properties: {
      ...groupStatsProperties,
      completed: { type: "integer" },
      completionRate: { type: ["number", "null"] },
      byPackage: { type: "object", additionalProperties: { type: "object", properties: groupStatsProperties } },
      byDistance: {
        type: "object",
        additionalProperties: {
          type: "object",
          properties: { label: { type: "string" }, ...groupStatsProperties },
        },
      },
    },
  },

  errorResponse: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message", "statusCode"],
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          statusCode: { type: "integer" },
        },
      },
    },
  },
};
