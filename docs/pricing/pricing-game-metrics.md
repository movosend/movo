# Juego de precios de la feria: métricas

Cada partida del juego (`movo-institucional`, `/juegos/precios`) queda en
`shipments.pricing_game_sessions`. Sirve para dos cosas:

1. **Recalibrar `demand_fuel_routes_v1`**: cuánto se desvía la disposición a pagar del
   emisor (WTP) del precio sugerido, y cuánto pide el transportista (WTA) contra la
   ganancia neta ofrecida, por distancia y por tipo de paquete.
2. **La exposición del proyecto**: aceptación del precio y comparación con Uber.

`GET /api/v1/demo/pricing-game/stats?eventTag=<tag>` devuelve los agregados principales
(los mismos que muestra `/juegos/resultados`). Las queries de abajo son para el informe.

## Columnas clave

| Columna | Qué es |
| --- | --- |
| `event_tag` | Evento (`feria-utn-2026`) o `web` si se jugó desde el sitio público |
| `quote_verified` | `true` si el precio salió de la cotización guardada por el servidor |
| `suggested_price_ars` | Precio sugerido (bruto, lo que paga el emisor) |
| `courier_earn_ars` | Ganancia neta del transportista (`precio / (1 + comisión)`) |
| `sender_answer` / `sender_alt_choice` / `sender_wtp_ars` | `yes`/`maybe`/`no`; `-10`/`-20`/`-30`/`custom`/`none`; monto que pagaría (`NULL` = "ni así") |
| `courier_answer` / `courier_alt_choice` / `courier_wta_ars` | Igual, del lado del transportista (`+10`/`+20`/`+30`) |
| `distance_km`, `distance_source`, `fuel_ars_per_liter`, `breakdown` | Desglose de pricing al momento de cotizar |

## Queries

Desvío de la disposición a pagar por tramo de distancia (solo precios verificados):

```sql
SELECT
  CASE WHEN distance_km < 100 THEN '< 100 km'
       WHEN distance_km < 500 THEN '100-500 km'
       ELSE '>= 500 km' END                                   AS tramo,
  count(*)                                                     AS partidas,
  round(avg((sender_answer = 'yes')::int) * 100, 1)            AS pct_acepta_precio,
  round(percentile_cont(0.5) WITHIN GROUP
        (ORDER BY sender_wtp_ars / suggested_price_ars)::numeric, 3) AS mediana_wtp_sobre_precio,
  round(percentile_cont(0.5) WITHIN GROUP
        (ORDER BY courier_wta_ars / courier_earn_ars)::numeric, 3)   AS mediana_wta_sobre_ganancia
FROM shipments.pricing_game_sessions
WHERE event_tag = 'feria-utn-2026' AND quote_verified AND distance_km IS NOT NULL
GROUP BY 1 ORDER BY 1;
```

Por tipo de paquete (¿el factor de frágil 1,2 está bien?):

```sql
SELECT package_preset,
       count(*) AS partidas,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY sender_wtp_ars / suggested_price_ars)::numeric, 3) AS mediana_wtp
FROM shipments.pricing_game_sessions
WHERE event_tag = 'feria-utn-2026' AND quote_verified AND sender_wtp_ars IS NOT NULL
GROUP BY 1 ORDER BY 1;
```

Brecha de mercado: partidas donde el emisor pagaría menos de lo que el transportista
pide (el precio no cierra para ninguno de los dos):

```sql
SELECT count(*) FILTER (WHERE sender_wtp_ars < courier_wta_ars * (1 + commission_rate)) AS no_cierra,
       count(*)                                                                         AS con_ambos_montos
FROM shipments.pricing_game_sessions
WHERE event_tag = 'feria-utn-2026' AND sender_wtp_ars IS NOT NULL AND courier_wta_ars IS NOT NULL;
```

Embudo de abandono:

```sql
SELECT last_screen, count(*) FROM shipments.pricing_game_sessions
WHERE event_tag = 'feria-utn-2026' AND NOT completed
GROUP BY 1 ORDER BY 2 DESC;
```

## Cómo leerlo

- `mediana_wtp_sobre_precio` < 1 de forma consistente en un tramo sugiere bajar el
  componente por km (`PRICING_FUEL_COST_SHARE`/`PRICING_NON_FUEL_L_PER_KM`) para esa
  distancia; > 1, que hay margen.
- `mediana_wta_sobre_ganancia` > 1 indica que la ganancia neta no alcanza para que un
  transportista se desvíe: es la otra punta del mercado y la que define si hay oferta.
- Son respuestas declaradas en un stand, no transacciones reales: sirven para orientar la
  calibración, no para reemplazarla con datos de producción.
