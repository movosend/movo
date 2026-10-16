-- MOVO-312: intentos de "Pagar mi saldo" con Checkout Pro. Una fila por preferencia; su `id` es el
-- `external_reference` que MP devuelve en el pago, y de ahí el webhook lo asocia al usuario.

CREATE TYPE "payments"."balance_attempt_status" AS ENUM ('creating', 'pending', 'approved', 'rejected', 'abandoned', 'failed');

CREATE TABLE "payments"."balance_payment_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "amount_ars" DECIMAL(12,2) NOT NULL,
    "status" "payments"."balance_attempt_status" NOT NULL DEFAULT 'creating',
    "mp_preference_id" TEXT,
    "checkout_url" TEXT,
    "mp_payment_id" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_payment_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "balance_payment_attempts_amount_positive" CHECK ("amount_ars" > 0)
);

CREATE UNIQUE INDEX "balance_payment_attempts_mp_payment_id_key" ON "payments"."balance_payment_attempts"("mp_payment_id");
CREATE INDEX "balance_payment_attempts_user_id_status_idx" ON "payments"."balance_payment_attempts"("user_id", "status");

-- Idempotencia del alta: dos pedidos iguales (mismo usuario y monto) mientras uno se arma o espera el pago
-- no crean dos preferencias. Parcial: un intento ya cerrado no bloquea uno nuevo por el mismo monto.
CREATE UNIQUE INDEX "balance_payment_attempts_open_user_amount_key"
  ON "payments"."balance_payment_attempts"("user_id", "amount_ars")
  WHERE "status" IN ('creating', 'pending');
