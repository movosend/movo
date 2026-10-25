-- MOVO-331 (ADR-055): cambio forzado de estado desde el panel. Aditiva: los eventos existentes quedan `normal`.
CREATE TYPE "shipments"."shipment_event_kind_enum" AS ENUM ('normal', 'manual', 'forced');
ALTER TABLE "shipments"."shipment_events" ADD COLUMN "kind" "shipments"."shipment_event_kind_enum" NOT NULL DEFAULT 'normal';
ALTER TABLE "shipments"."shipment_events" ADD COLUMN "actor_name" TEXT;
