-- MOVO-334 (ADR-054): entidad de disputa, descargos y fotos de evidencia.

-- CreateEnum
CREATE TYPE "shipments"."dispute_reason_enum" AS ENUM ('damaged', 'not_delivered', 'wrong_delivery', 'other', 'transit_anomaly', 'pickup_no_show');

-- CreateEnum
CREATE TYPE "shipments"."dispute_status_enum" AS ENUM ('open', 'resolved');

-- CreateEnum
CREATE TYPE "shipments"."dispute_party_role_enum" AS ENUM ('sender', 'receiver', 'carrier');

-- CreateEnum
CREATE TYPE "shipments"."dispute_statement_kind_enum" AS ENUM ('statement', 'amendment');

-- CreateTable
CREATE TABLE "shipments"."disputes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "opened_by" UUID,
    "opened_by_role" "shipments"."dispute_party_role_enum",
    "reason" "shipments"."dispute_reason_enum" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "shipments"."dispute_status_enum" NOT NULL DEFAULT 'open',
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments"."dispute_statements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dispute_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "author_role" "shipments"."dispute_party_role_enum" NOT NULL,
    "kind" "shipments"."dispute_statement_kind_enum" NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments"."dispute_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dispute_id" UUID NOT NULL,
    "statement_id" UUID,
    "s3_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "disputes_shipment_id_idx" ON "shipments"."disputes"("shipment_id");

-- CreateIndex
CREATE INDEX "disputes_status_idx" ON "shipments"."disputes"("status");

-- CreateIndex
CREATE UNIQUE INDEX "dispute_statements_dispute_author_kind_key" ON "shipments"."dispute_statements"("dispute_id", "author_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "dispute_photos_s3_key_key" ON "shipments"."dispute_photos"("s3_key");

-- CreateIndex
CREATE INDEX "dispute_photos_dispute_id_idx" ON "shipments"."dispute_photos"("dispute_id");

-- AddForeignKey
ALTER TABLE "shipments"."disputes" ADD CONSTRAINT "disputes_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"."shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments"."dispute_statements" ADD CONSTRAINT "dispute_statements_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "shipments"."disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments"."dispute_photos" ADD CONSTRAINT "dispute_photos_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "shipments"."disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments"."dispute_photos" ADD CONSTRAINT "dispute_photos_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "shipments"."dispute_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AC3: como máximo una disputa abierta por envío. Parcial: una resuelta (MOVO-34) no impide
-- abrir otra. Prisma no representa índices parciales (mismo caso que `offers`).
CREATE UNIQUE INDEX "disputes_shipment_open_key" ON "shipments"."disputes"("shipment_id") WHERE "status" = 'open';

-- AC7: los envíos que ya estaban en `disputed` pasan a tener su disputa (de sistema). El motivo
-- sale del `from_status` del último evento a `disputed`: `in_transit` lo abría el barrido de
-- entrega demorada (MOVO-278) y `assigned` el de no-retiro (MOVO-270). `delivered` no tenía
-- caller automático: si aparece uno, queda `other` con el motivo del evento.
INSERT INTO "shipments"."disputes" ("shipment_id", "opened_by", "opened_by_role", "reason", "description", "status", "opened_at")
SELECT
    s."id",
    NULL,
    NULL,
    (CASE e."from_status"
        WHEN 'in_transit' THEN 'transit_anomaly'
        WHEN 'assigned' THEN 'pickup_no_show'
        ELSE 'other'
    END)::"shipments"."dispute_reason_enum",
    COALESCE(e."reason", 'Disputa anterior a la entidad de disputas'),
    'open',
    COALESCE(e."created_at", s."last_status_changed_at", CURRENT_TIMESTAMP)
FROM "shipments"."shipments" s
LEFT JOIN LATERAL (
    SELECT ev."from_status", ev."reason", ev."created_at"
    FROM "shipments"."shipment_events" ev
    WHERE ev."shipment_id" = s."id" AND ev."to_status" = 'disputed'
    ORDER BY ev."created_at" DESC
    LIMIT 1
) e ON TRUE
WHERE s."status" = 'disputed'
  AND NOT EXISTS (SELECT 1 FROM "shipments"."disputes" d WHERE d."shipment_id" = s."id");
