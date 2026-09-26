-- MOVO-175 (review de PR #193): entradas adicionales de un reporte pendiente. El
-- reportante no edita su reporte original: suma información como filas nuevas.

-- CreateTable
CREATE TABLE "users"."user_report_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "report_id" UUID NOT NULL,
    "details" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_report_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_report_entries_report_id_created_at_idx" ON "users"."user_report_entries"("report_id", "created_at");

-- AddForeignKey
ALTER TABLE "users"."user_report_entries" ADD CONSTRAINT "user_report_entries_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "users"."user_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
