-- MOVO-253: plazo del emisor para elegir otro receptor tras un rechazo.
-- Nullable sin backfill: un rechazo anterior a este cambio queda en NULL y el
-- barrido lo cancela en su primera corrida (ver expireRejectedShipments).

-- AlterTable
ALTER TABLE "shipments"."shipments" ADD COLUMN "receiver_redesignation_deadline" TIMESTAMPTZ;
