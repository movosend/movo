-- MOVO-344: cuándo se decidió la disputa (pasó a `resolving`), para las medianas del embudo del reporte.
-- Columna nueva y nullable: no toca datos existentes. Sin backfill: ese instante no se guardaba, y las disputas
-- anteriores quedan fuera de las medianas.
-- Reversión:
--   ALTER TABLE "shipments"."disputes" DROP COLUMN "decided_at";

-- AlterTable
ALTER TABLE "shipments"."disputes" ADD COLUMN "decided_at" TIMESTAMPTZ;
