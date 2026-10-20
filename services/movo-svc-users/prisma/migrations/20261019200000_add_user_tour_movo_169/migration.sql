-- CreateEnum
CREATE TYPE "users"."tour_outcome_enum" AS ENUM ('completed', 'skipped');

-- CreateTable
CREATE TABLE "users"."user_tour" (
    "user_id" UUID NOT NULL,
    "tour_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "outcome" "users"."tour_outcome_enum" NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tour_pkey" PRIMARY KEY ("user_id","tour_id")
);

-- AddForeignKey
ALTER TABLE "users"."user_tour" ADD CONSTRAINT "user_tour_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
