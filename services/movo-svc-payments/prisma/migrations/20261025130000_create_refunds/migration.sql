-- MOVO-336: reembolso de un pago ya capturado, una fila por intento (ver el modelo `Refund`).

-- CreateEnum
CREATE TYPE "payments"."refund_status" AS ENUM ('processing', 'succeeded', 'failed', 'fallback_to_ledger');

-- CreateTable
CREATE TABLE "payments"."refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "settlement_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "hold_id" UUID NOT NULL,
    "carrier_id" UUID NOT NULL,
    "mp_payment_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "amount_ars" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "admin_id" UUID NOT NULL,
    "mp_idempotency_key" TEXT NOT NULL,
    "status" "payments"."refund_status" NOT NULL DEFAULT 'processing',
    "failure_reason" TEXT,
    "mp_refund_id" TEXT,
    "mp_response" JSONB,
    "last_error" TEXT,
    "ledger_entry_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refunds_amount_positive" CHECK ("amount_ars" > 0),
    CONSTRAINT "refunds_attempt_positive" CHECK ("attempt" >= 1)
);

-- CreateIndex
CREATE UNIQUE INDEX "refunds_mp_idempotency_key_key" ON "payments"."refunds"("mp_idempotency_key");
CREATE UNIQUE INDEX "refunds_settlement_attempt_key" ON "payments"."refunds"("settlement_id", "attempt");
CREATE INDEX "refunds_mp_payment_id_idx" ON "payments"."refunds"("mp_payment_id");
CREATE INDEX "refunds_hold_id_idx" ON "payments"."refunds"("hold_id");

-- Una sola fila viva por `idempotencyKey` del llamador: un intento `failed` no cuenta, así el reintento con la misma
-- key abre uno nuevo, pero dos pedidos a la vez no pueden reservar el mismo reembolso dos veces. Prisma no representa
-- índices parciales (mismo caso que `disputes_shipment_open_key` en shipments).
CREATE UNIQUE INDEX "refunds_settlement_request_key_live_key"
  ON "payments"."refunds"("settlement_id", "request_key") WHERE "status" <> 'failed';

-- AddForeignKey (interna al schema `payments`)
ALTER TABLE "payments"."refunds" ADD CONSTRAINT "refunds_settlement_id_fkey"
  FOREIGN KEY ("settlement_id") REFERENCES "payments"."settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
