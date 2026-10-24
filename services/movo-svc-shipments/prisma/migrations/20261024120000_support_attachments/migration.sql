-- MOVO-321: adjuntos de imágenes en los mensajes de soporte. Tabla, tipo y columna nuevos; no tocan datos existentes
-- (los mensajes previos quedan con `attachment_count = 0`).
-- Reversión:
--   DROP TABLE "shipments"."support_attachments";
--   DROP TYPE "shipments"."support_attachment_uploader_enum";
--   ALTER TABLE "shipments"."support_messages" DROP COLUMN "attachment_count";

-- CreateEnum
CREATE TYPE "shipments"."support_attachment_uploader_enum" AS ENUM ('user', 'staff');

-- AlterTable
ALTER TABLE "shipments"."support_messages" ADD COLUMN "attachment_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "shipments"."support_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "uploader_id" UUID NOT NULL,
    "uploader_kind" "shipments"."support_attachment_uploader_enum" NOT NULL,
    "conversation_id" UUID,
    "message_id" UUID,
    "position" INTEGER,
    "s3_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleting_at" TIMESTAMPTZ,

    CONSTRAINT "support_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_attachments_s3_key_key" ON "shipments"."support_attachments"("s3_key");
CREATE INDEX "support_attachments_message_idx" ON "shipments"."support_attachments"("message_id", "position");
CREATE INDEX "support_attachments_conversation_idx" ON "shipments"."support_attachments"("conversation_id");
CREATE INDEX "support_attachments_uploader_idx" ON "shipments"."support_attachments"("uploader_id");
-- Candidatos del sweep de huérfanos: solo los que nunca se asociaron a un mensaje.
CREATE INDEX "support_attachments_orphan_idx" ON "shipments"."support_attachments"("created_at") WHERE "message_id" IS NULL;

-- AddForeignKey
ALTER TABLE "shipments"."support_attachments" ADD CONSTRAINT "support_attachments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "shipments"."support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipments"."support_attachments" ADD CONSTRAINT "support_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "shipments"."support_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
