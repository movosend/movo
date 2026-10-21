-- MOVO-294: fecha de la baja de cuenta para la ficha del panel ("Cuenta eliminada el ...").
-- Sin backfill: `updated_at` no sirve de aproximación (cambia con cualquier escritura), así que
-- las bajas anteriores a esta migración quedan con NULL.
ALTER TABLE "users"."users" ADD COLUMN "deleted_at" TIMESTAMPTZ;
