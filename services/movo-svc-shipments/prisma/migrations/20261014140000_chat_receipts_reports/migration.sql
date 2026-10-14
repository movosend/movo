-- MOVO-26: nombre del autor en cada mensaje, estado de entrega/lectura por integrante y reportes de conversación.
-- Reversión:
--   DROP TABLE "shipments"."chat_reports";
--   DROP TABLE "shipments"."chat_participant_states";
--   ALTER TABLE "shipments"."chat_messages" DROP COLUMN "author_name";

-- AlterTable
ALTER TABLE "shipments"."chat_messages" ADD COLUMN "author_name" TEXT;

-- CreateTable
CREATE TABLE "shipments"."chat_participant_states" (
    "shipment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_delivered_at" TIMESTAMPTZ,
    "last_read_at" TIMESTAMPTZ,

    CONSTRAINT "chat_participant_states_pkey" PRIMARY KEY ("shipment_id","user_id")
);

-- CreateTable
CREATE TABLE "shipments"."chat_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_reports_shipment_reporter_key" ON "shipments"."chat_reports"("shipment_id", "reporter_id");

-- AddForeignKey
ALTER TABLE "shipments"."chat_participant_states" ADD CONSTRAINT "chat_participant_states_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"."shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipments"."chat_reports" ADD CONSTRAINT "chat_reports_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"."shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
