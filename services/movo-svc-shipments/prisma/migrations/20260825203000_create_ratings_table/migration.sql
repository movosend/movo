-- MOVO-146: schema de Rating (calificación post-entrega). Generado con
-- `prisma migrate diff --from-schema <schema.prisma previo> --to-schema prisma/schema.prisma
-- --script` (nunca `prisma migrate dev` contra el Postgres compartido de dev/CI — ver nota
-- de MOVO-104 en CLAUDE.md). Sin bloques agregados a mano: la unicidad (AC2) y los índices
-- ya son representables en el DSL de Prisma, a diferencia del índice parcial de AC7 de
-- Offer.

-- CreateEnum
CREATE TYPE "shipments"."rating_role_enum" AS ENUM ('sender', 'carrier', 'receiver');

-- CreateTable
CREATE TABLE "shipments"."ratings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "rater_id" UUID NOT NULL,
    "ratee_id" UUID NOT NULL,
    "role" "shipments"."rating_role_enum" NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ratings_ratee_id_idx" ON "shipments"."ratings"("ratee_id");

-- CreateIndex
CREATE INDEX "ratings_shipment_id_idx" ON "shipments"."ratings"("shipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_shipment_rater_ratee_key" ON "shipments"."ratings"("shipment_id", "rater_id", "ratee_id");

-- AddForeignKey
ALTER TABLE "shipments"."ratings" ADD CONSTRAINT "ratings_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"."shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

