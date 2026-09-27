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
  /** Ruta real + combustible + demanda (MOVO-138, ADR-025). */
  DEMAND_FUEL_ROUTES_V1 = "demand_fuel_routes_v1",
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
}
