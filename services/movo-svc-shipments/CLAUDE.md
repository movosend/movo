# CLAUDE.md — services/movo-svc-shipments

Estado de implementación de `movo-svc-shipments`. Ver el `CLAUDE.md` de la raíz del
repo para contexto general del proyecto (stack, ADRs, convenciones, git/PR). Entrada
corta por US: qué se hizo, en qué archivos, decisiones no obvias, qué queda pendiente.

## Estado actual de la implementación

### MOVO-105 — Máquina de estados de envío (`svc-shipments`)

`src/domain/shipment-state-machine.ts`, dominio puro sin DB. 9 estados canónicos
(`ShipmentStatus` en `@movo/shared`, reemplaza los 5 provisorios de MOVO-67), 13
transiciones válidas según el DTE diseñado en Drive (`docs/shipments/
state-diagram.md`). Cancelación del emisor válida desde 4 estados de origen (una,
post-`assigned`, "con penalización" — penalización aún sin implementar). `disputed`
sin transición de salida modelada (resolución de admin, ticket futuro).

### MOVO-104 — Schema y migraciones de `shipments`

Primer dominio real de `svc-shipments` → adopta Prisma (ADR-011). Modelos
`Shipment`/`ShipmentEvent`/`ShipmentPhoto`. `shipment-repository.ts#updateStatus()` es
la única vía de escritura de `status` (usa `transition()` de MOVO-105 antes del
UPDATE, en la misma transacción inserta el evento). TOCTOU conocido y aceptado en su
momento (sin lock atómico entre la relectura del estado y el UPDATE) — resuelto con
compare-and-swap en MOVO-118.
Gotcha: `_prisma_migrations` vive en `public`, compartida entre todos los servicios
Prisma sobre el mismo Postgres (ADR-003) — migraciones nuevas de `svc-shipments` se
generan con `prisma migrate diff --from-empty` + `migrate deploy`, nunca
`migrate dev` contra el Postgres compartido de dev.

### MOVO-80 — Creación de envío, detalle y listado propio (`svc-shipments`)

Primer flujo de negocio real de `svc-shipments` sobre MOVO-104/105: `POST /shipments`,
`GET /shipments/:id` (403 a un tercero, nunca 404 filtrado) y `GET /shipments/mine`
(paginado, primer endpoint paginado del repo). `src/app.ts` de este servicio nunca
había terminado de cablearse (sin `@fastify/env`, sin error-handler) — se completó
como prerrequisito, portando el mismo patrón de `movo-svc-users`.

Decisiones clave:
- **Búsqueda de receptor movida a `svc-users`** (`GET /users/search?q=`, no en
  `svc-shipments` como sugería el AC literal) — es su dominio, evita una llamada
  extra entre servicios solo para buscar. Busca por nombre completo
  (`firstName`+`lastName`, substring case-insensitive) — no hay campo `username` en
  `User`, y buscar por email/teléfono se descartó a propósito (habilitaría
  enumeración de usuarios).
- **`src/adapters/users-client.ts`**: primera llamada interna servicio-a-servicio del
  repo (hasta ahora todos los adapters hablaban con APIs de terceros). `fetch` nativo
  + `AbortSignal.timeout(5000)` — sin timeout, una demora en `svc-users` cuelga el
  request de creación de envío indefinidamente. Sin modo mock (a diferencia de
  `DiditClient`/`GeocodingProvider`): los tests inyectan un `UsersClient` falso vía
  `buildApp({ usersClient })`, no hace falta un tercer modo por costo/credenciales.
  Chequea existencia y KYC de identidad aprobado del receptor en una sola llamada
  (`GET /users/:id` ya devuelve `isVerified`).
- **`suggestedPriceArs` con fórmula placeholder** (tarifa base + $/kg + $/km
  Haversine) en `shipments.service.ts` — `svc-pricing-logistics` (motor real, EP-05)
  todavía es solo un esqueleto. Documentado explícitamente como temporal, sin nueva
  migración ni adapter de pricing.
- **Bug de timezone encontrado corriendo el servicio real (no por los tests
  `app.inject`)**: `pickupDate`/`pickupTimeWindowStart`/`pickupTimeWindowEnd` se
  guardan como `Date` ancladas a UTC (valores de calendario/reloj de pared, no
  instantes), pero los serializadores `asDate`/`asTime` de fast-json-stringify
  (detrás de `format: "date"`/`"time"` en el schema de respuesta) le restan el
  `getTimezoneOffset()` del proceso antes de recortar el ISO string — pensado para
  mostrar un instante real en hora local, corre el valor si el proceso no corre en
  UTC (confirmado en local, Córdoba UTC-3: "09:00" salía "06:00"). Corregido
  convirtiendo esos tres campos a string ya formateado (`toShipmentDto` en
  `shipments.routes.ts`) antes de que lleguen al serializador — `asDate`/`asTime`
  dejan pasar un string tal cual, sin ajuste. Sin este fix, cualquier deploy con
  `TZ` distinto de UTC habría corrompido esos tres campos en toda respuesta.

Pendiente / fuera de alcance de MOVO-80: penalización de cancelación post-`assigned`
y transición de salida de `disputed` (MOVO-105, sin ticket todavía); el `carrierId`
no participa en `GET /shipments/mine` (no hay asignación automática este sprint).

### MOVO-102 — Schema y máquina de estados de la oferta (Offer) (`svc-shipments`)

Hermano de MOVO-79/104/105 para la entidad `Offer` (existía en el DER 2.0 pero ningún
ticket la implementaba). `prisma/schema.prisma` (enum `OfferStatus` + modelo `Offer`),
`offer-state-machine.ts`, `offer-repository.ts`. `OfferStatus` vive en `@movo/shared`
(mismo criterio que `ShipmentStatus`, consumido cross-servicio por los futuros endpoints
de MOVO-17/23).

Decisiones clave:
- **`expired` es un estado derivado, nunca una transición real (AC11)**: expiración
  perezosa, sin scheduler. `transition(pending, expired)` está probada como inválida —
  se calcula en cada lectura (`deriveEffectiveOfferStatus`), nunca se persiste un
  `UPDATE` a ese valor.
- **AC9 (bloqueo optimista, "el punto crítico de todo el flujo") sin `SELECT...FOR
  UPDATE` ni `$queryRaw`**: `acceptOffer()` condiciona `tx.shipment.updateMany({where:
  {id, status:'published'}, ...})` y chequea `count` — bajo READ COMMITTED, el `UPDATE`
  toma un row-lock exclusivo; la transacción perdedora reevalúa su `WHERE` contra datos
  ya commiteados y `count` da 0, lanzando `ShipmentNotAvailableForAssignmentError` en
  vez de una segunda asignación. Primer optimistic locking real del proyecto — el mismo
  patrón se reusó después para cerrar el TOCTOU de `shipment-repository.ts#updateStatus`
  (MOVO-118). Verificado
  con un test de concurrencia real (`Promise.allSettled` de dos `acceptOffer`
  simultáneos contra Postgres) — necesitó precalentar el pool de conexiones antes de la
  carrera, sin eso la suite completa dejaba una sola conexión idle y la carrera perdía
  representatividad.
- **AC7 resuelto 100% en la base**: índice único parcial `(shipment_id, carrier_id)
  WHERE status='pending'` — no representable en el DSL de Prisma, agregado a mano en
  `migration.sql`. Un rechazo/retiro previo no bloquea una oferta nueva.
- **AC10 reinterpretado por drift del AC contra el schema real, pendiente de
  confirmación del equipo (comentario en Linear)**: el rango `pickup_date_start`–
  `pickup_date_end` que pide el AC no existe en el `Shipment` real de MOVO-104 (solo
  hay `pickupDate`, un día) — se validó como igualdad de día contra `pickupDate`.
- **Snapshot del transportista (AC2) sin vehículo**: `carrierRatingAtOffer`/
  `carrierNameAtOffer` sí se agregaron; vehículo no, porque no hay ninguna entidad de
  vehículo diseñada todavía en el DER — habría adelantado un modelo que MOVO-17 no
  cerró.
- **AC12/AC13 (header `x-user-id`, validación de KYC) fuera de alcance**: este ticket
  es solo schema/dominio/repositorio, sin capa HTTP — `svc-shipments` tampoco tiene
  acceso a `users.users` (ADR-003) para validar KYC. Documentado para el futuro ticket
  HTTP tipo MOVO-80 (el JWT ya lleva `kycStatus` como claim, sin llamada cross-servicio
  nueva).
- **Migración con `prisma migrate diff` incremental** (nunca `migrate dev` contra el
  Postgres compartido, mismo motivo que MOVO-104). DER actualizado: `shipments.offer`
  (placeholder) → `shipments.offers`, con el enum real. Diagrama Mermaid nuevo en
  `docs/shipments/offer-state-diagram.md`.

Tests: 69/69 en `svc-shipments` (35 nuevos: 14 de `offer-state-machine`, incluyendo
`pending -> expired` para fijar que es inalcanzable vía `transition()`; 21 de
`offer-repository`, contra Postgres real, incluye el test de concurrencia de AC9).
93.02% statements / 93.44% branches en `models`/`domain`/`repositories`. Verificado
además con la imagen Docker ya buildeada (`prisma migrate deploy` idempotente,
`GET /health` real).

Pendiente / fuera de alcance: negociación encadenada (`parent_offer_id`, recorte de
alcance explícito del ticket); valor default de `expiresAt` (el campo existe, ningún AC
definió cuánto dura una oferta activa); `src/modules/shipments/*` (stubs HTTP) sigue sin
tocarse.

### MOVO-81 — Carga de fotos del paquete con presigned URLs de S3 (`svc-shipments`)

`src/adapters/storage-provider.ts`+`s3-storage-provider.ts`+`mock-storage-provider.ts`
(mismo patrón que `movo-svc-users`/MOVO-97, pero con `createDownloadUrl` en vez de
`getPublicUrl`/`getKeyFromUrl` — el prefijo `shipments/*` es privado, AC8, y la key ya
se persiste directo en `shipment_photos.s3_key`, no hay que derivarla de una URL
pública). `photos.service.ts` + 3 endpoints nuevos en `shipments.routes.ts`:
`POST/:id/photos/presign`, `POST /:id/photos/confirm`, `GET /:id/photos`. JPEG-only,
2 MB máx (sugerido explícito del ticket, no los 5 MB de la foto de perfil). Solo el
emisor puede presign/confirm para `stage: creation` (única etapa autorizada por
ahora — MOVO-21/MOVO-30 suman `pickup`/`delivery` reusando el mismo dominio, ya
genérico por stage desde MOVO-104).

Decisiones clave:
- **AC6 ("no puede pasar a `awaiting_receiver_confirmation` con <2 fotos") es
  imposible tal cual está escrito**: ese es el estado *inicial* del envío
  (MOVO-80/105), no el destino de ninguna transición. Implementado como gate en
  `shipment-repository.ts#updateStatus()` cuando `to === published` (la transición
  real que dispara MOVO-16, receptor confirma) — `InsufficientCreationPhotosError`
  nueva en `shipment-state-machine.ts`. Comentado en Linear pidiendo confirmación del
  equipo, sin respuesta todavía.
- **La guía de "lifecycle rule si sobra tiempo" para objetos huérfanos no es trivial**:
  una regla ingenua por edad/prefijo borraría también evidencia ya confirmada (S3 no
  distingue "confirmado" de "no confirmado" por sí solo) — hace falta tagging o un
  prefijo de cuarentena, código nuevo en `svc-users` y `svc-shipments` además del
  cambio de Terraform. Spin-off a MOVO-124 en vez de resolverlo acá.

Pendiente / fuera de alcance: prueba manual end-to-end contra el bucket real de dev
(DoD del ticket, necesita credenciales AWS que no había en el entorno de desarrollo);
el endpoint de MOVO-16 que efectivamente ejercita el gate de AC6 no existe todavía.

Fixes de review (PR #76, tmvergara, antes de mergear):
- **`confirmPhoto` era no-idempotente**: confirmar el mismo `s3Key` dos veces (ej.
  reintento del cliente ante un timeout) insertaba dos filas en `shipment_photos` para
  el mismo objeto de S3, sin nada que lo evitara — el gate de AC6 contaba evidencia
  duplicada. Se agregó `@@unique([shipmentId, s3Key])` en el modelo (migración
  `20260817120000_add_shipment_photos_unique_key`) y `addPhoto()` en
  `shipment-repository.ts` ahora atrapa el `P2002` y devuelve la fila ya existente en
  vez de propagar el conflicto — mismo criterio duck-typed de `isPendingOfferConflict`
  en `offer-repository.ts` (MOVO-102), no el de `driverAdapterError` de `svc-users`
  (acá no hace falta inspeccionar qué campo violó el constraint).
- **`InsufficientCreationPhotosError` nunca se traducía a `ApiError`**: extendía `Error`
  a secas y el error handler solo especializa `instanceof ApiError`, así que apenas el
  gate de AC6 quede alcanzable por HTTP (MOVO-16) iba a devolver un 500 opaco en vez del
  409 con `SHIPMENT_INSUFFICIENT_CREATION_PHOTOS` (código que esta misma US ya había
  agregado a `@movo/shared` pero nunca conectó). Wireado en
  `plugins/error-handler.ts` — mismo patrón de traducción explícita que ya usa para los
  errores de validación de AJV.

Tests: 130/130 en `svc-shipments` (128 de la suite original de esta US +
`photos.integration.test.ts#"confirmar el mismo s3Key dos veces es idempotente"` y
`error-handler.test.ts` nuevo, aislado con una instancia mínima de Fastify porque
todavía no hay ninguna ruta HTTP real que dispare `InsufficientCreationPhotosError`).
`tsc --noEmit` y `eslint` limpios (el único error de `eslint.config.js` es preexistente,
no de este PR).

### MOVO-128 — Endpoint GET /shipments/:id/events (historial de estados) (`svc-shipments`)

`GET /shipments/:id/events` expone el historial completo de cambios de estado de un
envío en orden cronológico ascendente (más antiguo primero), para la línea de tiempo de
MOVO-127.

Decisiones clave:
- **Mismo criterio de autorización que `GET /shipments/:id` (AC8 de MOVO-80)**: solo
  emisor, receptor o admin. Un usuario ajeno recibe 403 `AUTH_FORBIDDEN`, nunca 404
  filtrado. Se extrajo la lógica duplicada a un helper compartido
  `assertShipmentAccess(shipment, callerId, callerRoles)` reutilizado entre
  `getShipmentDetail`, `getShipmentEvents` y `listPhotoUrls` (`photos.service.ts`).
- **Respuesta plana sin paginación ni enriquecimiento**: array de `ShipmentEvent` con
  `fromStatus`/`toStatus` crudos (`ShipmentStatus`), `actorId` como UUID crudo (sin
  acceso cruzado a `users.users`, ADR-003). `fromStatus` es `null` únicamente en el
  evento inicial de creación.

### MOVO-108 / MOVO-29 (alcance acotado) — Notificaciones push al crear envío + cancelación temprana (`svc-shipments`)

`src/adapters/notifications-client.ts` (nuevo): cliente HTTP interno hacia
`POST /internal/notifications/push` de `movo-svc-users` (MOVO-106), reusa
`USERS_SERVICE_URL`. A diferencia de `users-client.ts`, `sendPush` **nunca rechaza**
— atrapa y loguea cualquier fallo (`event: "notification_dispatch_failed"`) adentro,
así el best-effort de AC5 es una garantía del cliente, no algo que cada caller tenga
que recordar. `shipments.service.ts#createShipment` lo dispara al receptor tras crear
el envío (AC1); cada caller igual lo envuelve en un try/catch mudo como defensa en
profundidad, no como la garantía principal.

**AC2/AC3 de MOVO-108 (notificar en creación/aceptación de oferta) descartados de esta
pasada**: no existe `offer-service.ts` ni ninguna ruta HTTP de ofertas — MOVO-102 solo
entregó dominio/repositorio, y MOVO-23/MOVO-17 (quienes agregarían esa capa) siguen en
Backlog sin asignar. Documentado en comentarios de esas dos issues, para retomarlo ahí
cuando entren en refinamiento.

**MOVO-29 (cancelación de envío) no tenía diseño técnico propio** — se diseñó e
implementó acá porque bloqueaba AC7 de MOVO-108 (detalle completo en el comentario de
MOVO-108 en Linear). `shipments.service.ts#cancelShipment` es 100% orquestación nueva
sobre piezas que ya existían sin que nadie las hubiera conectado:
`shipment-state-machine.ts` (MOVO-105) ya modelaba las 4 transiciones de cancelación,
y `shipment-repository.ts#updateStatus(id, to, actorId, reason?)` (MOVO-104) ya
persistía el motivo en `ShipmentEvent` — no hizo falta tocar ninguna de las dos.
`POST /shipments/:id/cancel` nuevo en `shipments.routes.ts`, solo el emisor puede
cancelar.

- **Alcance acotado a los 3 estados sin penalización** (`awaiting_receiver_confirmation`/
  `published`/`assignment_pending`, mismo criterio de recorte que AC2/AC3 de arriba):
  `svc-payments` hoy es un esqueleto puro (una ruta `GET /` de stub), sin holds ni
  capture reales. Cancelar desde `assigned` queda bloqueado con 409
  `SHIPMENT_CANCELLATION_PENALTY_NOT_SUPPORTED` (chequeo explícito antes de tocar la
  máquina de estados, que sí modela esa transición para cuando la integración exista)
  en vez de permitir la transición sin su consecuencia de negocio. La liberación del
  hold de MercadoPago al cancelar desde `assignment_pending` (parte del AC de MOVO-29)
  tampoco se implementa por el mismo motivo.
- **AC7 de MOVO-108** vive en el mismo método: si el estado previo era `published` o
  `assignment_pending`, se listan las ofertas `pending` (`offerRepository.listByShipment`)
  y se notifica a cada transportista, best-effort.
- **Gap encontrado al implementar (mismo patrón que `InsufficientCreationPhotosError`
  de MOVO-81)**: `InvalidShipmentTransitionError` nunca se traducía a `ApiError` —
  cancelar un envío ya en un estado terminal (`delivered`, `cancelled`, etc.) tiraba
  500 genérico en vez de 409. Wireado en `plugins/error-handler.ts` con el código
  nuevo `SHIPMENT_INVALID_TRANSITION` (`@movo/shared`, junto con
  `SHIPMENT_CANCELLATION_PENALTY_NOT_SUPPORTED`).

Tests: 168/168 en `svc-shipments` (17 suites, incluye `shipments-cancel.integration.test.ts`
nuevo contra Postgres real + 2 casos sumados a `shipments-create.integration.test.ts` +
33 unitarios nuevos/actualizados en `shipment-service.test.ts`/`notifications-client.test.ts`).
`shipments.service.ts` 100% statements / 96.42% branches. `tsc --noEmit` y `eslint`
limpios. Gotcha de entorno (no de la implementación): el volumen local de Postgres
preexistente tenía `pg_hba.conf` en `trust` para conexiones desde dentro del propio
contenedor pero `scram-sha-256` real para las que llegan por el port-forward desde el
host — cualquier password "andaba" al conectar vía `docker exec`, sin verificarse en
serio; hubo que resetear la password del rol (`ALTER ROLE`, no toca datos) para poder
correr el suite real contra Postgres.

Pendiente / fuera de alcance: liberación del hold de MercadoPago y cancelación con
penalización desde `assigned` (bloqueadas por `svc-payments`, ver arriba); AC2/AC3 de
MOVO-108 (ver comentarios en MOVO-23/MOVO-17).

### MOVO-129 — Endpoints de aceptación y rechazo del envío por el receptor (`svc-shipments`)

`POST /shipments/:id/accept` y `POST /shipments/:id/reject` (backend de MOVO-16) permiten
al receptor confirmar un envío (transición a `published`) o rechazarlo (transición a
`rejected_by_receiver`, terminal).

Decisiones clave:
- **Autorización estricta al receptor (`assertIsReceiver`)**: solo `shipment.receiverId`
  puede aceptar o rechazar (403 `AUTH_FORBIDDEN` para el emisor, admin o terceros).
  Ubicada en `assert-shipment-access.ts` junto a `assertShipmentAccess`.
- **Mapeo de error de transiciones inválidas**: `InvalidShipmentTransitionError` se mapea
  a HTTP 409 con el código `SHIPMENT_INVALID_TRANSITION` en `@movo/shared` y en
  `error-handler.ts` (cubre doble tap, envíos ya cancelados o ya rechazados).
- **Push notifications best-effort y no bloqueantes al emisor**: `NotificationsClient`
  (`src/adapters/notifications-client.ts`) invoca internamente a `POST /internal/notifications/push`
  en `movo-svc-users`. El despacho (`dispatchReceiverDecisionPush`) se realiza en modo
  fire-and-forget (sin `await` en el handler) para no sumar latencia ni riesgo de timeout
  a la respuesta HTTP. Si falla o hace timeout, se loguea `notification_dispatch_failed`.
- **Receptor no edita campos del envío (AC7)**: el body de `/accept` (`acceptShipmentBody`,
  `additionalProperties: false`) no admite campos y el de `/reject` solo admite
  `{ reason?: string }` (persistido en `shipment_events.reason`). Ojo: Fastify trae
  `removeAdditional: true` como default de AJV, así que los campos de más se **descartan
  en silencio** en vez de devolver 400 — el AC se cumple igual (no llegan al envío
  persistido) y el test lo verifica así, pero no esperes un `VALIDATION_FAILED`. Cambiar
  eso requiere `ajv.customOptions.removeAdditional: false`, que aplica a todos los
  endpoints del servicio y es una decisión de convención pendiente, no un ajuste local.
- **Body vacío con `content-type: application/json`**: el parser JSON por defecto de
  Fastify falla con `FST_ERR_CTP_EMPTY_JSON_BODY` (400) antes de la validación de schema,
  así que declarar el body como `nullable: true` **no alcanza**. `app.ts` registra un
  `addContentTypeParser` que mapea el body vacío a `null` y el JSON inválido a un
  `ApiError(400, VALIDATION_FAILED)` (un `Error` suelto caería al 500 genérico del
  error handler). Aplica a todo el servicio, no solo a los endpoints del receptor.

### MOVO-130 — Expiración automática del envío no confirmado por el receptor (`svc-shipments`)

Expiración automática por timeout de envíos en `awaiting_receiver_confirmation` (AC6 de MOVO-16).
Persiste `receiver_confirmation_deadline` (`createdAt + RECEIVER_CONFIRMATION_TIMEOUT_HOURS`, default 48h),
lo expone en DTOs para el mobile (MOVO-131), valida deadline vencida en `POST /accept` y `POST /reject` (HTTP 409
`SHIPMENT_RECEIVER_CONFIRMATION_EXPIRED`), y ejecuta un barrido periódico asíncrono en segundo plano vía plugin de
Fastify con `setInterval` y lock distribuido en Redis.

Decisiones clave:
- **Columna nullable `receiver_confirmation_deadline`**: `timestamptz` en `shipments.shipments` (migración
  `20260820120000_add_receiver_confirmation_deadline`). Los envíos preexistentes quedan en `NULL` y no expiran
  (backfill explícitamente descartado).
- **Validación anticipada de deadline en `/accept` y `/reject` (AC5)**: la deadline manda sobre el reloj del job; si el
  plazo ya venció, responde 409 `SHIPMENT_RECEIVER_CONFIRMATION_EXPIRED` inmediatamente aunque el barrido periódico
  todavía no haya corrido.
- **Barrido como plugin de Fastify con `setInterval` y Redis lock**: sin infra de cron/jobs separada (ADR-006). Adquiere
  lock `locks:receiver-confirmation-sweep` en Redis con TTL del 80% del intervalo antes de cada corrida para evitar
  duplicación en caso de múltiples réplicas. Procesa en lotes (100 por corrida) y transiciona a `cancelled` con `actorId: null`
  y reason `"El receptor no confirmó dentro del plazo"`.
- **Notificación push best-effort al emisor**: envía push (`"Tu envío se canceló: {Nombre} no lo confirmó a tiempo"`)
  tras la cancelación sin frenar el procesamiento si falla.
- **Configuración**: `RECEIVER_CONFIRMATION_TIMEOUT_HOURS` (default 48), `RECEIVER_CONFIRMATION_SWEEP_INTERVAL_MINUTES` (default 15)
  y `RECEIVER_CONFIRMATION_SWEEP_ENABLED` (default true, desactivable en tests/CI).
- **La deadline se persiste siempre como instante real, nunca como reloj de pared**: es
  `min(now + timeout, cierre de la ventana de retiro)`, y ese cierre sale de
  `combineDateAndTime`, que ancla la hora local argentina como si fuera UTC (ver el
  gotcha de timezone de MOVO-80) — hay que pasarlo por `toRealInstant()` antes de
  compararlo o guardarlo junto a valores como `Date.now()`, o el plazo queda 3h corrido
  y un envío puede nacer ya vencido.
- **Índice compuesto descartado**: con el volumen de envíos del PF el índice `shipments_status_idx` existente
  alcanza para la consulta del barrido; el costo de mantener un índice adicional no se justifica. Si el volumen
  creciera, el candidato sería `(status, receiver_confirmation_deadline)`.

### MOVO-134 — Endpoint interno de solo lectura para baja de cuenta (`svc-shipments`)

`GET /internal/account-deletion/users/:userId/active-shipments` (`src/modules/account-deletion/`),
consultado por `svc-users` antes de aplicar una baja de cuenta (ticket completo en
`services/movo-svc-users/CLAUDE.md`). Primera llamada síncrona en sentido
`svc-users` → `svc-shipments` — hasta ahora todas las llamadas internas del proyecto
iban al revés (`users-client.ts`, MOVO-80).

Decisiones clave:
- **De solo lectura, no cancela nada**: decisión de refinamiento del ticket —
  bloquear la baja con 409 si hay algo activo, sin cascada de cancelación
  automática. El usuario cancela por su cuenta (endpoints ya existentes) y reintenta.
- **`hasActiveShipmentsForUser()` separa `disputed` del resto de los estados no
  terminales**: el mensaje de error del lado de `svc-users` es distinto para cada
  caso (una disputa la resuelve un admin, no el usuario cancelando).
- **Sin transición `in_transit → cancelled` agregada al grafo de MOVO-105**: se
  evaluó y se descartó — un envío en tránsito bloquea la baja igual que una
  disputa, sin cascada. Cancelar un envío con el paquete físicamente en manos de un
  transportista es una decisión de producto/operativa aparte (¿devolución?
  ¿penalización?), fuera de alcance de este ticket.
- **Interno, no proxeado por el gateway** (`schema: { hide: true }`, no aparece en
  la Swagger pública) — mismo criterio que `/internal/notifications` de `svc-users`
  (MOVO-106).

Tests: `test/account-deletion.integration.test.ts` (11 casos, Postgres real) —
cubre las 3 combinaciones de rol (sender/receiver/carrierId), todos los estados no
terminales, los 3 terminales, y un usuario con disputa + envío activo simultáneos.
### MOVO-118 — Race condition (TOCTOU) en `shipment-repository.ts#updateStatus()`

Cierra la ventana de carrera aceptada desde MOVO-104: dos transiciones concurrentes
sobre el mismo envío (ej. transportista acepta oferta a la vez que el emisor cancela)
ya no se pisan sin revalidar.

- **Compare-and-swap, no `SELECT...FOR UPDATE`**: pese a que el ticket proponía mover
  el `findUnique` a `SELECT...FOR UPDATE` vía `$queryRaw`, se adoptó el mismo patrón
  que `offer-repository.ts#acceptOffer` (MOVO-102/AC9), ya probado en este mismo
  servicio: `tx.shipment.updateMany({where: {id, status: from}, ...})` condicionado
  por el `status` leído. Bajo READ COMMITTED, el `UPDATE` toma el row-lock; la
  transacción perdedora reevalúa su `WHERE` contra el dato ya commiteado
  (EvalPlanQual) y `count` da 0 — sin SQL crudo, sin abrir una segunda vía de acceso a
  la tabla.
- **`ShipmentConcurrentModificationError` nueva** (`shipment-repository.ts`, mismo
  criterio que `OfferConcurrentModificationError`), mapeada a 409
  `SHIPMENT_CONCURRENT_MODIFICATION` (`@movo/shared`/`error-handler.ts`).
- **Fila devuelta reconstruida a mano** (`{...current, status: to, ...}`) en vez de un
  `SELECT` extra post-`UPDATE` — `updateMany` no devuelve la fila, mismo criterio que
  el objeto `accepted` de `acceptOffer`.
- El comentario de `offer-repository.ts` que explicaba por qué `acceptOffer` no
  reusaba `updateStatus()` ("no ofrece bloqueo optimista") quedó desactualizado y se
  corrigió: la razón real es que `updateStatus()` abre su propia `$transaction`, no
  anidable dentro de la transacción única que necesita `acceptOffer` para
  shipment+offer+evento atómicos.

Test de integración nuevo (`shipment-repository.integration.test.ts`): dos
`updateStatus()` concurrentes desde `published` (`Promise.allSettled`, una a
`assignment_pending` y otra a `cancelled`) — exactamente una resuelve,
la otra lanza `ShipmentConcurrentModificationError`, y el envío persiste solo el
estado de la transición ganadora (verificado 5/5 corridas sin flakiness).

**Merge MOVO-108 ↔ MOVO-129/130 (`develop`)**: ambos ramas habían escrito
`notifications-client.ts` en paralelo con contratos distintos — MOVO-108 lo hacía
best-effort *adentro* del cliente (nunca rechaza, loguea internamente); MOVO-129/130 lo
dejaban rechazar y resolvían el best-effort en cada caller. Se unificó al segundo
criterio (ya usado por 3 sitios de llamada en `develop` contra 2 de MOVO-108) — los dos
sitios de MOVO-108 (`createShipment`, `cancelShipment`) se adaptaron al mismo patrón
try/catch + `logger?.warn` que ya usaban `acceptShipment`/`rejectShipment`/
`expireOverdueShipments`. `createShipmentsService()` también cambió de firma:
`offerRepository` (que solo necesita `cancelShipment`) pasó a viajar en
`ShipmentsServiceOptions.offerRepository` en vez de como parámetro posicional propio,
para no romper la firma `(repository, usersClient, notificationsClient?, logger?, opts)`
que ya usaban `acceptShipment`/`rejectShipment`/el barrido de MOVO-130.

### MOVO-82 — Precio sugerido vía `movo-svc-pricing-logistics` (ADR-018)

Reemplaza el placeholder inline de MOVO-80 (`computePlaceholderPrice`/fórmula
hardcodeada en `shipments.service.ts`, eliminado): `createShipment` ahora pide el
precio a `movo-svc-pricing-logistics` (`POST /quote`, ver su `CLAUDE.md`) vía
`src/adapters/pricing-client.ts` nuevo.

Decisiones clave:
- **`pricing-client.ts` nunca lanza** (a diferencia de `users-client.ts`): cualquier
  falla de red/timeout/respuesta no-ok, o datos incompletos (peso/dimensiones/
  coordenadas), resuelve a `{ suggestedPriceArs: null, calculationMethod: null }` —
  acá el fallback es un resultado de negocio válido ("precio a estimar", AC6 del
  ticket), no un fallo de transporte que deba abortar la creación del envío. Timeout
  de 3000ms (más corto que los 5000ms de `users-client.ts`: degradar es gratis, no
  vale la pena esperar tanto).
- **Guard de datos incompletos (AC7) documentado como código muerto hoy**: con el
  schema actual de `createShipmentBody` (todos los campos numéricos requeridos), la
  rama nunca se ejercita vía `POST /shipments` — queda ahí para cuando MOVO-83 (el
  wizard mobile, bloqueado por este ticket) reuse el mismo cliente desde un paso con
  datos todavía parciales.
- **`suggestedPriceArs`/`calculationMethod` nullables** (antes `suggestedPriceArs`
  era `NOT NULL`): migración `20260822170000_add_pricing_calculation_method`
  (`ALTER COLUMN ... DROP NOT NULL` + `ADD COLUMN calculation_method`). Envíos
  preexistentes conservan su precio actual y quedan con `calculationMethod: null` —
  backfill descartado a propósito, no hay forma de inferir retroactivamente qué
  fórmula produjo un precio ya persistido (AC8: nunca se recalcula, y en efecto nada
  en el repo vuelve a escribir el campo después de `create()`).
- **`haversineKm` ya no alimenta el precio**, sigue viva solo para la validación de
  umbral de MOVO-126 (retiro/entrega no pueden estar a menos de 100m).
- **`pricingClient` viaja en `ShipmentsServiceOptions`** (no como parámetro
  posicional propio de `createShipmentsService`), mismo criterio que
  `offerRepository` (MOVO-108/129/130): evita romper la firma que ya usan
  `acceptShipment`/`rejectShipment`/el barrido de MOVO-130, que nunca lo necesitan.

Tests: `test/fake-pricing-client.ts` nuevo (mismo patrón que `fake-users-client.ts`).
`shipment-service.test.ts` con 3 casos de `createShipment` (precio real vía
`pricingClient`, fallback si el cliente falla, fallback si no hay cliente inyectado) +
`shipments-create.integration.test.ts` con el caso end-to-end de AC6
(`pricingClient` inyectado que falla → `POST /shipments` responde 201 con
`suggestedPriceArs: null`).
### MOVO-124 — Sweep de fotos huérfanas en S3 vía tracking en Redis (`svc-shipments` + `svc-users`)

Reemplaza las dos opciones de lifecycle rule de S3 que había dejado planteadas MOVO-81
(tagging + `PutObjectTagging`/prefijo de cuarentena + `CopyObject`) por un mecanismo que
no toca Terraform ni bucket policy: cada presign registra su key en un sorted set de
Redis (`photos:pending:shipments` acá, `photos:pending:profile-photos` en `svc-users`,
score = timestamp), `confirmPhoto()` la saca del set al confirmar, y un plugin nuevo
(`src/plugins/orphan-photo-sweep.ts`, mismo esqueleto `setInterval` + lock distribuido
en Redis que `receiver-confirmation-sweep.ts` de MOVO-130) barre periódicamente las keys
más viejas que `ORPHAN_PHOTO_RETENTION_HOURS` (default 24, igual que sugería el ticket)
y borra de S3 (`storageProvider.deleteObject`, nuevo en la interfaz) las que siguen sin
confirmar. Decisión completa (por qué Redis en vez de las dos opciones del ticket)
comentada en MOVO-124 (Linear).

Decisiones clave:
- **AC3 ("objetos confirmados nunca se ven afectados, verificado explícitamente") no
  se apoya solo en Redis**: el `ZREM` de `confirmPhoto()` es best-effort (si Redis
  falla ahí, la key queda en el set pese a estar confirmada) — así que antes de
  cualquier `deleteObject` el sweep revalida contra Postgres
  (`shipment-repository.ts#existsPhotoByS3Key`, nuevo). Si el candidato tiene fila en
  `shipment_photos`, se lo destrackea de Redis sin tocar el objeto de S3. Postgres
  sigue siendo la única fuente de verdad de "confirmado"; Redis es solo la lista de
  candidatos a evaluar.
- **Falla segura si Redis pierde el tracking** (reinicio, TTL manual, etc.): una key
  que nunca se registró o que se pierde del set queda huérfana para siempre — mismo
  estado que el bug original de MOVO-81/124, no una regresión nueva. El riesgo
  inverso (borrar algo confirmado) está cubierto por el chequeo de Postgres de arriba,
  no por confiar en que Redis nunca pierda datos.
- **No se ató la ventana de retención al TTL de la presigned URL** (300s, solo acota
  el `PUT`): la confirmación puede demorar mucho más que la subida (el cliente sube la
  foto y recién confirma en una sesión posterior), así que ligar el sweep a esos 300s
  habría borrado objetos legítimos todavía no confirmados.
- **Sin permisos IAM nuevos**: el statement de `s3:DeleteObject` que agregó MOVO-97 para
  `deletePhoto()` nunca estuvo restringido al prefijo `profile-photos/*` — se escribió
  sobre el bucket entero (`arn:aws:s3:::movo-shipment-media-{dev,prod}/*`, sin condición
  de prefijo) tanto en el rol de IAM (`movo-{dev,prod}-ec2-role`) como en el bucket
  policy. Verificado con `aws iam simulate-principal-policy` contra una key de
  `shipments/*` real: `s3:DeleteObject` da `allowed` en dev y en prod sin tocar nada de
  `movo-infra` — el pendiente que había quedado anotado acá (ver más abajo, corregido)
  estaba desactualizado. Ninguna de las dos opciones originales del ticket
  (tagging/`CopyObject`) hacía falta tampoco.
- **`svc-users` recibió el mismo mecanismo en paralelo** (`existsByPhotoUrl` en
  `user-repository.ts`, mismo plugin `orphan-photo-sweep.ts` — primer scheduled job de
  ese servicio) — ver `services/movo-svc-users/CLAUDE.md`.

Tests: `test/orphan-photo-sweep.test.ts` nuevo (mockeado, cubre habilitado/deshabilitado,
lock de Redis, y explícitamente el caso AC3 — candidato con fila en Postgres nunca
dispara `deleteObject`). `test/photos.integration.test.ts` ampliado con dos casos contra
Redis real (la key queda en el sorted set tras el presign, sale tras confirmar). Suite
completa 234/234, `tsc --noEmit` y `eslint` limpios.

**Fix de review (PR #96, tmvergara) — TOCTOU real entre `confirmPhoto()` y el sweep**:
el chequeo de AC3 contra Postgres (arriba) y el `deleteObject` del sweep no eran
atómicos entre sí — una confirmación que llega justo pasado `ORPHAN_PHOTO_RETENTION_HOURS`
(esperable, ver la nota de arriba sobre no atar la retención al TTL de la presigned URL)
podía intercalarse: el sweep lee "no confirmada" en Postgres, `confirmPhoto()` termina de
commitear la fila, el sweep borra el objeto de todos modos — la foto queda "confirmada"
en la DB apuntando a un objeto ya borrado, sin ningún error visible (justo lo que AC3 dice
garantizar). Se agregó un lock por key de S3 en Redis (`SET NX PX`, TTL 5s,
`photoConfirmationLockKey()` en `photos.service.ts`), tomado tanto por `confirmPhoto()`
como por cada candidato del sweep antes de tocar S3/Postgres — quien llega primero se
queda con la key; el otro se corre (`confirmPhoto()` responde `409
PHOTO_CONFIRMATION_IN_PROGRESS`, código nuevo en `@movo/shared`; el sweep salta el
candidato y lo reevalúa en la próxima corrida). Mismo mecanismo espejado en
`services/movo-svc-users/src/modules/users/users.service.ts` (mismo bug, mismo fix).
Liberación del lock sin `try/catch` propio, mismo criterio que `account-deletion-lock`
de `svc-users` (MOVO-134): si el `unlink` fallara, expira solo por TTL.

**Verificación de AWS (sin cambios en `movo-infra`)**: confirmado con
`aws iam simulate-principal-policy` que `s3:DeleteObject` sobre `shipments/*` ya da
`allowed` en dev y prod — el statement de MOVO-97 nunca estuvo restringido a
`profile-photos/*` (bucket entero, sin condición de prefijo). No hacía falta ningún
`terraform apply` ni cambio manual de IAM para este ticket.

### MOVO-144 — GET /shipments/:id/offers y aceptación/rechazo de oferta por el emisor (`svc-shipments`)

Capa HTTP sobre el dominio que ya había entregado MOVO-102 (`offer-repository.ts`,
sin conectar a HTTP hasta ahora): `GET /shipments/:id/offers` (en
`shipments.routes.ts`/`.service.ts`) y el módulo nuevo `src/modules/offers/`
(`POST /offers/:id/accept`, `POST /offers/:id/reject`). Es el endpoint que cierra el
eslabón "el emisor elige un transportista" (MOVO-17) — acepta deja el envío en
`assignment_pending` **con** `carrierId`, nunca en `assigned` (esa transición la cierra
el hold de fondos de MOVO-12, fuera de este ticket).

Decisiones clave:
- **Autorización asimétrica entre lectura y escritura**: el listado usa
  `assertIsSenderOrAdmin` (emisor+admin, el receptor no participa de la negociación de
  ofertas — 403), mientras que accept/reject usan `assertIsSender`, estricto y sin
  admin (mismo criterio que `assertIsReceiver` de MOVO-129: acción de negocio, no
  lectura). Ambos helpers nuevos en `assert-shipment-access.ts`, junto a los que ya
  existían.
- **`listShipmentOffers` vive en `shipments.service.ts`, no en el módulo `offers`**:
  la ruta cuelga de `/shipments/:id/offers` (mismo prefijo que el resto de las rutas
  de lectura de un envío — `/:id/events`, `/:id/photos`), así que reusa el
  `offerRepository` que `shipments.service.ts` ya recibía opcionalmente desde MOVO-108
  (antes solo para `cancelShipment`). Sort local en memoria (`price` asc default,
  `rating` desc con nulls siempre al final, `createdAt` asc) — con los snapshots ya
  guardados por MOVO-102 no hace falta ORDER BY en SQL ni llamar a `svc-users`.
- **4 códigos de error nuevos en `@movo/shared`** (`OFFER_NOT_FOUND`,
  `SHIPMENT_NOT_AVAILABLE_FOR_ASSIGNMENT`, `OFFER_CONCURRENT_MODIFICATION`,
  `OFFER_INVALID_TRANSITION`) para traducir a HTTP los errores de dominio de
  `offer-repository.ts`/`offer-state-machine.ts` que MOVO-102 ya lanzaba pero que
  nunca habían llegado a `error-handler.ts` por no existir todavía la capa HTTP.
- **`offers.routes.ts` bajo prefijo `/offers` propio, no anidado en `/shipments`**
  (`POST /offers/:id/accept` y `/reject`, no `POST /shipments/:id/offers/:offerId/...`)
  — sigue el shape del contrato tal como lo pide el AC del ticket. Requirió agregar una
  entrada nueva a `gateway/src/config/routes-map.ts#getServiceRoutes()` (mismo
  `SHIPMENTS_SERVICE_URL`, mismo criterio que `/kyc`/`/geocode`/`/addresses`/`/places`
  con `svc-users`): el gateway rutea por prefijo explícito, sin catch-all, así que sin
  esa entrada `/api/v1/offers/*` no se proxea.
- **Notificaciones (AC9) sin extender `notifications-client.ts`**: ya es genérico
  (`sendPush({ userId, title, body, data })` desde MOVO-108/129) — `offers.service.ts`
  solo arma tres payloads nuevos (`offer_accepted` al ganador, `offer_superseded` a
  cada oferta desplazada por el mismo `acceptOffer()`, `offer_rejected` al rechazado),
  todos fire-and-forget con try/catch, mismo patrón que
  `dispatchReceiverDecisionPush`.
- **AC10 (`carrierId` en `GET /shipments/:id`) ya estaba resuelto desde MOVO-80/102**:
  la columna y el mapeo (`shipment-repository.ts`/`shipments.schema.ts`) ya existían,
  sin necesidad de tocarlos.

Tests: `test/offers-accept-reject.integration.test.ts` (nuevo, 13 casos: aceptación
feliz con verificación de `assignment_pending`+`carrierId`+ofertas `superseded`,
oferta vencida → 409 `OFFER_INVALID_TRANSITION`, doble aceptación concurrente
(`Promise.allSettled`) → una gana y la otra 409, rechazo puntual con el envío
persistiendo `published`, reoferta tras rechazo, autorización 403/401/404) y
`test/shipments-offers-list.integration.test.ts` (nuevo, 9 casos: autorización,
sort por precio/rating con nulls al final, filtro vigentes vs `includeResolved`).
Suite completa del servicio 268/268, `tsc --noEmit` y `eslint` limpios. Confirmado
además que el Swagger generado (`app.swagger()`) expone los 3 paths nuevos.

Pendiente / fuera de alcance: negociación encadenada y cualquier UI de mobile
(MOVO-150, bloqueado por este ticket).

Fixes de review (PR #105, JcBordino4, antes de mergear): `listShipmentOffers` ya no
lista ofertas `pending` de un envío que dejó de estar `published`/`assignment_pending`
(ej. cancelado) como vigentes/accionables — filtra también por `shipment.status`, no
solo por el status de la oferta (`includeResolved=true` las sigue mostrando en el
historial). `offerRepository.acceptOffer()` devuelve las ofertas `superseded`
(`id`+`carrierId`) directo de la misma transacción, así `offers.service.ts` ya no hace
un `listByShipment` completo aparte solo para saber a quién notificar el AC9.
`toOfferDto` (duplicado entre `offers.routes.ts` y `shipments.routes.ts`) extraído a
`offer.dto.ts`. Del lado mobile, `use-push-notifications.ts` reconoce también
`offer_accepted`/`offer_superseded`/`offer_rejected` (antes solo `shipment`) — tocar
esas pushes navegaba a un dead-end.

### MOVO-146 — Schema de Rating y endpoint de calificación post-entrega (`svc-shipments`)

Backend de MOVO-22 (calificaciones): persiste en `shipments.ratings` (no en
`svc-users`, que es donde se MUESTRA la reputación) porque autorizar un alta necesita
saber quién participó del envío y si ya está `delivered` — dato que solo tiene este
servicio (detalle en el comentario del ticket en Linear). Módulo nuevo
`src/modules/ratings/`: `POST`/`PATCH /shipments/:id/ratings(/:rateeId)`,
`GET /shipments/:id/ratings`, `GET /internal/users/:id/ratings/recent` (interno, para
el agregado de MOVO-25, todavía sin arrancar del lado de `svc-users`).

Decisiones clave:
- **Ventana de 72hs (AC8) y freeze por disputa (AC9) sin columna nueva**
  (`src/domain/rating-window.ts`): el instante de entrada/salida de `disputed` ya
  está en `shipment_events` (MOVO-104) — el tiempo total pasado en disputa se
  reconstruye recorriendo el historial en cada request, mismo criterio de evaluación
  perezosa que `expired` en ofertas (MOVO-102) o `receiverConfirmationDeadline`
  (MOVO-130). Hoy `disputed` no tiene salida modelada (`shipment-state-machine.ts`,
  MOVO-105) así que el freeze siempre resuelve a 0 en la práctica — queda listo para
  cuando esa transición exista, sin tener que revisitar el cálculo.
- **PATCH interpretado como `/shipments/:id/ratings/:rateeId`** (rateeId en el path):
  el AC5 solo pide "editar vía PATCH sobre la misma fila" sin fijar la forma —
  raterId sale siempre del caller, rateeId identifica la fila junto con shipmentId,
  sin duplicar el campo en path+body.
- **Unicidad (AC2) 100% en la base** (`ratings_shipment_rater_ratee_key`), traducida a
  409 `SHIPMENT_RATING_ALREADY_EXISTS` en `error-handler.ts` — mismo patrón que
  `ShipmentConcurrentModificationError`/`InsufficientCreationPhotosError`.
- **`GET /shipments/:id/ratings` habilita a admin además de las partes** (extensión
  sobre el AC6 literal, "para sus participantes" — confirmada con el equipo, comentario
  en Linear), con una función de autorización local a `ratings.service.ts` en vez de
  reusar `assertShipmentAccess` — ese helper no conoce `carrierId` como parte legítima,
  y acá el transportista sí es parte de una calificación.
- **Migración (`20260825203000_create_ratings_table`) generada con
  `prisma migrate diff` schema-a-schema**, aplicada y verificada con
  `prisma migrate deploy` contra Postgres real (`infra/docker-compose.yml`, levantado
  para esta US).

Tests: `test/rating-window.test.ts` (dominio puro, incluye acumulación de dos
disputas separadas), `test/ratings-service.test.ts` (mocks — alta, edición, listado,
los 3 casos de 403, los tres 409 de estado, propagación de `DuplicateRatingError`),
`test/ratings.integration.test.ts` (Postgres real — cubre el DoD del ticket: alta
feliz, no entregado, calificador/calificado ajenos, autocalificación, doble alta,
score fuera de rango, ventana vencida, disputa activa, PATCH, listado, endpoint
interno). Suite completa del servicio: 284/284 (25 archivos), corrida contra
Postgres/Redis reales — `modules/ratings` 100% statements / 97.22% branches (única
rama sin cubrir: `createRating` sin `notificationsClient` inyectado, camino
inalcanzable en producción ya que `ratings.routes.ts` siempre construye uno por
default). `tsc --noEmit` y `eslint` limpios (`src` y `shared/movo-shared`).

Pendiente / fuera de alcance: consumo real desde `svc-users` (MOVO-25, agregado
ponderado + lectura de este endpoint interno) y desde el mobile (MOVO-153, bloqueado
por este ticket) — ninguno de los dos arrancó todavía.

### MOVO-147 — Score de reputación ponderado y endpoint interno de agregado (`svc-shipments`)

Backend del cálculo de MOVO-25: `src/domain/reputation.ts` (nuevo, función pura sobre
una lista de `{score, createdAt}`, mismo criterio que `shipment-state-machine.ts`) +
`GET /internal/users/:id/reputation` (`ratings.routes.ts`/`ratings.schema.ts`, mismo
módulo interno de MOVO-146). Combina shrinkage bayesiano hacia la media global de la
plataforma (`C=5`, env `REPUTATION_CONFIDENCE_CONSTANT`) con decaimiento temporal
(semivida 180 días, env `REPUTATION_DECAY_HALF_LIFE_DAYS`) reemplazando `n`/`Σscores`
de la fórmula de shrinkage por su versión ponderada por el peso de decaimiento de cada
calificación.

Decisiones clave:
- **`reputationScore` nunca es el único campo que viaja**: `computeReputationScore`
  siempre devuelve `{ reputationScore, ratingCount, isNewProfile }` -- `reputationScore`
  es `null` solo con cero calificaciones (AC2), pero `isNewProfile` (`ratingCount < 3`,
  `MIN_RATINGS_FOR_ESTABLISHED_PROFILE`) viaja igual con 1 o 2 calificaciones, donde el
  score ya existe pero la decisión de mostrarlo ("Perfil nuevo" o no) es de
  presentación, no del motor.
- **`asSender`/`asCarrier` son el MISMO cálculo restringido por `role`** (el rol del
  CALIFICADO en cada envío puntual, `models/rating.ts` de MOVO-146, no un rol de
  cuenta) -- tres llamadas a la misma función pura sobre subconjuntos filtrados del
  array de calificaciones del usuario, no tres fórmulas distintas. Las calificaciones
  en rol `receiver` entran al global pero no tienen desglose propio (AC3 solo pide
  sender/carrier, la reputación que importa al elegir una oferta).
- **AC6 (agregado vía query, no trayendo filas a memoria) resuelto distinto según qué
  se necesita**: `transactionCounts` (envíos `delivered` como sender/carrier, lo que
  hoy `svc-users` hardcodea en `placeholderTransactionCounts()`) usa dos `COUNT()`
  independientes (`shipment-repository.ts#countCompletedTransactions` -- `senderId`/
  `carrierId` son columnas distintas de la misma fila, no agrupables con un único
  `groupBy`); la media global `m` usa un único `AVG()` sobre TODA la tabla `ratings`
  (`rating-repository.ts#getGlobalAverageScore`, salteado si el usuario no tiene
  ninguna calificación propia). El decaimiento, en cambio, SÍ trae filas a memoria --
  pero acotadas a un único `rateeId` (`listForReputation`, nunca la tabla completa),
  porque necesita `createdAt` por fila y AC1 pide que sea una función pura testeable al
  detalle; replicar la fórmula de decaimiento en SQL habría duplicado la lógica de
  negocio en dos lugares. Elección explícita, documentada acá tal como pide el AC.
- **`ratings.service.ts#getReputationSummary` recibe `reputationConfig` opcional en la
  construcción** (`{confidenceConstant, decayHalfLifeDays}`, mismo criterio que
  `receiverConfirmationTimeoutHours` de `shipments.service.ts`), con default igual al
  de `envSchema` -- red de seguridad para callers que no pasan por `ratings.routes.ts`
  (tests, y el futuro `offers.service.ts` de MOVO-23), nunca una segunda fuente de
  verdad para el valor real de `C`/semivida.
- **AC5 (creación de oferta lee el agregado LOCALMENTE) queda listo pero sin
  conectar**: MOVO-23 ("crear una oferta") sigue sin implementar del lado HTTP
  (`offer-repository.ts#create` existe desde MOVO-102, sin ruta) -- `getReputationSummary`
  ya es una función de servicio importable directo (mismo proceso, misma DB), lista
  para que ese ticket futuro la llame al snapshotear `carrierRatingAtOffer` sin HTTP
  contra sí mismo.

Tests: `test/reputation.test.ts` (dominio puro -- sin calificaciones, una sola de 5 con
`C=5` lejos de 5.0, muchas consistentes convergen a la media real, vieja pesa menos que
reciente, `isNewProfile` en los dos umbrales, redondeo a un decimal), casos nuevos en
`test/ratings-service.test.ts` (desglose por rol sin mezclar, `transactionCounts`
pasa-through, default de `reputationConfig`) y en `test/ratings.integration.test.ts`
(Postgres real: sin calificaciones, `isNewProfile` en los dos umbrales, rol nunca
calificado sin contaminar, `transactionCounts` solo cuenta `delivered`). Suite completa
del servicio: 324/324 (28 archivos). `tsc --noEmit` y `eslint` limpios en los archivos
tocados por este ticket (los 14 errores de `no-explicit-any` que reporta `eslint` sobre
`test/orphan-photo-sweep.test.ts`/`test/receiver-confirmation-sweep.test.ts` son
preexistentes, no de este PR).

Pendiente / fuera de alcance: consumo real desde `svc-users` (MOVO-152, perfil con
reputación y contadores reales -- bloqueado por este ticket, sin arrancar) y desde
MOVO-23 (ver arriba).

### MOVO-145 — `GET /offers/mine`: listado de ofertas propias del transportista (`svc-shipments`)

Primer endpoint HTTP de ofertas del servicio (`src/modules/offers/`, nuevo) — hasta
ahora MOVO-102 solo había entregado dominio/repositorio, sin capa HTTP (ver nota de
MOVO-108 arriba). `offer-repository.ts#listByCarrier()` es el único método nuevo del
repositorio.

Decisiones clave:
- **Filtro de `?status=` traducido a WHERE de Postgres, no post-filtro en memoria**
  (`offerStatusWhere()`): el conteo de paginación tiene que salir de la base. `expired`
  no es un valor de columna real (AC11) — mapea a `status='pending' AND expiresAt <
  now`; `pending` en sí excluye lo ya vencido para no contarlo dos veces. El resto de
  los estados es igualdad directa.
- **Contexto de envío con `include` de Prisma en la misma query** (AC4): `Offer.shipment`
  ya existía como relación desde MOVO-102, no hizo falta tocar el schema. Un ítem
  `accepted` expone el `status` real del envío embebido (AC5, ej. `assignment_pending`),
  sin lógica especial — es la misma fila que trae el `include`.
- **Gateway wireado en el mismo PR** (`gateway/src/config/routes-map.ts`, prefijo
  `/offers` → `SHIPMENTS_SERVICE_URL`) aunque no estaba en el alcance de archivos del
  ticket: sin esto el endpoint quedaba inalcanzable por el único entrypoint público.
  Mismo criterio que `/addresses` de MOVO-119. Protegido por defecto, `carrierId` sale
  del `x-user-id` inyectado por el gateway, nunca de un query param (AC1).
- **`offeredDate`/`shipment.pickupDate` con el mismo fix de timezone que `toShipmentDto`**
  (MOVO-80): columnas `@db.Date` ancladas a UTC, formateadas a string recortado en el
  DTO de la ruta en vez de dejar que el serializador `format: "date"` les reste el
  offset del proceso.

Pendiente / fuera de alcance: creación y retiro de ofertas (`POST`/`DELETE`, MOVO-23,
todavía en Backlog) — este ticket es solo el lado de lectura.

### MOVO-142 — `GET /shipments/available`: descubrimiento por trayecto + apertura de `GET /shipments/:id` (`svc-shipments`)

Primer ticket del eslabón de asignación (EP-03) — hasta ahora ningún transportista
podía ver un envío `published`. `GET /shipments/available` filtra por geografía
(bounding box + Haversine, sin PostGIS) y amplía `getShipmentDetail()` para que un
transportista verificado pueda abrir lo que descubrió.

Decisiones clave:
- **Refinamiento de un punto a trayecto OPCIONAL (dos vueltas de corrección con el
  usuario sobre la marcha, encima del refinamiento ciudad/provincia→radio que ya traía
  el ticket)**: el AC1 literal pedía un solo `lat`/`lng`. Primera vuelta: se cambió a
  `originLat`/`originLng`/`destinationLat`/`destinationLng` (mismo naming que
  `routeQuery` de MOVO-123) para que el transportista pudiera filtrar por su propio
  trayecto. Segunda vuelta (corrección): **el destino no puede ser obligatorio** — el
  transportista no siempre tiene un viaje planificado, y en ese caso igual tiene que
  ver los envíos cerca suyo (la letra original del AC1). Diseño final: `originLat`/
  `originLng` obligatorios (de dónde parte); `destinationLat`/`destinationLng`
  opcionales, **los dos juntos o ninguno** (400 `VALIDATION_FAILED` si se manda uno
  solo, validado en el service — AJV no expresa "ambos o ninguno" limpio sin
  `dependentRequired`/`if`-`then`, y es el único query del schema que lo necesita). Sin
  destino: filtra/ordena solo por la cercanía del retiro al origen,
  `deliveryDistanceKm` viaja `null` y `distanceKm === pickupDistanceKm`. `maxDistanceKm`
  (opcional, sin default, aplica en los dos modos) tapea la distancia PROPIA
  retiro→entrega del envío, sin relación con el trayecto del caller.
- **Tercera vuelta de corrección — con destino, prefiltro de CORREDOR, no un AND de dos
  círculos independientes**: la implementación inicial de "con destino" filtraba
  `pickup` dentro de `radiusKm` del origen **y** `delivery` dentro de `radiusKm` del
  destino, cada uno contra su propio punto. El usuario señaló que ya existía una spike
  del equipo con el diseño correcto para esto:
  `docs/or-tools/vrptw-spike-report.md`/`vrptw_prototype.py` (MOVO-50, preparación
  técnica de MOVO-18/MOVO-10) — su prefiltro geométrico (CA6) mide la distancia
  perpendicular de cada punto al SEGMENTO origen→destino, no a los dos extremos por
  separado. El AND de dos círculos dejaba afuera un envío retirado/entregado en el
  MEDIO de un trayecto largo (el caso de estudio del spike es Oncativo, entre Córdoba y
  Villa María) aunque encajara perfecto en el viaje — ni el retiro ni la entrega quedan
  cerca de ningún extremo, solo cerca de la línea que los une.
  `haversineSegmentDistanceKm()` (`shipment-repository.ts`) porta la fórmula del
  prototipo Python (proyección equirrectangular centrada en el punto medio del
  segmento, clamp a los extremos con `GREATEST`/`LEAST`) a SQL — mismas constantes
  (`ky=110.574`, distinto del `111.32` que usa el `boundingBox` del modo sin destino,
  para no reinterpretar la fórmula original). `corridorBoundingBox()` reemplaza los dos
  círculos independientes por un único rectángulo que encierra el segmento completo
  ensanchado `radiusKm` — más laxo que un rectángulo orientado al segmento, pero simple
  y nunca excluye un punto real del corredor (el Haversine de la query filtra el resto).
  El orden (suma de ambas distancias) y el resto del contrato no cambiaron.
- **Gating (AC6) sin tocar `@movo/shared`**: `PublicProfile` no tiene `roles` (solo
  `PrivateProfile`, el propio usuario). En vez de agregarlo o sumar un método a
  `UsersClient`, el rol `carrier` sale de `getUserRolesFromHeader(request)` (ya
  inyectado por el gateway desde el JWT del caller) y el KYC de `usersClient.
  findPublicProfile(callerId, callerId).isVerified` — mismo patrón que ya usaba
  `createShipment` para el receptor, apuntado al propio caller. Deliberadamente
  **nunca** exige licencia de conducir (MOVO-15): insignia de confianza, no permiso de
  acceso. Código nuevo `CARRIER_NOT_VERIFIED` en `@movo/shared`.
- **Primer `$queryRaw` con lógica de dominio real del monorepo** (`shipment-repository.ts
  #listAvailable`) — hasta ahora solo `SELECT 1` en healthchecks. Distinto del
  precedente de MOVO-118 (que descartó SQL crudo para *locking* transaccional,
  resuelto con compare-and-swap): acá el motivo es trigonometría de dos puntos que
  Prisma no puede expresar, no concurrencia. Dos índices compuestos nuevos
  (`shipments_status_pickup_lat_lng_idx`/`..._delivery_lat_lng_idx`, migración escrita
  a mano — sin shadow database configurada en este entorno para generar el diff) — a
  diferencia de MOVO-130, que había descartado un índice compuesto por bajo volumen,
  acá el AC2 lo pide explícito.
- **`hasMyOffer` (AC5) interpretado como oferta `pending` efectiva**, no cualquier
  oferta histórica — reusa `offerStatusWhere()` (expiración perezosa, MOVO-145) vía
  `offer-repository.ts#listPendingOfferedShipmentIds()`, batch sobre la página ya
  resuelta (sin N+1). Una oferta `withdrawn`/`rejected`/vencida no cuenta.
- **AC8 ampliado sobre la letra del ticket**: además de "transportista verificado ve un
  `published` ajeno", se agregó que el `carrierId` ya asignado vea su propio envío en
  **cualquier** estado — gap real que no existía (`assertShipmentAccess` nunca conoció
  `carrierId`). Reimplementado inline en `getShipmentDetail()`, sin tocar
  `assert-shipment-access.ts` (compartido con `/events`/`photos.service.ts`, fuera de
  alcance de este ticket, y necesita I/O async que ese helper síncrono no puede
  intercalar antes del 403 final).
- **Proyección propia `AvailableShipment`** (`models/shipment.ts`), no `Shipment` +
  omitir campos en el DTO: sin `senderId`/`receiverId`/`carrierId`/precio
  acordado/pago (AC9), la ausencia de esos campos en el tipo mismo es lo que garantiza
  que nunca se filtren por accidente.

Tests: `test/shipments-available.integration.test.ts` (21 casos: gating, exclusión de
propios, AC9 positivo/negativo, `hasMyOffer` en sus 4 variantes, paginación,
validación, 4 casos dedicados al modo sin destino, y la regresión end-to-end del
corredor) + `shipment-repository.integration.test.ts` ampliado (11 casos de
`listAvailable`, incluido el modo sin destino y el caso "envío en el medio de un
trayecto largo" que reproduce exactamente por qué el AND de dos círculos no servía) +
`shipments-detail.integration.test.ts` ampliado (5 casos de AC8) +
`shipment-service.test.ts` ampliado (10 casos unitarios, incluida la validación
"ambos o ninguno"). Suite completa 30/30 suites, 384/384 tests. `tsc --noEmit` y
`eslint` limpios. Confirmado que `app.swagger()` expone `/shipments/available`.

Pendiente / fuera de alcance: UI mobile (MOVO-148, bloqueado por este ticket); el
wraparound de longitud en ±180° del bounding box queda sin resolver (irrelevante para
Argentina).

### MOVO-161 — `CRUD de Viaje declarado + matching de paquetes compatibles por radio de desvío` (`svc-shipments`)

Habilita a un transportista con rol `CARRIER` y verificación KYC aprobada a declarar
sus viajes planeados futuros, administrarlos ("Mis viajes", MOVO-162) y consultar el feed
de paquetes compatibles reutilizando el prefiltro geométrico de corredor de MOVO-50
(`haversineSegmentDistanceKm` + `corridorBoundingBox` ya presentes en `shipment-repository.ts`).

Decisiones clave:
- **Entidad `Trip` en Postgres (esquema `shipments.trips`) + enum `trip_status_enum`**:
  Aunque `MOVO-142` permitía búsquedas efímeras al vuelo sin persistencia, la US MOVO-18
  y la pantalla "Mis viajes" (MOVO-162) exigen persistir los viajes futuros declarados
  por el transportista. Se modeló además la relación opcional `trip_id` en `shipments.offers`.
  Migración SQL creada en `prisma/migrations/20260831210000_create_trips_table`.
- **Reglas de negocio de edición y cancelación (AC3 y AC4 de MOVO-18)**:
  Un viaje solo puede editarse (`PATCH /trips/:id`) o eliminarse (`DELETE /trips/:id`)
  mientras no tenga paquetes aceptados (`countAcceptedOffers(tripId) === 0`). Si tiene
  paquetes aceptados, devuelve HTTP 409 con `TRIP_HAS_ACCEPTED_PACKAGES`.
- **Radio de desvío al corredor configurable (regla de 3 lugares de env vars)**:
  `TRIP_DEFAULT_MAX_DETOUR_KM` configurado con default `15` (alineado a spike MOVO-50 CA6)
  en:
  1. `.env.example`
  2. `src/config/env.ts` (`envSchema`)
  3. `infra/docker-compose.yml`
  Adicionalmente, `GET /trips/:id/matches` admite el query param opcional `?radiusKm=`.
- **Mapeo en el API Gateway**:
  Se agregó el prefijo `/trips` en `gateway/src/config/routes-map.ts` apuntando a
  `SHIPMENTS_SERVICE_URL` como ruta protegida (requiere JWT).

Endpoints expuestos:
- `POST /trips`: declara un nuevo viaje futuro. Valida rol `carrier`, KYC aprobado, fecha futura y distancia origen-destino $\ge$ 100m.
- `GET /trips`: lista paginada de viajes del transportista con flag `hasAcceptedPackages`.
- `GET /trips/:id`: detalle de un viaje propio (o admin).
- `PATCH /trips/:id`: actualización de datos (409 si ya tiene paquetes aceptados).
- `DELETE /trips/:id`: eliminación de viaje (409 si ya tiene paquetes aceptados).
- `GET /trips/:id/matches`: feed de envíos `published` dentro del radio de desvío al corredor del viaje.

Tests: `test/trips-service.test.ts` (16 casos unitarios de servicio y validaciones) + `test/trips.routes.test.ts` (7 casos de integración HTTP Fastify con schemas y error-handler).

### Pendientes de este servicio

- **AC6 de MOVO-81 sin confirmar por el equipo**: el gate quedó implementado sobre
  `→ published` (interpretación propuesta en Linear); si el equipo responde distinto,
  es un ajuste acotado a `shipment-repository.ts#updateStatus()`.
- **Liberación del hold de MercadoPago al cancelar (MOVO-29) y cancelación con
  penalización desde `assigned`**: bloqueadas por `svc-payments`, que hoy no tiene
  holds/capture reales — ver MOVO-108 arriba.
