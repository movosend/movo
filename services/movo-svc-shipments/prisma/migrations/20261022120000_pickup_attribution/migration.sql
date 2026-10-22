-- MOVO-270 (ADR-052): tracking antes del retiro y atribución del no-retiro.

-- Atribución que guarda el barrido de retiro no realizado en el evento de cancelación.
CREATE TYPE "shipments"."pickup_missed_attribution_enum" AS ENUM ('carrier', 'none');
ALTER TABLE "shipments"."shipment_events" ADD COLUMN "attribution" "shipments"."pickup_missed_attribution_enum";

-- Cuándo pasó el viaje a `active`. Sin backfill: un viaje iniciado antes queda NULL, que la
-- atribución lee como "sin evidencia" (nunca como "no inició").
ALTER TABLE "shipments"."trips" ADD COLUMN "started_at" TIMESTAMPTZ;

-- Flag `mocked` de expo-location (solo Android).
ALTER TABLE "shipments"."carrier_positions" ADD COLUMN "mocked" BOOLEAN;

-- Evidencia GPS pasiva del retiro, una fila por envío (sin traza).
CREATE TABLE "shipments"."pickup_evidence" (
    "shipment_id" UUID NOT NULL,
    "carrier_id" UUID NOT NULL,
    "arrived_at" TIMESTAMPTZ,
    "arrived_lat" DECIMAL(9,6),
    "arrived_lng" DECIMAL(9,6),
    "arrived_accuracy_m" DECIMAL(8,2),
    "far_positions_in_window" INTEGER NOT NULL DEFAULT 0,
    "gray_positions_in_window" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pickup_evidence_pkey" PRIMARY KEY ("shipment_id")
);

ALTER TABLE "shipments"."pickup_evidence" ADD CONSTRAINT "pickup_evidence_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"."shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
