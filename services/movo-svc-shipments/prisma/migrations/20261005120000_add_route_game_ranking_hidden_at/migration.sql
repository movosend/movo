-- Juego del optimizador: marca de cuándo el reset del modo stand sacó la partida del
-- ranking, para que un reenvío posterior (cola offline del iPad, o el PUT de "anotarme"
-- en vuelo) no la vuelva a mostrar. Columna nullable en una tabla nueva: no toca datos.
-- Reversión: ALTER TABLE "shipments"."route_game_sessions" DROP COLUMN "ranking_hidden_at";

-- AlterTable
ALTER TABLE "shipments"."route_game_sessions" ADD COLUMN "ranking_hidden_at" TIMESTAMPTZ;
