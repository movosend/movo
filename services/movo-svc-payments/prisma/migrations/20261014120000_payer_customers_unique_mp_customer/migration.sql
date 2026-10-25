-- MOVO-100 (DD-039): un customer de MP pertenece a una sola cuenta de Movo. Sin esto, el
-- `101` (email con customer) podía asociar a un usuario el customer de otro.

-- CreateIndex
CREATE UNIQUE INDEX "payer_customers_mp_customer_id_key" ON "payments"."payer_customers"("mp_customer_id");
