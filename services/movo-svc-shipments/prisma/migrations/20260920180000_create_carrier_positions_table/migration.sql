-- MOVO-202: traza de posiciones GPS del transportista durante un envío in_transit.
-- Append-only (AC9, solo la purga periódica borra), evidencia para disputas (MOVO-30),
-- retención acotada por ADR-023 -- ver services/movo-svc-shipments/CLAUDE.md.

-- CreateTable
CREATE TABLE "shipments"."carrier_positions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "accuracy_m" DECIMAL(8,2) NOT NULL,
    "captured_at" TIMESTAMPTZ NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carrier_positions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (AC8: "todas las posiciones de este envío en orden")
CREATE INDEX "carrier_positions_shipment_id_recorded_at_idx" ON "shipments"."carrier_positions"("shipment_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "shipments"."carrier_positions" ADD CONSTRAINT "carrier_positions_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"."shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
