-- MOVO-311 (review): el cobro tal como lo ve el transportista, sin el recargo del emisor, se calcula UNA vez al
-- acreditar la liquidación y se guarda. Antes lo reconstruía cada vista (historial y liquidación de shipments) con
-- `carrierPaymentView`, y la que se olvidara de llamarlo mostraba el recargo. `NULL` hasta que se acredita.
ALTER TABLE "payments"."settlements" ADD COLUMN "carrier_gross_amount_ars" DECIMAL(12,2);
ALTER TABLE "payments"."settlements" ADD COLUMN "carrier_mp_fee_ars" DECIMAL(12,2);

-- Liquidaciones ya acreditadas: bruto menos el recargo y fee de MP menos la comisión que absorbe Movo sobre él.
UPDATE "payments"."settlements"
SET "carrier_gross_amount_ars" = "gross_amount_ars" - "debt_surcharge_ars",
    "carrier_mp_fee_ars" = "mp_fee_ars" - ("debt_surcharge_ars" - "debt_surcharge_fee_ars")
WHERE "status" = 'credited' AND "mp_fee_ars" IS NOT NULL;
