-- MOVO-302 (historial de pagos y cobros, MOVO-28): quién pagó y con qué tarjeta.
--
-- Aditiva y nullable: los holds anteriores (solo sandbox) quedan con `payer_id` en null y no
-- aparecen en el historial del emisor; no hay backfill. `card_last4`/`card_brand` salen de la
-- respuesta de Mercado Pago y quedan en null si MP no los informa.

-- AlterTable
ALTER TABLE "payments"."holds"
  ADD COLUMN "payer_id" UUID,
  ADD COLUMN "card_last4" VARCHAR(4),
  ADD COLUMN "card_brand" VARCHAR(32);

-- CreateIndex: listados del historial por rol, más reciente primero.
CREATE INDEX "holds_payer_id_created_at_idx" ON "payments"."holds"("payer_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "holds_carrier_id_created_at_idx" ON "payments"."holds"("carrier_id", "created_at" DESC, "id" DESC);
