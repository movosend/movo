-- MOVO-340: buscador de receptor insensible a tildes y mayúsculas ("tomas" encuentra a
-- "Tomás", "pena" a "Peña").
--
-- Las extensiones son de la base (compartida entre los esquemas de cada servicio), no
-- del esquema `users`: se crean en `public` y todas las llamadas van calificadas, así no
-- dependen del `search_path` de la conexión.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- `unaccent()` es STABLE (depende del diccionario configurado), así que no se puede
-- usar en un índice. Este envoltorio fija el diccionario y es IMMUTABLE: la misma
-- expresión sirve para el índice y para la consulta (`user-repository.ts#search`).
CREATE OR REPLACE FUNCTION "users"."f_unaccent"(text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- Índice de trigramas sobre el nombre completo normalizado: sirve para un
-- `LIKE '%palabra%'`. Prisma no puede representar un índice sobre una expresión, así que
-- vive solo en esta migración (igual que el índice parcial de MOVO-296).
CREATE INDEX "users_full_name_search_trgm_idx" ON "users"."users"
  USING gin ("users"."f_unaccent"(lower("first_name" || ' ' || "last_name")) public.gin_trgm_ops);
