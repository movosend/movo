-- MOVO-346 (DD-057): plazo de pago extendido cuando el proveedor de pagos no responde al intento del emisor.
-- Columnas nuevas, nullable o con default: no tocan datos existentes.
-- Reversión:
--   ALTER TABLE "shipments"."shipments" DROP COLUMN "funding_deadline_extended_until",
--     DROP COLUMN "funding_deadline_extensions";

-- AlterTable
ALTER TABLE "shipments"."shipments" ADD COLUMN "funding_deadline_extended_until" TIMESTAMPTZ,
ADD COLUMN "funding_deadline_extensions" INTEGER NOT NULL DEFAULT 0;
