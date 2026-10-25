-- MOVO-336 (review de PR #314): fecha explícita en que un reembolso llegó a un estado final. `updated_at` cambia
-- con cualquier UPDATE posterior de la fila y no sirve de fecha del movimiento en el historial.
ALTER TABLE "payments"."refunds" ADD COLUMN "completed_at" TIMESTAMPTZ;

UPDATE "payments"."refunds" SET "completed_at" = "updated_at"
WHERE "status" IN ('succeeded', 'failed', 'fallback_to_ledger');
