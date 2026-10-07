-- Juego de precios de la feria (movo-institucional /juegos/precios): una fila por
-- partida, para medir disposición a pagar/aceptar contra el precio real de
-- demand_fuel_routes_v1 y recalibrar PRICING_*. Tabla nueva sin FKs: no toca datos
-- existentes.
-- Reversión: DROP TABLE "shipments"."pricing_game_sessions";

-- CreateTable
CREATE TABLE "shipments"."pricing_game_sessions" (
    "id" UUID NOT NULL,
    "event_tag" VARCHAR(64) NOT NULL,
    "device_id" VARCHAR(64),
    "started_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ NOT NULL,
    "duration_sec" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL,
    "last_screen" VARCHAR(32) NOT NULL,
    "origin_name" VARCHAR(120),
    "origin_province" VARCHAR(120),
    "origin_lat" DECIMAL(9,6),
    "origin_lng" DECIMAL(9,6),
    "destination_name" VARCHAR(120),
    "destination_province" VARCHAR(120),
    "destination_lat" DECIMAL(9,6),
    "destination_lng" DECIMAL(9,6),
    "package_preset" VARCHAR(16),
    "package_type" "shipments"."package_type_enum",
    "weight_kg" DECIMAL(6,2),
    "quote_id" UUID,
    "quote_verified" BOOLEAN NOT NULL DEFAULT false,
    "calculation_method" VARCHAR(32),
    "suggested_price_ars" DECIMAL(12,2),
    "high_demand" BOOLEAN,
    "distance_km" DECIMAL(8,2),
    "distance_source" VARCHAR(32),
    "fuel_ars_per_liter" DECIMAL(10,2),
    "breakdown" JSONB,
    "sender_answer" VARCHAR(8),
    "sender_alt_choice" VARCHAR(8),
    "sender_wtp_ars" DECIMAL(12,2),
    "commission_rate" DECIMAL(5,4),
    "courier_earn_ars" DECIMAL(12,2),
    "courier_answer" VARCHAR(8),
    "courier_alt_choice" VARCHAR(8),
    "courier_wta_ars" DECIMAL(12,2),
    "uber_estimate_ars" DECIMAL(12,2),
    "email" VARCHAR(254),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pricing_game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pricing_game_sessions_event_tag_created_at_idx" ON "shipments"."pricing_game_sessions"("event_tag", "created_at");

