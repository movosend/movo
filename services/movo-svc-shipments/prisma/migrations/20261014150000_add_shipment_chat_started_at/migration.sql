-- MOVO-26: instante en que empezó la última asignación del envío. El chat solo muestra los mensajes desde acá,
-- así un transportista nuevo (tras un pago vencido y una reasignación) no lee la conversación del anterior.
-- NULL = sin corte (envíos anteriores a este cambio y los que nunca se asignaron por oferta).
-- Reversión:
--   ALTER TABLE "shipments"."shipments" DROP COLUMN "chat_started_at";

-- AlterTable
ALTER TABLE "shipments"."shipments" ADD COLUMN "chat_started_at" TIMESTAMPTZ;
