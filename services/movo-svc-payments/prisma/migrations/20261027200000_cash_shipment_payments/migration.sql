-- MOVO-37: envíos pagados en efectivo.
-- 1) Crédito al transportista cuando el emisor cancela tarde un envío en efectivo (su penalidad queda como deuda).
ALTER TYPE "payments"."ledger_entry_type" ADD VALUE 'cancellation_compensation';

-- 2) El cobro en efectivo de un envío entregado, junto con su comisión de la cuenta corriente: es la fila del historial.
CREATE TABLE "payments"."cash_shipment_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "carrier_id" UUID NOT NULL,
    "amount_ars" DECIMAL(12,2) NOT NULL,
    "commission_ars" DECIMAL(12,2) NOT NULL,
    "ledger_entry_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_shipment_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_shipment_payments_amount_positive" CHECK ("amount_ars" > 0),
    CONSTRAINT "cash_shipment_payments_commission_range" CHECK ("commission_ars" >= 0 AND "commission_ars" < "amount_ars")
);

CREATE UNIQUE INDEX "cash_shipment_payments_shipment_id_key" ON "payments"."cash_shipment_payments"("shipment_id");
CREATE INDEX "cash_shipment_payments_sender_id_created_at_idx" ON "payments"."cash_shipment_payments"("sender_id", "created_at" DESC, "id" DESC);
CREATE INDEX "cash_shipment_payments_carrier_id_created_at_idx" ON "payments"."cash_shipment_payments"("carrier_id", "created_at" DESC, "id" DESC);

ALTER TABLE "payments"."cash_shipment_payments" ADD CONSTRAINT "cash_shipment_payments_ledger_entry_id_fkey"
    FOREIGN KEY ("ledger_entry_id") REFERENCES "payments"."user_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
