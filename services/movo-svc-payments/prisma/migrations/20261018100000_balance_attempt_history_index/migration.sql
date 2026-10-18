-- MOVO-303: el historial del emisor suma sus pagos de saldo aprobados (MOVO-312), más recientes primero.
CREATE INDEX "balance_payment_attempts_user_id_created_at_idx" ON "payments"."balance_payment_attempts"("user_id", "created_at" DESC, "id" DESC);
