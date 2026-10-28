-- MOVO-337 (DD-056): resolución de disputas. `resolving` es el estado intermedio consultable cuando la acción de pago
-- falla (AC7): el resultado ya está guardado y se reintenta.

-- AlterEnum
ALTER TYPE "shipments"."dispute_status_enum" ADD VALUE 'resolving';

-- CreateEnum
CREATE TYPE "shipments"."dispute_outcome_enum" AS ENUM ('sender', 'carrier', 'partial');

-- AlterTable
ALTER TABLE "shipments"."disputes"
    ADD COLUMN "outcome" "shipments"."dispute_outcome_enum",
    ADD COLUMN "resolution_percentage" SMALLINT,
    ADD COLUMN "carrier_amount_ars" DECIMAL(12,2),
    ADD COLUMN "sender_amount_ars" DECIMAL(12,2),
    ADD COLUMN "payment_action" TEXT,
    ADD COLUMN "reasoning" TEXT,
    ADD COLUMN "resolved_by" UUID,
    ADD COLUMN "resolved_at" TIMESTAMPTZ;
