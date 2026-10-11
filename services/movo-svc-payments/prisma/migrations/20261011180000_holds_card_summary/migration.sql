-- MOVO-211: tarjeta del intento de hold (marca y últimos 4), para mostrarla en el detalle
-- del envío. Nullable: los intentos previos no la tienen.
ALTER TABLE "payments"."holds" ADD COLUMN "card_brand" TEXT;
ALTER TABLE "payments"."holds" ADD COLUMN "card_last_four" TEXT;
