-- MOVO-175 (fix de review, PR #193): a lo sumo un reporte `pending` por par
-- (reportante, reportado). `reportUser` busca el pendiente y después inserta, así que
-- dos pedidos concurrentes (doble tap, reintento tras timeout) podían insertar dos
-- filas. Con este índice el segundo INSERT falla con P2002 y el service devuelve el
-- reporte que ganó. Escrito a mano, no representable en schema.prisma (mismo criterio
-- que `address_user_id_default_unique`, MOVO-119).
CREATE UNIQUE INDEX "user_reports_reporter_id_reported_id_pending_key"
  ON "users"."user_reports" ("reporter_id", "reported_id")
  WHERE "status" = 'pending';
