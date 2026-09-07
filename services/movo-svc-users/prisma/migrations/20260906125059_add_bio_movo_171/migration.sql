-- MOVO-171: bio de texto libre del perfil, columna nullable sin backfill -- "" nunca
-- se persiste (se resuelve a NULL en users.service.ts antes de escribir).
ALTER TABLE "users"."users" ADD COLUMN "bio" TEXT;
