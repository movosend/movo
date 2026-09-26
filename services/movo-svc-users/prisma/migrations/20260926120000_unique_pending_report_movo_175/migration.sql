-- MOVO-175 (fix de review, PR #193): a lo sumo un reporte `pending` por par
-- (reportante, reportado). `reportUser` busca el pendiente y después inserta, así que
-- dos pedidos concurrentes (doble tap, reintento tras timeout) podían insertar dos
-- filas. Con este índice el segundo INSERT falla con P2002 y el service devuelve el
-- reporte que ganó. Escrito a mano, no representable en schema.prisma (mismo criterio
-- que `address_user_id_default_unique`, MOVO-119).

-- Dedup defensivo (comentario de review, PR #193): si algún ambiente ya tiene dos
-- `pending` del mismo par por la carrera que este índice corrige, el CREATE UNIQUE
-- INDEX de abajo rompe el deploy. Se deja solo el `pending` más viejo por par y el
-- resto pasa a `dismissed` (misma semántica que un reporte descartado por admin) antes
-- de crear el índice, así la migración es segura de correr sin coordinación manual.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "reporter_id", "reported_id"
      ORDER BY "created_at" ASC, "id" ASC
    ) AS rn
  FROM "users"."user_reports"
  WHERE "status" = 'pending'
)
UPDATE "users"."user_reports"
SET "status" = 'dismissed'
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX "user_reports_reporter_id_reported_id_pending_key"
  ON "users"."user_reports" ("reporter_id", "reported_id")
  WHERE "status" = 'pending';
