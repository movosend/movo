# Juego del optimizador de la feria: métricas

Cada partida del juego (`movo-institucional`, `/juegos/optimizador`) queda en
`shipments.route_game_sessions`, una fila por partida (se registra al terminar la carrera y
se actualiza si la persona se anota en el ranking). Sirve para el ranking del stand, el
sorteo y para contar en la exposición cuánto se aleja una ruta armada a mano de la del
optimizador.

## Columnas clave

| Columna | Qué es |
| --- | --- |
| `event_tag` | Evento (`?stand=` del kiosco) o `web` |
| `scenario_id`, `city`, `stop_count` | Ciudad y cantidad de paradas (4 a 7, configurable en el modo stand) |
| `user_km`, `optimal_km`, `extra_km` | Km del jugador, del optimizador y la diferencia, sobre la misma matriz |
| `efficiency_pct`, `tie` | `optimal_km / user_km` (tope 100) y empate (< 50 m de diferencia) |
| `time_used_sec`, `time_limit_sec`, `timed_out` | Cuánto tardó, con qué reloj jugó y si se le acabó el tiempo |
| `distance_method` | `google_routes_vrptw_distance`, `haversine_mock_vrptw_distance` o el método offline del iPad |
| `computed_by` | `server` (medido con la matriz cacheada) o `client` (partida jugada sin red) |
| `name`, `in_ranking` | Nombre del ranking; el reset del modo stand pone `in_ranking = false` |
| `email` | Solo con consentimiento (sorteo + newsletter) |

## Queries

Eficiencia promedio por cantidad de paradas (¿cuánto empeora la intuición con más paradas?):

```sql
SELECT stop_count,
       count(*)                                        AS partidas,
       round(avg(efficiency_pct), 1)                   AS eficiencia_prom,
       round(avg(tie::int) * 100, 1)                   AS pct_empates,
       round(avg(extra_km), 2)                         AS km_de_mas_prom
FROM shipments.route_game_sessions
WHERE event_tag = 'feria-utn-2026' AND computed_by = 'server'
GROUP BY stop_count
ORDER BY stop_count;
```

Participantes del sorteo (una fila por mail, la mejor partida):

```sql
SELECT DISTINCT ON (email) email, name, efficiency_pct, ended_at
FROM shipments.route_game_sessions
WHERE event_tag = 'feria-utn-2026' AND email IS NOT NULL
ORDER BY email, efficiency_pct DESC, time_used_sec;
```
