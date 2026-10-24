/**
 * Wire contract de `POST /quote` en `movo-svc-pricing-logistics` (MOVO-82, MOVO-138).
 * Consumido por `movo-svc-shipments` (`src/adapters/pricing-client.ts`). El motor
 * `demand_fuel_routes_v1` (MOVO-138, ADR-025) reemplazó la implementación provisoria
 * detrás de este mismo contrato — por eso vive acá y no duplicado en cada servicio.
 */
export interface QuoteRequest {
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  packageType: "letter_document" | "standard_package" | "fragile_item";
  urgent: boolean;
  /**
   * Conteos de oferta/demanda en la zona de retiro (MOVO-138, ADR-025). Los calcula
   * `movo-svc-shipments`, que es dueño de esos datos — pricing sigue stateless
   * (ADR-019). Opcional: sin este campo no se aplica recargo por alta demanda.
   */
  demandContext?: DemandContext;
  /**
   * Pide el desglose de la fórmula en `breakdown`. Solo lo usa el módulo demo de
   * `movo-svc-shipments` (juego de precios de la feria); el flujo del emisor nunca lo
   * manda (ADR-025: el emisor ve solo el precio final).
   */
  includeBreakdown?: boolean;
}

/** Mismo desglose que el log `pricing_quote_computed`, en pesos salvo factores. */
export interface QuoteBreakdown {
  distanceKm: number;
  distanceSource: "routes_api" | "haversine_mock" | "haversine_fallback";
  fuelArsPerLiter: number;
  fuelSource: "api" | "lkg" | "config" | "mock";
  perKmArs: number;
  base: number;
  distance: number;
  weight: number;
  /** 1 + recargo por frágil en `package_tapered_v2`; factor por `packageType` en v1. */
  packageFactor: number;
  /** MOVO-276: ausentes en una respuesta de `demand_fuel_routes_v1`. */
  volumetricWeightKg?: number;
  billableWeightKg?: number;
  demandRatio: number;
  demandMultiplier: number;
}

export interface DemandContext {
  /** Envíos `published` con retiro dentro del radio de la zona, sin contar el cotizado. */
  publishedShipments: number;
  /** Transportistas distintos (`DISTINCT carrier_id`) con viaje que pasa por la zona. */
  availableCarriers: number;
}

/**
 * Identifica la versión del algoritmo que produjo `suggestedPriceArs` (AC4 de
 * MOVO-82). Agregar un valor nuevo cuando cambie la fórmula, nunca reusar ni renombrar
 * uno ya desplegado (queda persistido en envíos ya creados). Alineado 1:1 a mano con
 * el `Enum` de `movo-svc-pricing-logistics/app/models/quote.py`.
 */
export enum PriceCalculationMethod {
  /** Provisoria de MOVO-82 (ADR-018). Ya no se emite, pero sigue persistida en envíos viejos. */
  EUCLIDEAN_LINEAR_V1 = "euclidean_linear_v1",
  /** Ruta real + combustible + demanda (MOVO-138, ADR-025). Ya no se emite, pero sigue persistida en envíos viejos. */
  DEMAND_FUEL_ROUTES_V1 = "demand_fuel_routes_v1",
  /** Peso facturable, base por categoría y recargo por frágil sobre v1 (MOVO-276). Ya no se emite, pero sigue persistida en envíos viejos. */
  PACKAGE_TAPERED_V2 = "package_tapered_v2",
  /** Igual que v2 con el peso volumétrico acotado a un tope: los paquetes enormes ya no se disparan (MOVO-317). */
  PACKAGE_TAPERED_V3 = "package_tapered_v3",
}

/**
 * Sin desglose de la fórmula (MOVO-216/ADR-025): el emisor solo ve el precio final y
 * si rige alta demanda. El desglose queda en el log `pricing_quote_computed` de
 * `movo-svc-pricing-logistics`.
 */
export interface QuoteResponse {
  suggestedPriceArs: number;
  /** `true` si y solo si se aplicó recargo por alta demanda. */
  highDemand: boolean;
  calculationMethod: PriceCalculationMethod;
  /** Solo presente si el request trajo `includeBreakdown: true`. */
  breakdown?: QuoteBreakdown;
}

/**
 * Body de `POST /shipments/quote` en `movo-svc-shipments` (MOVO-255): los mismos
 * campos de `POST /shipments` que afectan el precio, con los mismos nombres.
 */
export interface ShipmentQuoteRequest {
  packageType: QuoteRequest["packageType"];
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  /** MOVO-317: "Más de 300 cm" en algún lado; las medidas llevan el tope (300). Afecta la cotización congelada. */
  oversized?: boolean;
  pickupLat: number;
  pickupLng: number;
  deliveryLat: number;
  deliveryLng: number;
}

/**
 * Respuesta de `POST /shipments/quote` (MOVO-255, ADR-028). Con precio, trae un
 * `quoteId` de un solo uso que congela ese precio hasta `expiresAt` al mandarlo en
 * `POST /shipments`. Si pricing no respondió, todo `null` ("precio a estimar") y sin
 * `quoteId`: no se congela una no-cotización.
 */
export type ShipmentQuoteResponse =
  | {
      quoteId: string;
      suggestedPriceArs: number;
      highDemand: boolean | null;
      calculationMethod: PriceCalculationMethod;
      /** ISO 8601. */
      expiresAt: string;
    }
  | {
      quoteId: null;
      suggestedPriceArs: null;
      highDemand: null;
      calculationMethod: null;
      expiresAt: null;
    };
