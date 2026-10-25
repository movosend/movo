-- MOVO-26 (ADR-023): mensajes del chat de un envío. Tabla nueva, no toca datos existentes.
-- Reversión:
--   DROP TABLE "shipments"."chat_messages";

-- CreateTable
CREATE TABLE "shipments"."chat_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "client_message_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_shipment_author_client_key" ON "shipments"."chat_messages"("shipment_id", "author_id", "client_message_id");
CREATE INDEX "chat_messages_shipment_id_created_at_idx" ON "shipments"."chat_messages"("shipment_id", "created_at", "id");

-- AddForeignKey
ALTER TABLE "shipments"."chat_messages" ADD CONSTRAINT "chat_messages_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"."shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
