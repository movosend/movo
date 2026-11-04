-- MOVO-35: distancia del envío y desglose de la cotización, para filtrar y abrir las métricas del panel.
-- Columnas nuevas y nullable. `distance_km` se completa en los envíos existentes con la misma estimación que usa
-- pricing sin Routes API: distancia en línea recta por el factor de desvío 1.3 (`ROAD_DETOUR_FACTOR`). El desglose no
-- se puede reconstruir: esos envíos quedan fuera de la apertura del precio por componente.
-- Reversión:
--   ALTER TABLE "shipments"."shipments" DROP COLUMN "distance_km", DROP COLUMN "quote_breakdown";

-- AlterTable
ALTER TABLE "shipments"."shipments" ADD COLUMN "distance_km" DECIMAL(10, 2),
ADD COLUMN "quote_breakdown" JSONB;

-- Backfill
UPDATE "shipments"."shipments"
SET "distance_km" = ROUND((
  2 * 6371 * ASIN(LEAST(1, SQRT(
    POWER(SIN(RADIANS(("delivery_lat" - "pickup_lat")::float8) / 2), 2) +
    COS(RADIANS("pickup_lat"::float8)) * COS(RADIANS("delivery_lat"::float8)) *
    POWER(SIN(RADIANS(("delivery_lng" - "pickup_lng")::float8) / 2), 2)
  ))) * 1.3
)::numeric, 2);
