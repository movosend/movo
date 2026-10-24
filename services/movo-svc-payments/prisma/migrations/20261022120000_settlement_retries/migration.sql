-- MOVO-213: reintentos de la captura y escalado a proceso manual. La liquidación guarda cuántos
-- intentos hizo, cuándo toca el próximo, el último error y, si escaló, cuándo y por qué. Las filas
-- existentes quedan con 0 intentos y sin próximo intento (las `failed` previas las sigue levantando
-- el barrido de svc-shipments con la captura en línea, que les pone fecha de reintento).

-- AlterTable
ALTER TABLE "payments"."settlements"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "next_attempt_at" TIMESTAMPTZ,
  ADD COLUMN "last_error" TEXT,
  ADD COLUMN "escalated_at" TIMESTAMPTZ,
  ADD COLUMN "escalation_reason" TEXT;

-- CreateIndex
CREATE INDEX "settlements_status_next_attempt_idx" ON "payments"."settlements"("status", "next_attempt_at");
