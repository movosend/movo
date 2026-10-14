-- MOVO-212: liquidación (captura del hold + split) de los envíos.

-- CreateEnum
CREATE TYPE "payments"."settlement_status" AS ENUM ('processing', 'credited', 'failed', 'escalated');

-- CreateTable
CREATE TABLE "payments"."settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "hold_id" UUID NOT NULL,
    "carrier_id" UUID NOT NULL,
    "mp_payment_id" TEXT NOT NULL,
    "gross_amount_ars" DECIMAL(12,2) NOT NULL,
    "mp_fee_ars" DECIMAL(12,2),
    "commission_ars" DECIMAL(12,2) NOT NULL,
    "net_amount_ars" DECIMAL(12,2),
    "status" "payments"."settlement_status" NOT NULL,
    "failure_reason" TEXT,
    "status_detail" TEXT,
    "captured_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- Una liquidación por envío y por hold: la base impide cobrar dos veces el mismo envío
-- aunque dos requests de captura lleguen a la vez.
CREATE UNIQUE INDEX "settlements_shipment_id_key" ON "payments"."settlements"("shipment_id");
CREATE UNIQUE INDEX "settlements_hold_id_key" ON "payments"."settlements"("hold_id");

-- AddForeignKey
ALTER TABLE "payments"."settlements" ADD CONSTRAINT "settlements_hold_id_fkey"
  FOREIGN KEY ("hold_id") REFERENCES "payments"."holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
