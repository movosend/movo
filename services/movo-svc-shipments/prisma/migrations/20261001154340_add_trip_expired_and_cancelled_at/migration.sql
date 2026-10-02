-- AlterEnum
ALTER TYPE "shipments"."trip_status_enum" ADD VALUE 'expired';

-- AlterTable
ALTER TABLE "shipments"."trips" ADD COLUMN     "cancelled_at" TIMESTAMPTZ;

