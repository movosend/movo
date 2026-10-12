-- MOVO-275 (ADR-038): marca durable de "la entrega empezó" (primer QR de entrega generado).
-- Nullable sin backfill: un envío en tránsito con un QR generado antes de este cambio no
-- tiene la marca, y a lo sumo admite una transferencia que el handshake ya no cancela.
-- Reversión: ALTER TABLE "shipments"."shipments" DROP COLUMN "delivery_handshake_started_at";

-- AlterTable
ALTER TABLE "shipments"."shipments" ADD COLUMN "delivery_handshake_started_at" TIMESTAMPTZ;
