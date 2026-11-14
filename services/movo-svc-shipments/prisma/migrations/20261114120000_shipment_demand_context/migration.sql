-- MOVO-35 (DD-059): conteos de demanda de la cotización, para la oferta/demanda por ciudad del panel. Sin backfill:
-- `countAvailableCarriersNear` mide el momento de la cotización y no se puede reconstruir; los envíos anteriores quedan
-- en NULL y el reporte usa solo el `demandRatio` de `quote_breakdown`.
--
-- `sanction_withdrawal` marca la cancelación que hizo `sanction-effects` al suspender la cuenta del emisor, para que
-- "Por qué se cancelan" no dependa del texto libre del motivo (un emisor puede escribir "cuenta suspendida").
-- Backfill de lo anterior con la única señal que había: el motivo exacto, del propio emisor y sin admin.
--
-- Reversión:
--   ALTER TABLE "shipments"."shipments" DROP COLUMN "demand_published_shipments", DROP COLUMN "demand_available_carriers";
--   ALTER TABLE "shipments"."shipment_events" DROP COLUMN "sanction_withdrawal";

-- AlterTable
ALTER TABLE "shipments"."shipments" ADD COLUMN "demand_published_shipments" INTEGER,
ADD COLUMN "demand_available_carriers" INTEGER;

-- AlterTable
ALTER TABLE "shipments"."shipment_events" ADD COLUMN "sanction_withdrawal" BOOLEAN NOT NULL DEFAULT false;

-- Backfill (a mano: Prisma no genera datos)
UPDATE "shipments"."shipment_events" AS e
SET "sanction_withdrawal" = true
FROM "shipments"."shipments" AS s
WHERE s."id" = e."shipment_id"
  AND e."to_status" = 'cancelled'
  AND e."kind" = 'normal'
  AND e."reason" = 'cuenta suspendida'
  AND e."actor_id" = s."sender_id";
