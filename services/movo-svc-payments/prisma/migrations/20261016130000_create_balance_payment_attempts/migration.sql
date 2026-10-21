-- MOVO-312: intentos de "Pagar mi saldo" (Checkout API: tarjeta guardada + CVV, pago directo a la cuenta cobradora de
-- Movo). Una fila por intento; su `id` es el `external_reference` del pago de MP.

CREATE TYPE "payments"."balance_attempt_status" AS ENUM ('creating', 'pending', 'approved', 'rejected', 'failed');

CREATE TABLE "payments"."balance_payment_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "amount_ars" DECIMAL(12,2) NOT NULL,
    "status" "payments"."balance_attempt_status" NOT NULL DEFAULT 'creating',
    "saved_card_id" UUID,
    "request_fingerprint" TEXT NOT NULL,
    "mp_payment_id" TEXT,
    "status_detail" TEXT,
    "failure_reason" "payments"."hold_failure_reason",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_payment_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "balance_payment_attempts_amount_positive" CHECK ("amount_ars" > 0)
);

CREATE UNIQUE INDEX "balance_payment_attempts_mp_payment_id_key" ON "payments"."balance_payment_attempts"("mp_payment_id");
CREATE INDEX "balance_payment_attempts_user_id_status_idx" ON "payments"."balance_payment_attempts"("user_id", "status");

-- Un solo intento abierto por usuario: con varios abiertos (aunque de distinto monto) la suma de lo que está en vuelo podría
-- superar la deuda y dejar saldo a favor. Parcial: un intento ya cerrado no bloquea uno nuevo.
CREATE UNIQUE INDEX "balance_payment_attempts_open_user_key"
  ON "payments"."balance_payment_attempts"("user_id")
  WHERE "status" IN ('creating', 'pending');
