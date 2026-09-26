-- MOVO-173: sub-scores opcionales de una calificación (puntualidad/cuidado del paquete/
-- comunicación del transportista; puntualidad/comunicación del emisor y del receptor).
-- Migración aditiva: columnas nullable, las filas existentes quedan en NULL y no se
-- recalculan. Generado con `prisma migrate diff --from-schema <schema.prisma previo>
-- --to-schema prisma/schema.prisma --script` (nunca `prisma migrate dev` contra el
-- Postgres compartido de dev/CI — ver nota de MOVO-104 en CLAUDE.md).
--
-- Reversión: `ALTER TABLE "shipments"."ratings" DROP COLUMN "punctuality_score", DROP COLUMN
-- "care_score", DROP COLUMN "communication_score";` — solo pierde los sub-scores ya cargados,
-- el `score` general no se toca.

-- AlterTable
ALTER TABLE "shipments"."ratings" ADD COLUMN     "care_score" INTEGER,
ADD COLUMN     "communication_score" INTEGER,
ADD COLUMN     "punctuality_score" INTEGER;
