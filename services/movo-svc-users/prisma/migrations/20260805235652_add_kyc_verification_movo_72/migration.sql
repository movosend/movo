-- CreateEnum
CREATE TYPE "users"."verification_type_enum" AS ENUM ('identity', 'license');

-- AlterEnum
ALTER TYPE "users"."kyc_status_enum" ADD VALUE 'manual_review';

-- CreateTable
CREATE TABLE "users"."kyc_verification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "verification_type" "users"."verification_type_enum" NOT NULL,
    "provider" TEXT NOT NULL,
    "external_session_id" TEXT NOT NULL,
    "status" "users"."kyc_status_enum" NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,
    "raw_decision" JSONB,

    CONSTRAINT "kyc_verification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kyc_verification_external_session_id_key" ON "users"."kyc_verification"("external_session_id");

-- CreateIndex
CREATE INDEX "kyc_verification_user_id_idx" ON "users"."kyc_verification"("user_id");

-- AddForeignKey
ALTER TABLE "users"."kyc_verification" ADD CONSTRAINT "kyc_verification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
