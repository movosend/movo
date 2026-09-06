-- MOVO-158: log append-only de handshakes de custodia confirmados. Reemplaza el
-- placeholder shipments.custody_transfer_event del DER original (docs/movo_der.dbml)
-- con las columnas que este ticket realmente persiste (AC3).

-- CreateEnum
CREATE TYPE "shipments"."handshake_stage_enum" AS ENUM ('pickup', 'delivery');

-- CreateTable
CREATE TABLE "shipments"."handshake_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "stage" "shipments"."handshake_stage_enum" NOT NULL,
    "actor_id" UUID NOT NULL,
    "counterparty_id" UUID NOT NULL,
    "nonce_hash" TEXT NOT NULL,
    "counterparty_lat" DECIMAL(9,6) NOT NULL,
    "counterparty_lng" DECIMAL(9,6) NOT NULL,
    "actor_lat" DECIMAL(9,6) NOT NULL,
    "actor_lng" DECIMAL(9,6) NOT NULL,
    "distance_m" DECIMAL(8,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handshake_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "handshake_events_shipment_id_idx" ON "shipments"."handshake_events"("shipment_id");

-- AddForeignKey
ALTER TABLE "shipments"."handshake_events" ADD CONSTRAINT "handshake_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"."shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
