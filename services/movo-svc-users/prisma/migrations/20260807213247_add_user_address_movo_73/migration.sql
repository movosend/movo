-- CreateTable
CREATE TABLE "users"."address" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "label" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "street" TEXT NOT NULL,
    "street_number" TEXT NOT NULL,
    "floor_apartment" TEXT,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "lat" DECIMAL NOT NULL,
    "long" DECIMAL NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "address_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "address_user_id_idx" ON "users"."address"("user_id");

-- AddForeignKey
ALTER TABLE "users"."address" ADD CONSTRAINT "address_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
