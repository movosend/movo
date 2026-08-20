-- MOVO-130 AC1: deadline de confirmación del receptor.
-- Nullable para que envíos preexistentes queden en NULL y no expiren.

-- AlterTable
ALTER TABLE "shipments"."shipments" ADD COLUMN "receiver_confirmation_deadline" TIMESTAMPTZ;
