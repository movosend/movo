# CLAUDE.md — services/movo-svc-pricing-logistics

Estado de implementación de `movo-svc-pricing-logistics`. Ver el `CLAUDE.md` de la raíz
del repo para contexto general del proyecto (stack, ADRs, convenciones, git/PR).
Entrada corta por US: qué se hizo, en qué archivos, decisiones no obvias, qué queda
pendiente.

## Estado actual de la implementación

### MOVO-50 — Spike: VRPTW con Google OR-Tools

Entregables en `docs/or-tools/` (`vrptw-spike-report.md`, `vrptw_prototype.py`).
Prefiltro geométrico al segmento de ruta (descarta candidatos >15km sin llamar a
OR-Tools/Google Maps). Cache de la solución del feed (0 llamados extra al aceptar una
oferta). SLA <50ms para 20 envíos, fallback greedy determinístico <0.2ms. Motivó
ADR-013 (Routes API sobre Distance Matrix).

### MOVO-82 — `POST /quote`: contrato de precio sugerido, implementación provisoria (ADR-018)

Primer endpoint de negocio real del servicio (hasta acá solo `GET /health`) y primer
contacto real del equipo con FastAPI. Reestructurado a `app/{config,models,services,
routers}` + `main.py` (convención de este repo para servicios Python, sin usar hasta
ahora). Reemplaza el placeholder que tenía `movo-svc-shipments` (MOVO-80,
`computePlaceholderPrice`, ya eliminado — ver `services/movo-svc-shipments/CLAUDE.md`).

Decisiones clave:
- **`app/models/quote.py` con `alias_generator=to_camel`**: primer contacto de este
  servicio con un consumidor TypeScript (`movo-svc-shipments/src/adapters/
  pricing-client.ts`) — el wire contract usa camelCase (`originLat`, `weightKg`, ...),
  igual que `shared/movo-shared/src/types/pricing.ts`, sin traducir a mano en ningún
  lado.
- **Distancia euclidiana, no Haversine (AC3 literal)**: `app/services/pricing.py`
  proyecta los grados de lat/lng a km sobre un plano local (aproximación
  equirectangular: longitud escalada por `cos(latitud promedio)`) y recién ahí aplica
  Pitágoras — sigue siendo una distancia euclidiana (línea recta en el plano
  proyectado), a diferencia del cálculo geodésico que sigue usando
  `movo-svc-shipments` para la validación de MOVO-126 (retiro/entrega no pueden ser el
  mismo punto).
- **Coeficientes en `app/config.py`** (`pydantic-settings`, prefijo `PRICING_`), no
  hardcodeados: `PRICING_BASE_FARE_ARS`/`PRICING_PRICE_PER_KM_ARS`/
  `PRICING_PRICE_PER_KG_ARS` replican los valores del placeholder viejo (continuidad de
  precios); `PRICING_FACTOR_{LETTER_DOCUMENT,STANDARD_PACKAGE,FRAGILE_ITEM}` son
  nuevos (AC3 pedía explícitamente un factor por `packageType`, el placeholder no lo
  tenía).
- **`pydantic==2.10.6` pineado** en `requirements.txt` (antes sin pin, `fastapi==
  0.115.6` no lo fija): `pydantic>=2.11` dispara `UnsupportedFieldAttributeWarning` en
  cada request cuando un modelo combina `alias_generator` con la forma en que FastAPI
  reconstruye internamente el `Field()` del body — bug de compatibilidad entre
  versiones, no del código de este servicio. Sin el pin, cualquier `pip install`
  fresco (incluido CI) resuelve a la última versión y arrastra el warning en cada
  request de producción.
- **`calculationMethod: "euclidean_linear_v1"` fijo** (AC4) — `PriceCalculationMethod`
  duplicado como `Enum` acá (`app/models/quote.py`) y como TS enum en
  `@movo/shared` (`PriceCalculationMethod`), alineados 1:1 a mano (agregar un valor
  nuevo obliga a tocar ambos lados, no hay generación de código compartida entre
  Python y TS en este repo).

Tests: `tests/test_quote.py` (3 casos calculados a mano con coordenadas elegidas para
que la distancia dependa solo de la latitud — evita depender de `cos()` para verificar
a mano — más 1 caso de validación 422). 100% de cobertura sobre `main.py`+`app/`.
`ruff`/`mypy` limpios.

Pendiente / fuera de alcance: el motor real (demanda + precio de combustible +
Google Routes API, VRPTW en producción) sigue sin implementar — hueco de backlog
señalado explícitamente por el propio ticket MOVO-82, cubierto ahora por MOVO-138
(sin refinar todavía). ADR-018 (resumen en `CLAUDE.md` raíz) pendiente de pegar
completo en Drive.
