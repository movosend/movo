-- MOVO-251: asociar posiciones GPS de carrier_positions al viaje (Trip) y no solo al envío (Shipment).
-- Permite indexar y controlar la cadencia/ingesta a nivel de viaje (VRPTW, múltiples envíos en el mismo viaje).

-- AlterTable: agregar trip_id
ALTER TABLE "shipments"."carrier_positions" ADD COLUMN "trip_id" UUID;

-- Backfill de datos existentes: asociar con la oferta aceptada vigente del envío
UPDATE "shipments"."carrier_positions" cp
SET "trip_id" = o."trip_id"
FROM "shipments"."offers" o
WHERE cp."shipment_id" = o."shipment_id"
  AND o."status" = 'accepted'
  AND o."trip_id" IS NOT NULL;

-- Para cualquier posición huérfana de pruebas en desarrollo sin viaje asociado, se purgan
DELETE FROM "shipments"."carrier_positions" WHERE "trip_id" IS NULL;

-- Hacer trip_id NOT NULL
ALTER TABLE "shipments"."carrier_positions" ALTER COLUMN "trip_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "carrier_positions_trip_id_recorded_at_idx" ON "shipments"."carrier_positions"("trip_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "shipments"."carrier_positions" ADD CONSTRAINT "carrier_positions_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "shipments"."trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
