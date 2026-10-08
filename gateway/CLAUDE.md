# CLAUDE.md — gateway (movo-api-gateway)

Estado de implementación de `gateway`. Ver el `CLAUDE.md` de la raíz del repo para
contexto general del proyecto (stack, ADRs, convenciones, git/PR). Entrada corta por
US: qué se hizo, en qué archivos, decisiones no obvias, qué queda pendiente.

## Estado actual de la implementación

### MOVO-68 — Middleware del API Gateway

Auth, autorización por rol (`app.authorize(roles)`), rate limiting con Redis, error
handler central, ruteo declarativo `/api/v1` (`config/routes-map.ts`). Rutas públicas
se declaran por método+path exacto en `getPublicRoutes()` — cualquier ruta nueva es
protegida por defecto salvo que se liste explícitamente. Rate limit general 200/min +
estricto en login (5/15min); `keyGenerator` explícito por limiter (necesario:
`@fastify/rate-limit` en modo decorator comparte namespace de Redis entre limiters sin
esto). Solo `svc-users`/`svc-shipments` conectados por ahora.

### MOVO-134 — Revocación de access tokens (fix de review sobre `plugins/auth.ts`)

`authenticate` ahora, después de verificar el JWT, chequea
`user-revoked-at:{userId}` en el mismo Redis compartido (ADR-003) y rechaza (401
`AUTH_TOKEN_INVALID`) cualquier access token cuyo `iat` sea anterior a esa marca. La
key la sella `movo-svc-users` (`repositories/session-repository.ts#revoke
AccessTokensIssuedBefore`) al cambiar la contraseña o dar de baja la cuenta — sin
esto, un JWT stateless (ADR-004) seguía siendo válido hasta sus 60 minutos de TTL
aunque la sesión ya estuviera revocada del lado de `svc-users`. Ver detalle completo
en `services/movo-svc-users/CLAUDE.md` (MOVO-134, fixes de review).

### MOVO-144/145 — Proxy de `/offers` (`svc-shipments`)

Se sumó la entrada `/offers` a `config/routes-map.ts#getServiceRoutes()` (mismo
`SHIPMENTS_SERVICE_URL` que `/shipments`, protegido por defecto sin tocar
`getPublicRoutes()`) para proxear `POST /offers/:id/accept`, `POST /offers/:id/reject`
(MOVO-144) y `GET /offers/mine` (MOVO-145) de `svc-shipments` — viven bajo un prefijo
propio, no anidados en `/shipments`. Mismo criterio que MOVO-119 de abajo. Ambas US
agregaron esta misma entrada en paralelo sobre ramas distintas; al mergear quedó
una sola (duplicado detectado por el arranque de Fastify fallando en CI con
`Method '[...]' already declared for route '/api/v1/offers'`, no por el merge en sí).
Detalle completo de cada US en `services/movo-svc-shipments/CLAUDE.md`.

### MOVO-119 — Proxy de `/addresses` (`svc-users`)

Se sumó la entrada `/addresses` a `config/routes-map.ts#getServiceRoutes()` (protegido
por defecto, sin tocar `getPublicRoutes()`) para proxear el CRUD de direcciones
guardadas de `svc-users`. Detalle completo de la US en
`services/movo-svc-users/CLAUDE.md`.

### MOVO-133 — Rate limit para cambio de teléfono/email (fix de review, PR #91)

`config/routes-map.ts#getRateLimitOverrides()` suma `POST /users/me/phone/change/otp`
y `POST /users/me/email/change/otp` (5/15min, mismo mecanismo que MOVO-97/123/125) --
mandan SMS reales por Twilio (ADR-012) y el cooldown de `otpService.generateOtp()`
(`movo-svc-users`) es por target, no por caller: sin este override, una cuenta
autenticada podía disparar del orden de 200 SMS/min variando el teléfono en cada
request bajo el límite general. Detalle completo en
`services/movo-svc-users/CLAUDE.md` (MOVO-133, fixes de review).

### MOVO-139 — Rate limit para la verificación de email

`getRateLimitOverrides()` suma `POST /users/me/email/verify/otp` (5/15min), alineado
con los dos endpoints de cambio de arriba -- ahora manda mails reales por Resend
(ADR-017): la cuota del free tier y la reputación del dominio son el recurso a
proteger. Detalle completo en `services/movo-svc-users/CLAUDE.md` (MOVO-139).

### MOVO-140 — Rutas públicas de recuperación de contraseña

`getPublicRoutes()` suma `POST /auth/forgot-password`, `/auth/verify-reset-otp` y
`/auth/reset-password` -- públicas por necesidad (el usuario todavía no tiene
sesión), match exacto por método+path (no por prefijo), mismo rate limit estricto
que `/auth/login` (5/15min c/u, `keyGenerator` propio por ruta vía el mecanismo ya
existente de `routes/index.ts`) para que no sean una fuente gratis de SMS/mails
contra terceros. Detalle completo en `services/movo-svc-users/CLAUDE.md` (MOVO-140).

### MOVO-201 — Proxy de WebSocket hacia `/shipments` (canal de tiempo real)

`config/routes-map.ts#ServiceRoute` suma `websocket?: boolean`, seteado en la entrada
`/shipments` (`GET /shipments/:id/track`, `movo-svc-shipments`). `@fastify/http-proxy`
maneja el upgrade WS internamente al pasarle `{ websocket: true }` — no hace falta
`@fastify/websocket` en el gateway.

Decisión clave: `@fastify/http-proxy` no reenvía `x-user-*` al upstream en una conexión
WS por default (su `wsClientOptions.rewriteRequestHeaders` de fábrica solo reenvía el
header `cookie`) — sin esto, la request HTTP normal a `/shipments/*` llegaba con la
identidad inyectada por el `preHandler` (ADR-010) pero el upgrade WS al mismo prefijo
llegaba "anónimo". `routes/index.ts` agrega un `wsClientOptions.rewriteRequestHeaders`
propio que reenvía `authorization`/`x-user-id`/`x-user-roles`/`x-kyc-status`/
`x-request-id` leyendo `request.headers` — el MISMO objeto que ya mutó el `preHandler`
de esa request, así que no hace falta duplicar la lógica de autenticación. Registrar el
proxy pasó de una sola llamada a `app.register(httpProxy, {...})` por ruta a un
`if/else` entre dos llamadas (una con `websocket: true`, otra sin): el tipo de
`@fastify/http-proxy` es una unión discriminada por `websocket` (`true` vs
`false | never`) que TypeScript no resuelve bien si esa propiedad llega de un spread
condicional en un solo objeto en vez de estar escrita literal en cada llamada.

Test nuevo `test/websocket-proxy.test.ts` (2 casos) — las suites existentes de
`routes-prefix.test.ts` pegan contra un stub HTTP plano que nunca ejercita el upgrade;
este test arma un upstream `ws` real y verifica de punta a punta que `authorization`/
`x-user-id`/`x-user-roles`/`x-kyc-status` llegan inyectados (y que un `x-user-id`
falsificado por el cliente no sobrevive). Suite completa del gateway: 51/51. Detalle
completo del canal (autenticación en `svc-shipments`, cierre por estado, heartbeat) en
`services/movo-svc-shipments/CLAUDE.md` (MOVO-201).

**Fix de review (PR #174, JcBordino4, antes de mergear) — `authorization` faltaba en
`FORWARDED_IDENTITY_HEADERS`**: la lista original solo tenía `x-user-*`/`x-request-id`
(sin `authorization`), así que toda conexión de tracking que pasara por el gateway
cerraba con `4001` — `authorizeRealtimeConnection` (`svc-shipments`) solo lee
`Authorization: Bearer`, nunca cae a `x-user-*`. Reproducido por el reviewer con un
Fastify + `@fastify/http-proxy` mínimo antes de encontrarlo en este repo. Test ampliado
con el assert que pedía el review (`capturedHeaders["authorization"]`).

### MOVO-250 — Rate limit propio para el lote de posiciones GPS

`getRateLimitOverrides()` suma `POST /shipments/positions` (30/min por IP, contador
propio) para el lote de la cola offline/tarea de segundo plano del mobile (MOVO-203/242).
Sin esto caía en el límite general de 200/min compartido con toda la API y una tanda al
volver la señal podía consumirlo. El POST individual `/shipments/:id/positions` no se
puede listar acá (el match es por path exacto) y sigue bajo el general. Detalle en
`services/movo-svc-shipments/CLAUDE.md` (MOVO-250).

### MOVO-255 — Rate limit por usuario en `POST /shipments/quote`

`RateLimitedRoute` gana `perUser`: ese limiter cuenta por `sub` del JWT en vez de por IP y
corre después de `authenticate` (sigue siendo el único limiter del request, no se suma al
general). Primer uso: `POST /shipments/quote`, 20 cada 15 min, mismo límite que
`/shipments/route` porque cada cotización consulta Google Routes. Por usuario porque varios
celulares detrás del NAT de la operadora comparten IP. Un request sin token a una ruta
`perUser` responde 401 sin pasar por ningún limiter.

### Juego de precios de la feria — API key para el prefijo `/demo`

Primer cliente del gateway que no es un usuario: los juegos de `movo-institucional`
(/juegos). `ServiceRoute.auth: "apiKey"` (default `"jwt"`) cambia la autenticación del
prefijo: `plugins/api-key.ts#authenticateApiKey` compara `x-api-key` contra
`DEMO_API_KEYS` (lista separada por coma; vacía = todo 401) con hashes SHA-256 y
`timingSafeEqual`, e inyecta `x-client-id: demo-<n>`. Un JWT no sirve en `/demo`, la key no
se reenvía al upstream y cualquier `x-client-id` que mande un cliente se borra en todas
las rutas. Rate limit `perClient` (cliente demo + IP real del visitante en
`x-movo-client-ip`, que reenvía el servidor de Next): sin eso todo el sitio compartiría las
IPs de Vercel. Cotización, stats y resto de `/demo`: 60/min por visitante (varios iPads de la feria comparten la IP del wifi). Sin
CORS: la key vive solo en el servidor de Next, nunca en el navegador. Ver ADR-030.

Juego del optimizador (ADR-031): `POST /demo/route-game/games` y `GET /demo/route-game/ranking`
con su propio límite `perClient` de 60/min (crear una partida corre OR-Tools en
pricing-logistics); el PUT y el reset caen en el límite demo general.

Fix de review (PR #212, PedroYorlano): una key inválida en `/demo` pasa por el limiter
general por IP antes del 401 (antes ningún limiter corría antes de `authenticateApiKey`).
El estricto por cliente demo todavía no corrió, así que sigue habiendo un solo limiter por
request. Queda pendiente un tope global por `clientId`: `x-movo-client-ip` lo controla quien
tiene la key.

### MOVO-267 — Proxy de `/payments` (`svc-payments`)

Se descomentó la entrada `/payments` de `config/routes-map.ts#getServiceRoutes()`, con
`allowedRoles: [sender, carrier]` (un admin sin esos roles recibe 403). Es el tercer
servicio proxeado, después de `svc-users` y `svc-shipments`. El callback de OAuth y el webhook de Mercado Pago entran a `getPublicRoutes()` en
MOVO-111/268. Detalle en `services/movo-svc-payments/CLAUDE.md`.

### MOVO-111 — Callback público de OAuth de Mercado Pago

`getPublicRoutes()` suma `GET /payments/mp-connect/callback` (20 cada 15 min por IP). Lo
abre el navegador embebido del transportista al volver de MP, sin JWT; a quién pertenece
la vinculación sale del `state` en Redis de `svc-payments`, no de la sesión. El resto de
`/payments/mp-connect/*` sigue protegido. Detalle en `services/movo-svc-payments/CLAUDE.md`.
El gateway deja de arrancar con `logger: true`: `config/logger.ts` tiene un serializer de
`req` que oculta el query de esa ruta (`?code=...&state=...`), y el error handler usa el
mismo `redactUrl`.
