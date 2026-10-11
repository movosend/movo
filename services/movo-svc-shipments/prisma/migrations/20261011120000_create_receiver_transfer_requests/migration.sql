-- MOVO-275 (ADR-038): transferencia de receptor. Tabla nueva, no toca datos existentes.
-- Reversión:
--   DROP TABLE "shipments"."receiver_transfer_requests";
--   DROP TYPE "shipments"."receiver_transfer_status_enum";

-- CreateEnum
CREATE TYPE "shipments"."receiver_transfer_status_enum" AS ENUM (
  'pending_new_receiver',
  'completed',
  'rejected_by_new_receiver',
  'expired',
  'cancelled'
);

-- CreateTable
CREATE TABLE "shipments"."receiver_transfer_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "new_receiver_id" UUID NOT NULL,
    "requester_name" TEXT,
    "new_receiver_name" TEXT,
    "reason" TEXT,
    "response_reason" TEXT,
    "status" "shipments"."receiver_transfer_status_enum" NOT NULL DEFAULT 'pending_new_receiver',
    "cancel_reason" VARCHAR(32),
    "new_receiver_deadline" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,
    "resolved_by" UUID,

    CONSTRAINT "receiver_transfer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "receiver_transfer_requests_shipment_id_created_at_idx" ON "shipments"."receiver_transfer_requests"("shipment_id", "created_at");
CREATE INDEX "receiver_transfer_requests_requested_by_status_idx" ON "shipments"."receiver_transfer_requests"("requested_by", "status");
CREATE INDEX "receiver_transfer_requests_new_receiver_id_status_idx" ON "shipments"."receiver_transfer_requests"("new_receiver_id", "status");
CREATE INDEX "receiver_transfer_requests_status_deadline_idx" ON "shipments"."receiver_transfer_requests"("status", "new_receiver_deadline");

-- AC5: a lo sumo una solicitud pendiente y una transferencia completada por envío.
-- La garantía vive en la base, no en el chequeo previo del servicio.
CREATE UNIQUE INDEX "receiver_transfer_requests_shipment_pending_unique"
  ON "shipments"."receiver_transfer_requests" ("shipment_id")
  WHERE "status" = 'pending_new_receiver';
CREATE UNIQUE INDEX "receiver_transfer_requests_shipment_completed_unique"
  ON "shipments"."receiver_transfer_requests" ("shipment_id")
  WHERE "status" = 'completed';

-- AddForeignKey
ALTER TABLE "shipments"."receiver_transfer_requests" ADD CONSTRAINT "receiver_transfer_requests_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"."shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
