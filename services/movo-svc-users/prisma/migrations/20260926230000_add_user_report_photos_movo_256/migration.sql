-- MOVO-256: fotos de evidencia de un reporte de usuario. Cada foto pertenece al envío
-- en el que se mandó (`entry_id` null = el reporte original).

-- Una entrada puede ser solo fotos, sin texto.
ALTER TABLE "users"."user_report_entries" ALTER COLUMN "details" DROP NOT NULL;

-- CreateTable
CREATE TABLE "users"."user_report_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "report_id" UUID NOT NULL,
    "entry_id" UUID,
    "s3_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_report_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_report_photos_s3_key_key" ON "users"."user_report_photos"("s3_key");

-- CreateIndex
CREATE INDEX "user_report_photos_report_id_created_at_idx" ON "users"."user_report_photos"("report_id", "created_at");

-- CreateIndex
CREATE INDEX "user_report_photos_entry_id_idx" ON "users"."user_report_photos"("entry_id");

-- AddForeignKey
ALTER TABLE "users"."user_report_photos" ADD CONSTRAINT "user_report_photos_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "users"."user_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users"."user_report_photos" ADD CONSTRAINT "user_report_photos_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "users"."user_report_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
