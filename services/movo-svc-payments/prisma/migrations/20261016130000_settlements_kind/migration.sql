-- MOVO-306: la liquidación distingue la captura de entrega (total, MOVO-212) de la penalidad
-- de cancelación (parcial). Sigue siendo una fila por envío; las existentes son entregas.

-- CreateEnum
CREATE TYPE "payments"."settlement_kind" AS ENUM ('delivery', 'cancellation_penalty');

-- AlterTable
ALTER TABLE "payments"."settlements" ADD COLUMN "kind" "payments"."settlement_kind" NOT NULL DEFAULT 'delivery';
