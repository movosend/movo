-- MOVO-311 (review): parte del `application_fee` retenido que corresponde al recargo del emisor (el recargo
-- menos la comisión de MP sobre él que absorbe Movo). Con ella se le muestra al transportista el cobro sin el
-- recargo: bruto = precio y fee de MP sin la parte del recargo, y el desglose cierra contra el neto real.
ALTER TABLE "payments"."settlements" ADD COLUMN "debt_surcharge_fee_ars" DECIMAL(12,2) NOT NULL DEFAULT 0;
