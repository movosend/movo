-- MOVO-82 AC6/AC8: suggested_price_ars pasa a nullable ("precio a estimar" cuando
-- movo-svc-pricing-logistics no responde o faltan datos al crear el envío) y se
-- agrega calculation_method para identificar la versión del algoritmo que lo calculó.
-- Envíos preexistentes conservan su suggested_price_ars actual (no NULL) y quedan con
-- calculation_method NULL -- backfill descartado a propósito, no hay forma de inferir
-- retroactivamente qué fórmula produjo un precio ya persistido (AC8: nunca se
-- recalcula).

-- AlterTable
ALTER TABLE "shipments"."shipments" ALTER COLUMN "suggested_price_ars" DROP NOT NULL;
ALTER TABLE "shipments"."shipments" ADD COLUMN "calculation_method" TEXT;
