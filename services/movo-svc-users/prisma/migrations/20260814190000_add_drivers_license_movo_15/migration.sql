-- CreateEnum
CREATE TYPE "users"."drivers_license_status_enum" AS ENUM ('pending', 'verified', 'expired');

-- CreateTable
CREATE TABLE "users"."drivers_license" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kyc_verification_id" UUID NOT NULL,
    "expiration_date" DATE,
    "status" "users"."drivers_license_status_enum" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drivers_license_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "drivers_license_user_id_key" ON "users"."drivers_license"("user_id");

-- AddForeignKey
ALTER TABLE "users"."drivers_license" ADD CONSTRAINT "drivers_license_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users"."drivers_license" ADD CONSTRAINT "drivers_license_kyc_verification_id_fkey" FOREIGN KEY ("kyc_verification_id") REFERENCES "users"."kyc_verification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
