/**
 * Wire contract de `POST /quote` en `movo-svc-pricing-logistics` (MOVO-82).
 * Consumido por `movo-svc-shipments` (`src/adapters/pricing-client.ts`) y, a futuro,
 * por el wizard de creación de envío del mobile (MOVO-83). El motor real (demanda +
 * combustible + Google Routes API, ver backlog) reemplaza la implementación detrás de
 * este mismo contrato sin requerir cambios en los consumidores — por eso vive acá y no
 * duplicado en cada servicio.
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
}

export interface PriceBreakdownItem {
  label: string;
  amountArs: number;
}

/**
 * Identifica la versión del algoritmo que produjo `suggestedPriceArs` (AC4 de
 * MOVO-82). `EUCLIDEAN_LINEAR_V1` es la implementación provisoria de este sprint —
 * agregar un valor nuevo acá cuando el motor real (ver backlog) reemplace la fórmula,
 * nunca reusar ni renombrar `EUCLIDEAN_LINEAR_V1` una vez desplegado (queda persistido
 * en envíos ya creados, AC8).
 */
export enum PriceCalculationMethod {
  EUCLIDEAN_LINEAR_V1 = "euclidean_linear_v1",
}

export interface QuoteResponse {
  suggestedPriceArs: number;
  breakdown: PriceBreakdownItem[];
  calculationMethod: PriceCalculationMethod;
}
