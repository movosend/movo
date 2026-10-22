-- MOVO-320 (ADR-051): conversaciones de soporte al usuario. Tablas, tipos y secuencia nuevos; no tocan datos existentes.
-- Reversión:
--   DROP TABLE "shipments"."support_participant_states";
--   DROP TABLE "shipments"."support_messages";
--   DROP TABLE "shipments"."support_conversations";
--   DROP SEQUENCE "shipments"."support_conversation_code_seq";
--   DROP TYPE "shipments"."support_message_kind_enum";
--   DROP TYPE "shipments"."support_priority_enum";
--   DROP TYPE "shipments"."support_status_enum";
--   DROP TYPE "shipments"."support_topic_enum";

-- CreateEnum
CREATE TYPE "shipments"."support_topic_enum" AS ENUM ('shipment', 'payments', 'account', 'carrier', 'security');
CREATE TYPE "shipments"."support_status_enum" AS ENUM ('open', 'awaiting_user', 'resolved');
CREATE TYPE "shipments"."support_priority_enum" AS ENUM ('urgent', 'high', 'normal', 'low');
CREATE TYPE "shipments"."support_message_kind_enum" AS ENUM ('user', 'agent', 'note', 'system');

-- Número del código de display `SOP-NNNN` (mínimo 4 dígitos, ver SUPPORT_CODE_RE).
CREATE SEQUENCE "shipments"."support_conversation_code_seq" START WITH 1001;

-- CreateTable
CREATE TABLE "shipments"."support_conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code_number" INTEGER NOT NULL DEFAULT nextval('shipments.support_conversation_code_seq'),
    "user_id" UUID NOT NULL,
    "topic" "shipments"."support_topic_enum" NOT NULL,
    "status" "shipments"."support_status_enum" NOT NULL DEFAULT 'open',
    "priority" "shipments"."support_priority_enum" NOT NULL DEFAULT 'normal',
    "assigned_to" UUID,
    "shipment_id" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_user_message_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_agent_read_at" TIMESTAMPTZ,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "support_conversations_pkey" PRIMARY KEY ("id")
);

ALTER SEQUENCE "shipments"."support_conversation_code_seq" OWNED BY "shipments"."support_conversations"."code_number";

CREATE TABLE "shipments"."support_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "kind" "shipments"."support_message_kind_enum" NOT NULL,
    "author_id" UUID,
    "author_name" TEXT,
    "body" TEXT NOT NULL,
    "client_message_id" UUID,
    "moderated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shipments"."support_participant_states" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_delivered_at" TIMESTAMPTZ,
    "last_read_at" TIMESTAMPTZ,

    CONSTRAINT "support_participant_states_pkey" PRIMARY KEY ("conversation_id", "user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_conversations_code_number_key" ON "shipments"."support_conversations"("code_number");
CREATE INDEX "support_conversations_user_last_message_idx" ON "shipments"."support_conversations"("user_id", "last_message_at" DESC, "id");
CREATE INDEX "support_conversations_status_last_message_idx" ON "shipments"."support_conversations"("status", "last_message_at");
CREATE UNIQUE INDEX "support_messages_conversation_client_key" ON "shipments"."support_messages"("conversation_id", "client_message_id");
CREATE INDEX "support_messages_conversation_created_at_idx" ON "shipments"."support_messages"("conversation_id", "created_at", "id");

-- Idempotencia de `POST /support/conversations`: se reintenta con el mismo clientMessageId cuando todavía no hay
-- conversación a la que atar el índice anterior. Parcial (Prisma no lo expresa), solo para mensajes del usuario.
CREATE UNIQUE INDEX "support_messages_user_author_client_key" ON "shipments"."support_messages"("author_id", "client_message_id") WHERE "kind" = 'user' AND "client_message_id" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "shipments"."support_conversations" ADD CONSTRAINT "support_conversations_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"."shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shipments"."support_messages" ADD CONSTRAINT "support_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "shipments"."support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipments"."support_participant_states" ADD CONSTRAINT "support_participant_states_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "shipments"."support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
