-- MOVO-307 (ADR-047): penalidad por cancelar un envío `assigned` con menos de 12 h. El monto
-- confirmado por el emisor y qué pasó con él (cobrado del hold, deuda o pendiente de cobro).
-- Ambas NULL en los envíos existentes y en toda cancelación sin cargo.
-- Reversión: DROP de las dos columnas y del tipo.

-- CreateEnum
CREATE TYPE "shipments"."cancellation_penalty_status_enum" AS ENUM ('pending', 'captured', 'debt');

-- AlterTable
ALTER TABLE "shipments"."shipments"
  ADD COLUMN "cancellation_penalty_ars" DECIMAL(12,2),
  ADD COLUMN "cancellation_penalty_status" "shipments"."cancellation_penalty_status_enum";
