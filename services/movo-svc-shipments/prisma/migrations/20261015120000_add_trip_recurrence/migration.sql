-- MOVO-265 (DD-042): viajes recurrentes como atributo del trip.
-- `recurrence_weekdays`: 0 = domingo … 6 = sábado. Prisma no admite listas opcionales, así que
-- "no se repite" es el array vacío (default); la API lo expone como null.

-- AlterTable
ALTER TABLE "shipments"."trips" ADD COLUMN     "generated_from_trip_id" UUID,
ADD COLUMN     "recurrence_until" DATE,
ADD COLUMN     "recurrence_weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "series_id" UUID;

-- Valores válidos de día de la semana (no representable en el DSL de Prisma).
ALTER TABLE "shipments"."trips" ADD CONSTRAINT "trips_recurrence_weekdays_range_check"
  CHECK ("recurrence_weekdays" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[]);

-- CreateIndex
-- Cada trip tiene a lo sumo un sucesor: es lo que hace idempotente la generación del barrido.
CREATE UNIQUE INDEX "trips_generated_from_trip_id_key" ON "shipments"."trips"("generated_from_trip_id");

-- CreateIndex
CREATE INDEX "trips_series_id_idx" ON "shipments"."trips"("series_id");

-- AddForeignKey
ALTER TABLE "shipments"."trips" ADD CONSTRAINT "trips_generated_from_trip_id_fkey" FOREIGN KEY ("generated_from_trip_id") REFERENCES "shipments"."trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;
