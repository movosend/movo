-- MOVO-161: schema de Trip (viaje declarado) y relación con Offer.

-- CreateEnum
CREATE TYPE "shipments"."trip_status_enum" AS ENUM ('active', 'cancelled', 'completed');

-- CreateTable
CREATE TABLE "shipments"."trips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "carrier_id" UUID NOT NULL,
    "origin_address" TEXT NOT NULL,
    "origin_lat" DECIMAL(9,6) NOT NULL,
    "origin_lng" DECIMAL(9,6) NOT NULL,
    "destination_address" TEXT NOT NULL,
    "destination_lat" DECIMAL(9,6) NOT NULL,
    "destination_lng" DECIMAL(9,6) NOT NULL,
    "departure_at" TIMESTAMPTZ NOT NULL,
    "vehicle_type" TEXT NOT NULL,
    "status" "shipments"."trip_status_enum" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "shipments"."offers" ADD COLUMN "trip_id" UUID;

-- CreateIndex
CREATE INDEX "trips_carrier_id_idx" ON "shipments"."trips"("carrier_id");

-- CreateIndex
CREATE INDEX "trips_status_idx" ON "shipments"."trips"("status");

-- CreateIndex
CREATE INDEX "trips_departure_at_idx" ON "shipments"."trips"("departure_at");

-- CreateIndex
CREATE INDEX "offers_trip_id_idx" ON "shipments"."offers"("trip_id");

-- AddForeignKey
ALTER TABLE "shipments"."offers" ADD CONSTRAINT "offers_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "shipments"."trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Trigger updated_at para trips
CREATE TRIGGER update_trips_updated_at
  BEFORE UPDATE ON "shipments"."trips"
  FOR EACH ROW
  EXECUTE FUNCTION "shipments"."update_updated_at_column"();
