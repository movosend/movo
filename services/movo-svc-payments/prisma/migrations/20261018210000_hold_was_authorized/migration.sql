ALTER TABLE "payments"."holds"
ADD COLUMN "was_authorized" BOOLEAN NOT NULL DEFAULT false;

UPDATE "payments"."holds"
SET "was_authorized" = true
WHERE "status" IN ('authorized', 'captured');
