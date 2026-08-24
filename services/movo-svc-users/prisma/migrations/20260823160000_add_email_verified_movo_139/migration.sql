-- MOVO-139: verificación de email por OTP (ADR-017). Los usuarios existentes quedan en
-- `false` por backfill natural del default -- no se los da por verificados: nadie probó
-- todavía la propiedad de esas direcciones, que es exactamente lo que esta US arregla.
-- `email_verified_at` es solo para auditoría (queda NULL hasta la primera verificación).
ALTER TABLE "users"."users"
  ADD COLUMN "email_verified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "email_verified_at" TIMESTAMPTZ;
