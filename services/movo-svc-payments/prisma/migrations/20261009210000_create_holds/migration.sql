-- MOVO-209: holds (Auth & Capture) de los envíos.

-- CreateEnum
CREATE TYPE "payments"."hold_status" AS ENUM ('creating', 'in_process', 'authorized', 'captured', 'cancelled', 'rejected');

-- CreateEnum
CREATE TYPE "payments"."hold_failure_reason" AS ENUM ('insufficient_funds', 'card_rejected', 'invalid_data', 'platform_error');

-- CreateTable
CREATE TABLE "payments"."holds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "carrier_id" UUID NOT NULL,
    "collector_id" TEXT NOT NULL,
    "mp_payment_id" TEXT,
    "amount_ars" DECIMAL(12,2) NOT NULL,
    "application_fee_ars" DECIMAL(12,2) NOT NULL,
    "status" "payments"."hold_status" NOT NULL,
    "status_detail" TEXT,
    "failure_reason" "payments"."hold_failure_reason",
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "holds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "holds_shipment_id_attempt_key" ON "payments"."holds"("shipment_id", "attempt");

-- CreateIndex
CREATE INDEX "holds_mp_payment_id_idx" ON "payments"."holds"("mp_payment_id");

-- A lo sumo UN hold vivo por envío, garantizado por la base y no solo por el código:
-- dos holds son plata del emisor retenida dos veces (riesgo más caro de MOVO-209).
-- Índice único PARCIAL, a mano porque Prisma no lo representa. Un intento `rejected` o
-- `cancelled` no cuenta, así que el emisor puede reintentar con otra tarjeta.
CREATE UNIQUE INDEX "holds_shipment_id_live_key"
  ON "payments"."holds" ("shipment_id")
  WHERE "status" IN ('creating', 'in_process', 'authorized', 'captured');
