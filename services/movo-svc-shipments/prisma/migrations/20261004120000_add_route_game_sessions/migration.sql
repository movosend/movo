-- Juego del optimizador de la feria (movo-institucional /juegos/optimizador): una fila
-- por partida, para el ranking del día (compartido entre iPads), el sorteo y métricas.
-- Tabla nueva sin FKs: no toca datos existentes.
-- Reversión: DROP TABLE "shipments"."route_game_sessions";

-- CreateTable
CREATE TABLE "shipments"."route_game_sessions" (
    "id" UUID NOT NULL,
    "event_tag" VARCHAR(64) NOT NULL,
    "device_id" VARCHAR(64),
    "started_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ NOT NULL,
    "scenario_id" VARCHAR(16) NOT NULL,
    "city" VARCHAR(64) NOT NULL,
    "points" JSONB NOT NULL,
    "stop_count" INTEGER NOT NULL,
    "user_order" JSONB NOT NULL,
    "optimal_order" JSONB NOT NULL,
    "user_km" DECIMAL(8,2) NOT NULL,
    "optimal_km" DECIMAL(8,2) NOT NULL,
    "extra_km" DECIMAL(8,2) NOT NULL,
    "user_min" DECIMAL(8,1) NOT NULL,
    "optimal_min" DECIMAL(8,1) NOT NULL,
    "extra_min" DECIMAL(8,1) NOT NULL,
    "efficiency_pct" DECIMAL(5,1) NOT NULL,
    "tie" BOOLEAN NOT NULL,
    "time_used_sec" INTEGER NOT NULL,
    "time_limit_sec" INTEGER,
    "timed_out" BOOLEAN NOT NULL,
    "distance_method" VARCHAR(32),
    "computed_by" VARCHAR(8) NOT NULL,
    "name" VARCHAR(18),
    "in_ranking" BOOLEAN NOT NULL DEFAULT false,
    "email" VARCHAR(254),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "route_game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "route_game_sessions_event_tag_ended_at_idx" ON "shipments"."route_game_sessions"("event_tag", "ended_at");
