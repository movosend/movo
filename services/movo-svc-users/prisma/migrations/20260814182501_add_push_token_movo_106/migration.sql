-- CreateEnum
CREATE TYPE "users"."push_platform_enum" AS ENUM ('ios', 'android');

-- CreateTable
CREATE TABLE "users"."push_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "expo_push_token" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "platform" "users"."push_platform_enum" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "push_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_token_user_id_device_id_key" ON "users"."push_token"("user_id", "device_id");

-- AddForeignKey
ALTER TABLE "users"."push_token" ADD CONSTRAINT "push_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
