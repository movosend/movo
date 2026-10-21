-- MOVO-100 (ADR-039): tarjetas guardadas del emisor en un customer de la cuenta de Movo.

-- CreateTable
CREATE TABLE "payments"."payer_customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "mp_customer_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payer_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments"."saved_cards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "mp_card_id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "exp_month" INTEGER NOT NULL,
    "exp_year" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "alias" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "saved_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payer_customers_user_id_key" ON "payments"."payer_customers"("user_id");

-- CreateIndex
CREATE INDEX "saved_cards_user_id_idx" ON "payments"."saved_cards"("user_id");

-- Una misma tarjeta de MP una sola vez entre las vivas del usuario. PARCIAL (a mano,
-- Prisma no lo representa): una baja soft no impide volver a guardar la tarjeta.
CREATE UNIQUE INDEX "saved_cards_user_id_mp_card_id_live_key"
  ON "payments"."saved_cards" ("user_id", "mp_card_id")
  WHERE "deleted_at" IS NULL;

-- A lo sumo UNA tarjeta predeterminada viva por usuario, garantizado por la base.
CREATE UNIQUE INDEX "saved_cards_user_id_default_live_key"
  ON "payments"."saved_cards" ("user_id")
  WHERE "is_default" AND "deleted_at" IS NULL;

-- AlterTable: tarjeta guardada con la que se creó el hold (la escribe MOVO-282).
ALTER TABLE "payments"."holds" ADD COLUMN "saved_card_id" UUID;

-- CreateIndex
CREATE INDEX "holds_saved_card_id_idx" ON "payments"."holds"("saved_card_id");
