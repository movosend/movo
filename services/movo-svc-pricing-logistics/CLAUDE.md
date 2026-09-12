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
Google Routes API) sigue sin implementar — hueco de backlog señalado explícitamente
por el propio ticket MOVO-82, cubierto ahora por MOVO-138 (sin refinar todavía).
ADR-018 (resumen en `CLAUDE.md` raíz) pendiente de pegar completo en Drive.

### MOVO-205 — `POST /optimize/route`: Endpoint de optimización VRPTW multi-envío (ADR-013 / ADR-015)

Lleva el prototipo de la Spike MOVO-50 a producción con Google OR-Tools (`ortools==9.15.6755`).
Optimiza la secuencia de paradas de un transportista con múltiples envíos activos o
candidatos, imponiendo precedencia estricta (retiro antes de entrega) y reporte de retrasos
sobre ventanas horarias.

Decisiones clave y refinamiento (10/09/2026):
- **Abstracción `RoutesProvider` (`app/services/routes_provider.py`)**: implementa
  `MockRoutesProvider` (Haversine + velocidad promedio configurable `ROUTING_AVG_SPEED_KMH=40.0`,
  por default en dev/test/CI sin costo de API keys) y `GoogleRoutesProvider`
  (Google Routes API `Compute Route Matrix`, tier Basic, activable con `ROUTES_PROVIDER=google`
  y `GOOGLE_MAPS_API_KEY`).
- **Orden Canónico de Waypoints**: al consultar la matriz de distancias/tiempos y modelar
  el solver, los waypoints se ordenan como `[salida, pickups..., dropoffs..., llegada]`.
  Garantiza índices determinísticos y predecibles para el mapeo de precedencias.
- **Política Estricta No-Fallback**: si el solver no encuentra solución factible o la
  API de Google falla, se devuelve un error HTTP explícito (`422 Unprocessable Entity`
  o `502 Bad Gateway`) en lugar de soluciones silenciosamente degradadas que desinformen
  al transportista.
- **Tolerancia y Holgura Temporal**: holgura (*slack*) de 120 minutos (2 horas) configurada
  en la dimensión de tiempo de OR-Tools. Las cotas superiores de ventana horaria se modelan
  como suaves con penalización (`SetCumulVarSoftUpperBound`), marcando `outsideTimeWindow: true`
  en cada parada que llegue tarde para advertir al transportista sin fallar con 500.
- **Open Routing**: si no se declara destino final (`finalLocation: null`), se utiliza un
  nodo dummy de costo 0 para que OR-Tools determine libremente la última parada óptima.
- **Tipos TypeScript compartidos (`shared/movo-shared/src/types/routing.ts`)**: exportados
  en `@movo/shared` para el consumo directo en `movo-svc-shipments` (MOVO-206) y `movo-mobile`
  (MOVO-10/MOVO-207).

Tests: `tests/test_optimize.py` (multi-envío 3 pedidos, envío único, envío in_transit solo
entrega, paradas fuera de ventana horaria, validación No-Fallback con error 502/422, mock de
GoogleRoutesProvider y validación Pydantic).

### MOVO-217 — Setup de OR-Tools, cliente Redis y RoutesProvider

Completa la base de infraestructura y servicios de optimización y ruteo para
`movo-svc-pricing-logistics` iniciada en MOVO-205.

Decisiones clave y alcance:
- **Cliente Redis asíncrono (`app/services/redis_client.py`)**: implementa conexión
  con `redis.asyncio` usando `settings.redis_url` (`REDIS_URL`), con decodificación de
  respuestas en texto (`decode_responses=True`). Provee funciones de ciclo de vida
  (`init_redis_client`, `close_redis_client`), acceso global (`get_redis_client`) y
  diagnóstico (`ping_redis`).
- **Ciclo de vida en FastAPI (`main.py`)**: migrado al context manager `lifespan`
  (estándar moderno de FastAPI) para inicializar y cerrar la conexión con Redis ordenadamente.
- **Endpoint `/health`**: reporta el estado general (`status: ok`) y, si `REDIS_URL` está
  configurada, reporta la conectividad con Redis (`redis: connected` o `disconnected`)
  sin fallar ni interrumpir la disponibilidad del servicio.
- **Limpieza de Infraestructura (`infra/docker-compose.yml`)**: conforme a la arquitectura
  stateless del servicio (ADR-019), se removieron la variable `DATABASE_URL` y la
  dependencia `depends_on: postgres` para `movo-svc-pricing-logistics`, manteniendo
  únicamente `REDIS_URL` y `redis`.
- **Base previa de MOVO-205**: las dependencias (`ortools==9.15.6755`, `redis==5.2.1`,
  `httpx==0.28.1`), la abstracción `RoutesProvider` (Mock determinístico y Google Routes API)
  y la política estricta de *No-Fallback* (502 / 422) ya formaban parte de `develop`.

Tests: `tests/test_redis.py` (inicialización con y sin URL, manejo de excepciones en conexión
y ping, cierre de recursos, y verificación en `/health`). 100% de cobertura en `redis_client.py`.
Suite completa en verde (19/19 tests, 89% de cobertura total). `ruff` y `mypy` limpios.

### MOVO-218 — `POST /routes/evaluate-candidates`: Evaluación de candidatos con cache en Redis

Endpoint interno para evaluar el desvío marginal (km y minutos adicionales) que
implicaría para un transportista sumar un paquete a su viaje planificado, consumido
desde `movo-svc-shipments` (MOVO-219) para alimentar el feed de matches (`GET /trips/:id/matches`).

Decisiones clave y alcance:
- **Estrategia Cache-First en Redis (`app/services/candidate_evaluator.py`)**:
  Antes de correr OR-Tools, se consulta la clave `route_solution:{tripId}:{candidateId}`.
  Si existe (Cache HIT), se devuelve la métrica directamente evitando recomputar.
  Si no existe (Cache MISS), se modela el circuito de 4 nodos, se calcula el desvío y se
  persiste en Redis con TTL de 30 minutos (1800 seg) solo si la solución es factible.
- **Modelado de 4 nodos en OR-Tools**:
  `[0: Origen, 1: Pickup, 2: Dropoff, 3: Destino]` con precedencia dura (Pickup antes
  que Dropoff) y holgura de 120 minutos (`settings.routing_time_slack_minutes`). Si la
  ventana horaria ya expiró o excede el slack, se marca `feasible: False`.
- **Desvío marginal exacto**:
  `detourDistanceKm = max(0.0, round(totalDistanceKm - directDistanceKm, 2))`
  `detourDurationMinutes = max(0, totalDurationMinutes - directDurationMinutes)`.
- **Límite de escalabilidad (< 500 ms SLA)**:
  `candidates` acotado a un máximo de 25 paquetes por request vía validación Pydantic
  (`max_length=25`), respondiendo HTTP 422 si se supera.
- **Respuesta liviana**:
  Devuelve las métricas resumen (`detourDistanceKm`, `detourDurationMinutes`, etc.) y
  `feasible: bool`. Las paradas completas quedan almacenadas en Redis para consumo puntual.
- **Política No-Fallback**:
  Si el proveedor de rutas (Google) falla o supera cuota, propaga HTTP 502/503.

Tests: `tests/test_evaluate.py` (candidatos vacíos, candidato factible con desvío,
inviabilidad por ventana horaria vencida, Cache Hit vs Cache Miss en Redis, límite de 25
candidatos 422 y propagación de error 502). Suite completa en verde (26/26 tests, 88%
cobertura total). `ruff` y `mypy` limpios.


