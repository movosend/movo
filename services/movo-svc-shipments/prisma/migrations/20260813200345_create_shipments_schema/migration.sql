-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "shipments";

-- CreateEnum
CREATE TYPE "shipments"."package_type_enum" AS ENUM ('letter_document', 'standard_package', 'everyday_item', 'fragile_item', 'urgent_item');

-- CreateEnum
CREATE TYPE "shipments"."shipment_status_enum" AS ENUM ('awaiting_receiver_confirmation', 'rejected_by_receiver', 'published', 'assignment_pending', 'assigned', 'in_transit', 'delivered', 'cancelled', 'disputed');

-- CreateEnum
CREATE TYPE "shipments"."photo_stage_enum" AS ENUM ('creation', 'pickup', 'delivery');

-- CreateTable
CREATE TABLE "shipments"."shipments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sender_id" UUID NOT NULL,
    "receiver_id" UUID NOT NULL,
    "carrier_id" UUID,
    "package_type" "shipments"."package_type_enum" NOT NULL,
    "weight_kg" DECIMAL NOT NULL,
    "length_cm" DECIMAL NOT NULL,
    "width_cm" DECIMAL NOT NULL,
    "height_cm" DECIMAL NOT NULL,
    "description" TEXT,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "pickup_address" TEXT NOT NULL,
    "pickup_lat" DECIMAL(9,6) NOT NULL,
    "pickup_lng" DECIMAL(9,6) NOT NULL,
    "delivery_address" TEXT NOT NULL,
    "delivery_lat" DECIMAL(9,6) NOT NULL,
    "delivery_lng" DECIMAL(9,6) NOT NULL,
    "pickup_date" DATE NOT NULL,
    "pickup_time_window_start" TIME NOT NULL,
    "pickup_time_window_end" TIME NOT NULL,
    "suggested_price_ars" DECIMAL NOT NULL,
    "agreed_price_ars" DECIMAL,
    "payment_method" TEXT,
    "status" "shipments"."shipment_status_enum" NOT NULL DEFAULT 'awaiting_receiver_confirmation',
    "last_status_changed_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments"."shipment_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "from_status" "shipments"."shipment_status_enum",
    "to_status" "shipments"."shipment_status_enum" NOT NULL,
    "actor_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments"."shipment_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "stage" "shipments"."photo_stage_enum" NOT NULL,
    "s3_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipments_sender_id_idx" ON "shipments"."shipments"("sender_id");

-- CreateIndex
CREATE INDEX "shipments_receiver_id_idx" ON "shipments"."shipments"("receiver_id");

-- CreateIndex
CREATE INDEX "shipments_carrier_id_idx" ON "shipments"."shipments"("carrier_id");

-- CreateIndex
CREATE INDEX "shipments_status_idx" ON "shipments"."shipments"("status");

-- CreateIndex
CREATE INDEX "shipments_pickup_date_idx" ON "shipments"."shipments"("pickup_date");

-- CreateIndex
CREATE INDEX "shipment_events_shipment_id_idx" ON "shipments"."shipment_events"("shipment_id");

-- CreateIndex
CREATE INDEX "shipment_photos_shipment_id_idx" ON "shipments"."shipment_photos"("shipment_id");

-- AddForeignKey
ALTER TABLE "shipments"."shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"."shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments"."shipment_photos" ADD CONSTRAINT "shipment_photos_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"."shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- updated_at trigger (mismo patrón que users.update_updated_at_column, MOVO-66/85):
-- mantenido por Postgres, no por código de aplicación.
CREATE OR REPLACE FUNCTION shipments.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_shipments_updated_at ON shipments.shipments;
CREATE TRIGGER update_shipments_updated_at
  BEFORE UPDATE ON shipments.shipments
  FOR EACH ROW
  EXECUTE FUNCTION shipments.update_updated_at_column();
