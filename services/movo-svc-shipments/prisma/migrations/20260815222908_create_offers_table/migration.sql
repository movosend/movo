-- MOVO-102: schema y máquina de estados de la oferta (Offer).
--
-- Generado con `prisma migrate diff --from-schema <schema.prisma previo> --to-schema
-- prisma/schema.prisma --script` (nunca `prisma migrate dev` contra el Postgres
-- compartido de dev/CI — ver nota de MOVO-104 en CLAUDE.md: `_prisma_migrations` vive en
-- `public` y es compartida entre todos los servicios Prisma de la misma instancia).
--
-- El único bloque agregado a mano después del diff es el índice único parcial del final
-- (AC7) — Prisma no representa índices parciales en su DSL, mismo tipo de gap que el
-- trigger de `updated_at` de `shipments.shipments` (MOVO-104).

-- CreateEnum
CREATE TYPE "shipments"."offer_status_enum" AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn', 'expired', 'superseded');

-- CreateTable
CREATE TABLE "shipments"."offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "carrier_id" UUID NOT NULL,
    "price_offered" DECIMAL NOT NULL,
    "offered_date" DATE NOT NULL,
    "message" TEXT,
    "carrier_rating_at_offer" DECIMAL,
    "carrier_name_at_offer" TEXT,
    "status" "shipments"."offer_status_enum" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMPTZ,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offers_shipment_id_idx" ON "shipments"."offers"("shipment_id");

-- CreateIndex
CREATE INDEX "offers_carrier_id_idx" ON "shipments"."offers"("carrier_id");

-- CreateIndex
CREATE INDEX "offers_status_idx" ON "shipments"."offers"("status");

-- AddForeignKey
ALTER TABLE "shipments"."offers" ADD CONSTRAINT "offers_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"."shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AC7: un transportista no puede tener más de una oferta ACTIVA (pending) por el mismo
-- envío. Enforcement real vía índice único PARCIAL — no lógica de aplicación, no hay
-- ventana de carrera posible entre el chequeo y el INSERT. Un rechazo/retiro/expiración
-- previo no bloquea una oferta nueva del mismo transportista sobre el mismo envío
-- (el índice solo cubre status = 'pending').
CREATE UNIQUE INDEX "offers_shipment_carrier_pending_unique"
  ON "shipments"."offers" ("shipment_id", "carrier_id")
  WHERE "status" = 'pending';
