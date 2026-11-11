-- MOVO-35 (DD-059): conteos de demanda de la cotización, para la oferta/demanda por ciudad del panel. Sin backfill:
-- `countAvailableCarriersNear` mide el momento de la cotización y no se puede reconstruir; los envíos anteriores quedan
-- en NULL y el reporte usa solo el `demandRatio` de `quote_breakdown`.
-- Reversión:
--   ALTER TABLE "shipments"."shipments" DROP COLUMN "demand_published_shipments", DROP COLUMN "demand_available_carriers";

-- AlterTable
ALTER TABLE "shipments"."shipments" ADD COLUMN "demand_published_shipments" INTEGER,
ADD COLUMN "demand_available_carriers" INTEGER;
