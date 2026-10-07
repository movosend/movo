-- MOVO-258 (D7): estado de oferta para las que quedan colgadas al cancelarse su envío.
-- Reversión: Postgres no permite quitar un valor de un enum; recrear el tipo si hiciera falta.
-- AlterEnum
ALTER TYPE "shipments"."offer_status_enum" ADD VALUE 'shipment_cancelled';

-- MOVO-258 (D4): marca de revisión de un envío `in_transit` que nunca se entrega.
-- NULL = nunca marcado. Reversión: ALTER TABLE "shipments"."shipments" DROP COLUMN "transit_anomaly_flagged_at";
-- AlterTable
ALTER TABLE "shipments"."shipments" ADD COLUMN "transit_anomaly_flagged_at" TIMESTAMPTZ;
