-- MOVO-26: marca los mensajes del chat a los que el filtro de lenguaje les tapó alguna palabra.
-- Reversión:
--   ALTER TABLE "shipments"."chat_messages" DROP COLUMN "moderated";

-- AlterTable
ALTER TABLE "shipments"."chat_messages" ADD COLUMN "moderated" BOOLEAN NOT NULL DEFAULT false;
