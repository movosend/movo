-- MOVO-278 (DD-045): instante en que se le avisó al transportista que, si no confirma la
-- entrega, el envío marcado pasa a disputa. NULL = nunca avisado; solo se escribe una vez.
-- Reversión: ALTER TABLE "shipments"."shipments" DROP COLUMN "transit_anomaly_warned_at";
-- AlterTable
ALTER TABLE "shipments"."shipments" ADD COLUMN "transit_anomaly_warned_at" TIMESTAMPTZ;
