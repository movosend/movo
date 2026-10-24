-- MOVO-317: marca de "Más de 300 cm" en el envío. Columna nueva con default, no toca datos existentes
-- (los envíos previos quedan con `oversized = false`).
-- Reversión:
--   ALTER TABLE "shipments"."shipments" DROP COLUMN "oversized";

-- AlterTable
ALTER TABLE "shipments"."shipments" ADD COLUMN "oversized" BOOLEAN NOT NULL DEFAULT false;
