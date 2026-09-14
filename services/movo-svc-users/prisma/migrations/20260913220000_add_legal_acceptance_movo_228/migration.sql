-- MOVO-228: "firma electrónica" de aceptación de Términos/Privacidad al registrarse
-- (Perfil → Legal, movo-mobile). Columnas nullable sin backfill -- las cuentas
-- existentes nunca aceptaron explícitamente nada, no hay forma honesta de
-- reconstruir esa fecha retroactivamente.
ALTER TABLE "users"."users" ADD COLUMN "terms_accepted_at" TIMESTAMPTZ;
ALTER TABLE "users"."users" ADD COLUMN "terms_version" TEXT;
ALTER TABLE "users"."users" ADD COLUMN "privacy_accepted_at" TIMESTAMPTZ;
ALTER TABLE "users"."users" ADD COLUMN "privacy_version" TEXT;
