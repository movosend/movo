-- MOVO-268: inbox del webhook de Mercado Pago y registro de lo que MP hace sobre un
-- pago por fuera de Movo (contracargos, reembolsos, mediaciones).

-- CreateEnum
CREATE TYPE "payments"."mp_webhook_notification_status" AS ENUM ('pending', 'processed', 'ignored', 'unverifiable', 'failed');

-- CreateEnum
CREATE TYPE "payments"."hold_provider_event_kind" AS ENUM ('cancelled', 'expired', 'rejected');

-- CreateEnum
CREATE TYPE "payments"."payment_provider_event_kind" AS ENUM ('chargeback', 'refund', 'mediation');

-- CreateTable
CREATE TABLE "payments"."mp_webhook_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mp_notification_id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "action" TEXT,
    "mp_payment_id" TEXT NOT NULL,
    "mp_user_id" TEXT,
    "live_mode" BOOLEAN,
    "status" "payments"."mp_webhook_notification_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT,
    "last_error" TEXT,
    "hold_id" UUID,
    "pending_hold_event" "payments"."hold_provider_event_kind",
    "pending_hold_event_detail" TEXT,
    "processed_at" TIMESTAMPTZ,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "mp_webhook_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments"."payment_provider_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hold_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "mp_payment_id" TEXT NOT NULL,
    "kind" "payments"."payment_provider_event_kind" NOT NULL,
    "mp_status" TEXT NOT NULL,
    "mp_status_detail" TEXT,
    "amount_ars" DECIMAL(12,2),
    "hold_status" "payments"."hold_status" NOT NULL,
    "alerted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mp_webhook_notifications_mp_notification_id_key" ON "payments"."mp_webhook_notifications"("mp_notification_id");

-- CreateIndex
CREATE INDEX "mp_webhook_notifications_status_next_attempt_at_idx" ON "payments"."mp_webhook_notifications"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "payment_provider_events_shipment_id_idx" ON "payments"."payment_provider_events"("shipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_provider_events_mp_payment_id_mp_status_key" ON "payments"."payment_provider_events"("mp_payment_id", "mp_status");
