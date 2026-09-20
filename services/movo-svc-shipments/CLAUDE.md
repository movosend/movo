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

Pendiente / fuera de alcance: consumo real desde MOVO-23 (ver arriba). El consumo desde
`svc-users` (MOVO-152, perfil con reputación y contadores reales) ya se implementó del
lado de `svc-users` -- ver `services/movo-svc-users/CLAUDE.md` -- sin tocar código de
este servicio (los dos endpoints internos que consume, `GET /internal/users/:id/
reputation` de acá y `GET /internal/users/:id/ratings/recent` de MOVO-146, ya existían
tal cual). Único cambio de este lado: `test/fake-users-client.ts#fakePublicProfile()`
se actualizó con los campos nuevos de `PublicProfile` (`@movo/shared`) para seguir
compilando -- `svc-shipments` no ejercita reputación real, ese fake queda en el mismo
estado "sin datos" que ya usaba.

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

**Fix posterior (MOVO-162, mobile, encontrado al planificar "Mis viajes"):**
`countAcceptedOffers`/`update`/`delete`/`listByCarrier` contaban cualquier `Offer`
`accepted` con el `tripId` del viaje, sin mirar el envío al que apunta esa oferta —
`cancelShipment` (MOVO-108) nunca toca la fila de `Offer` al cancelar, así que un viaje
quedaba bloqueado (`hasAcceptedPackages: true`) para siempre aunque el emisor cancelara
el envío. `trip-repository.ts` ahora excluye ofertas cuyo envío esté `cancelled`
(`ACCEPTED_OFFER_FILTER`, mismo criterio ya aplicado en `listShipmentOffers` de
MOVO-144) — no toca `offer-state-machine.ts` (`accepted` sigue siendo terminal por
diseño). Test nuevo: `test/trip-repository.integration.test.ts` (Postgres real).
**Gap real encontrado en el camino, cerrado en el mismo PR (fuera del alcance de
archivos original de MOVO-162, decisión tomada con el usuario)**: nada en el código
escribía `Offer.tripId` — revisando MOVO-149 (creación de oferta) y MOVO-163 (feed
filtrado por viaje) en Linear, ninguna de las dos sub-issues de MOVO-18 contempla ese
campo en su propio AC, así que ni siquiera construyéndolas iba a cablearse. Se agregó
`tripId` opcional a `POST /shipments/:id/offers` (`shipments.schema.ts`/
`.routes.ts`/`.service.ts#createOfferForShipment`, `offer-repository.ts#create`,
`models/offer.ts`, `offers.schema.ts`/`shipments.schema.ts` para exponerlo en las
respuestas). Validación antes de persistir: el viaje existe (404
`TRIP_NOT_FOUND`), es del mismo transportista (403 `AUTH_FORBIDDEN`) y sigue `active`
(409 `TRIP_NOT_ACTIVE`, código nuevo en `@movo/shared`) — sin esto cualquier caller
podría taggear una oferta con el viaje de otro transportista o uno ya cancelado.
**Deliberadamente no valida geometría** (que el envío caiga dentro del corredor del
viaje): decisión de producto todavía sin tomar en ningún ticket, y sin consumidor real
que la ejercite (MOVO-149, la pantalla de "hacer una oferta", ni siquiera existe en
mobile todavía) no vale la pena adivinar el radio/semántica esperada — queda como
alcance acotado explícito, no como olvido. `TripRepository` se inyecta en
`ShipmentsServiceOptions` (mismo patrón lazy que `offerRepository`/`pricingClient`),
requerido solo cuando el caller manda `tripId`. Tests nuevos en
`shipments-offers-create.integration.test.ts` (6 casos: feliz con tripId, sin tripId
sin regresión, viaje inexistente, viaje ajeno, viaje cancelado, rollback completo ante
falla de validación).

### MOVO-143 — `POST /shipments/:id/offers` y `POST /offers/:id/withdraw` (`svc-shipments`)

Cierra el ciclo de vida HTTP de una oferta que MOVO-144/145 dejaron a medio construir
sobre el dominio de MOVO-102: el transportista ahora puede crearla y retirarla, no
solo verla/aceptarla/rechazarla. `POST /:id/offers` nuevo en `shipments.routes.ts`/
`.service.ts` (cuelga de `/shipments`, mismo criterio que `GET /:id/offers` de
MOVO-144); `POST /:id/withdraw` nuevo en el módulo `offers/` junto a `accept`/`reject`.
Sin cambios en el gateway — el prefijo `/offers` ya estaba mapeado desde MOVO-145.

Decisiones clave:
- **Comisión de Movo (AC6) movida a `@movo/shared`, no al `envSchema` de este
  servicio**: es la primera config de negocio (no solo de auth) que cruza el barrel —
  `shared/movo-shared/src/config/commission.ts` (`getCommissionConfig()`,
  `computeOfferGrossPrice()`) sigue el mismo patrón lazy+memoizado que
  `auth/config.ts#getJwtConfig()` (`MOVO_COMMISSION_RATE`/`MP_TRANSACTION_FEE_RATE`
  leídas de `process.env` directo, no de `app.config`). Decisión del equipo, no solo
  técnica: la comisión de Movo (**15%, confirmado**) y el fee de MercadoPago por
  operar la transacción (Auth & Capture/Marketplace Split) son parámetros
  transversales que `movo-svc-payments` (split real) y `movo-svc-admin`
  (estadísticas) van a necesitar más adelante — centralizarlos evita que cada
  servicio reinvente el número. Mismo motivo por el que no van en `envSchema` de
  ningún servicio en particular (como `JWT_SECRET` sí lo hace) — `MP_TRANSACTION_FEE_RATE`
  es un **placeholder** (0.0499), pendiente de confirmar con el contrato/homologación
  real de MP.
- **`mpTransactionFeeRate` se define pero NO se descuenta en esta US**: el AC6 del
  ticket solo pide neto→bruto con la comisión de Movo (lo que paga el emisor). El fee
  de MP se cobra en el split/captura real, que hoy no existe (`movo-svc-payments`
  sigue siendo un esqueleto) — la config queda lista y disponible para cuando ese
  ticket la necesite, sin tener que rediseñar de dónde sale el número.
- **Snapshot del transportista (AC7) con dos fuentes distintas**: `carrierNameAtOffer`
  vía `usersClient.findPublicProfile` (cross-servicio, mismo patrón que el snapshot de
  receptor de `createShipment`); `carrierRatingAtOffer` vía
  `ratingsService.getReputationSummary(carrierId).asCarrier.reputationScore` — llamada
  **local** (misma DB/proceso, sin HTTP contra sí mismo), tal como quedó documentado
  como plan en MOVO-147. Inyectado en `ShipmentsServiceOptions` como
  `getCarrierReputationScore` (callback), no importando `ratings.service.ts` directo
  adentro de `shipments.service.ts`, para no acoplar ese servicio a la construcción
  completa de `RatingsService` (repositorio + config de reputación) — la arma
  `shipments.routes.ts`, que ya tiene todo lo necesario. Puede resolver `null`
  (transportista sin calificaciones todavía) sin bloquear la oferta.
- **`priceOfferedArs` en el body es semánticamente el NETO**, tal como lo fija AC1 del
  ticket (nombre de campo literal, aunque ambiguo) — el servidor nunca lo persiste tal
  cual, siempre lo pasa por `computeOfferGrossPrice()` antes de guardar
  `Offer.priceOffered` (el bruto). La respuesta desglosa `priceNetArs`/
  `commissionAmountArs`/`priceOffered` (bruto) para que la UI muestre el desglose sin
  recalcular.
- **AC3 (ni emisor ni receptor pueden ofertar) nuevo helper
  `assertIsNotShipmentParty`** en `assert-shipment-access.ts`, junto al resto.
- **Dos códigos de error nuevos mapeados en `error-handler.ts`** que MOVO-102 ya
  lanzaba desde el repositorio pero que hasta ahora nunca se habían ejercitado por
  HTTP: `OfferDateOutOfRangeError` → 422 `OFFER_DATE_OUT_OF_RANGE` (AC5),
  `DuplicateActiveOfferError` → 409 `OFFER_DUPLICATE_ACTIVE` (AC4). Más
  `SHIPMENT_NOT_AVAILABLE_FOR_OFFER` (409, envío no `published`) — deliberadamente
  distinto de `SHIPMENT_NOT_AVAILABLE_FOR_ASSIGNMENT` (ese es el error del lado de
  `acceptOffer`, semánticamente otro caso).
- **`withdrawOffer` sin notificación push**: el AC8 no la pide (a diferencia de
  `acceptOffer`/`rejectOffer`, MOVO-144).

Tests: `test/shipments-offers-create.integration.test.ts` (12 casos: creación feliz con
verificación del desglose neto/comisión/bruto y de la push al emisor, gating rol+KYC,
envío no `published`, emisor/receptor ofertando sobre su propio envío, oferta
duplicada activa, re-oferta tras rechazo, fecha fuera de rango, rating `null` sin
calificaciones, precio ≤0, envío inexistente) y `test/offers-withdraw.integration.test.ts`
(4 casos: retiro feliz, oferta ajena, oferta ya aceptada, oferta inexistente). Suite
completa del servicio 32/32 archivos, 400+16 tests. `tsc --noEmit` y `eslint` limpios
en los archivos de esta US (los 14 errores de `no-explicit-any` que reporta `eslint`
sobre `orphan-photo-sweep.test.ts`/`receiver-confirmation-sweep.test.ts` son
preexistentes, no de este PR). Confirmado que `app.swagger()` expone
`/shipments/{id}/offers` y `/offers/{id}/withdraw`.

Pendiente / fuera de alcance: valor real de `MP_TRANSACTION_FEE_RATE` (placeholder,
pendiente de confirmar con MP); tope máximo de precio de una oferta (no lo pide
ningún AC, sin definir todavía); consumo real del fee de MP desde `movo-svc-payments`
(split real, sigue siendo un esqueleto) y desde estadísticas de `movo-svc-admin`.

### Barrido de envíos `published` con retiro vencido (bug reportado desde MOVO-148, sin ticket propio)

`GET /shipments/available` seguía devolviendo como disponibles envíos cuya ventana de
retiro ya había pasado (reportado por el usuario probando el tab "Transportar" del
mobile) — MOVO-142 nunca contempló que un `published` sin tomar por nadie debía dejar
de ofrecerse una vez vencida su franja. Sin sweep de expiración, a diferencia de la
confirmación del receptor (MOVO-130).

- **Nuevo `src/domain/pickup-window.ts`** (`pickupWindowEndInstant`/
  `isPickupWindowExpired`): mismo cálculo que `combineDateAndTime`/`toRealInstant` de
  `shipments.service.ts` (offset fijo de Argentina, UTC-3), pero operando sobre los
  `Date` ya persistidos (`Shipment.pickupDate`/`pickupTimeWindowEnd`, columnas
  `@db.Date`/`@db.Time` ancladas) en vez de parsear strings del body de un request.
- **`shipment-repository.ts#findPotentiallyExpiredPublished(limit)`**: trae los
  `published` ordenados por fecha/hora de retiro ascendente — no puede filtrar "¿ya
  venció?" en la propia query (no hay ningún instante real que Prisma pueda comparar
  con un simple `lte`, a diferencia de `findExpiredAwaitingConfirmation` contra
  `receiverConfirmationDeadline`), así que el filtro real corre en JS con
  `isPickupWindowExpired()` sobre el batch ya traído. Como un envío vencido siempre
  tiene fecha de retiro más vieja que uno vigente, el orden ascendente garantiza que
  los vencidos queden al frente del batch.
- **`shipments.service.ts#expireOverduePublishedShipments()`**: mismo esqueleto que
  `expireOverdueShipments` (MOVO-130) — cancela con `actorId: null` y el reason "Nadie
  retiró el paquete dentro de la ventana de retiro publicada", notifica al emisor
  best-effort (`dispatchPickupExpiredPush`, mismo `type: "shipment_cancelled"` que la
  cancelación por timeout del receptor — el resultado de negocio es el mismo). Un
  candidato del batch que resulta no estar vencido (todavía puede pasar, ver arriba)
  se ignora sin contar como error.
- **`src/plugins/pickup-expiry-sweep.ts`**: copia estructural de
  `receiver-confirmation-sweep.ts` (`setInterval` + lock distribuido en Redis,
  `PICKUP_EXPIRY_SWEEP_INTERVAL_MINUTES`/`_ENABLED`, default 15min/true). Registrado en
  `app.ts` con su propio override (`pickupExpirySweepEnabled`) para tests/CI.
- **Sin filtro en tiempo real en la query de `GET /shipments/available`** (documentado
  en el comentario de `isPickupWindowExpired`): solo el barrido corrige el dato de
  fondo, con hasta `PICKUP_EXPIRY_SWEEP_INTERVAL_MINUTES` de rezago — se evaluó sumar
  el mismo chequeo a la query en vivo, pero hubiera requerido replicar en SQL la
  cuenta del offset de Argentina que el resto del dominio mantiene deliberadamente en
  JS (mismo criterio que `reputation.ts`/`rating-window.ts`), y el mobile (MOVO-148) ya
  filtra client-side sobre la lista paginada — la ventana de rezago del barrido nunca
  llega a mostrarse al usuario.

Tests: `test/pickup-window.test.ts` (dominio puro), `test/pickup-expiry-sweep.test.ts`
(mismo patrón que `receiver-confirmation-sweep.test.ts` — comparte sus mismos 6
`no-explicit-any` de `eslint`, ya documentados como deuda preexistente de ese patrón de
test), casos nuevos en `shipment-service.test.ts` (cancela vencidos, ignora un
candidato todavía vigente sin contarlo como error, sigue el lote si uno falla) y en
`shipment-repository.integration.test.ts` (orden ascendente, `limit`) — estos últimos
no se pudieron correr en este entorno por no tener Postgres/Docker disponibles, quedan
a validar contra CI o un Postgres local. `tsc --noEmit` y `eslint` limpios en el resto
de los archivos tocados.

### MOVO-158 — Handshake criptográfico: QR dinámico, firma/proximidad GPS, transición de estado

Core del Cryptographic Handshake (MOVO-6): confirma el cambio de custodia (emisor→
transportista en el retiro, transportista→receptor en la entrega) combinando una
firma asimétrica del dispositivo con una validación de proximidad GPS, sin depender
de confianza ciega. Consume el endpoint interno ya implementado por el sub-issue
hermano `GET /internal/users/:id/device-key` (MOVO-157, `svc-users`, Done antes de
arrancar este ticket — no hizo falta ningún mock). Módulo nuevo
`src/modules/handshake/` (`handshake.routes.ts`/`.schema.ts`/`.service.ts`, prefix
`/shipments` compartido con `shipmentsRoutes`/`ratingsRoutes`, sin cambios en
`gateway/src/config/routes-map.ts`) + `src/repositories/handshake-repository.ts` +
`src/domain/handshake-crypto.ts`.

Decisiones clave:
- **`POST /:id/handshake/generate` nunca firma nada**: el AC1 del ticket describe el
  endpoint "firmando con la clave privada del cedente", pero esa clave nunca sale del
  dispositivo (garantía de MOVO-157) — el backend no puede firmar. En su lugar, crea y
  persiste el nonce (Redis, TTL 15s) junto a las coordenadas GPS del cedente, y
  devuelve el string canónico exacto (`{shipmentId}:{stage}:{nonce}`) para que el
  mobile (MOVO-159, bloqueado por este ticket) lo firme client-side y arme el QR. Es
  la única lectura coherente con el resto del diseño, no una interpretación libre.
- **`stage` se infiere del `status` del envío, nunca lo manda el cliente**
  (`inferHandshakeStage`, `handshake.service.ts`): `assigned` es la única etapa de
  retiro pendiente (cedente=emisor), `in_transit` la única de entrega pendiente
  (cedente=transportista) — así resuelve de paso el gating de actor de AC6. Cualquier
  otro estado es 409 `HANDSHAKE_INVALID_SHIPMENT_STATE`.
- **ADR-020 (primera criptografía asimétrica del repo)**: ECDSA P-256/SHA-256 vía
  `node:crypto`'s `webcrypto.subtle` (no la API legacy `crypto.verify`), clave pública
  en formato `raw` (punto EC sin comprimir, mismo shape que ya asumía el test de
  MOVO-157) y firma en IEEE P1363 (raw r‖s, no DER) — formato nativo de
  `subtle.sign`/`verify`, evita reencodear en un extremo y mantiene consistencia con
  el lado mobile (previsiblemente también WebCrypto). `verifyHandshakeSignature`
  nunca lanza — clave/firma malformada de un dispositivo ajeno se trata como firma
  inválida (422), nunca 500.
- **Estado pendiente (nonce + GPS del cedente) en Redis, no en Postgres**: clave
  `handshake:pending:{shipmentId}:{stage}`, `SET ... PX 15000`. Un solo `SET` da TTL-
  expiry (AC5, 410) y "nuevo nonce invalida el anterior" (AC5) gratis por overwrite —
  `handshake_events` es (AC3) un log de eventos ya *confirmados*, no puede duplicar
  ese rol.
- **Commit atómico vía `handshakeRepository.confirmAndPersist()`, no
  `shipment-repository.ts#updateStatus()`**: mismo motivo que
  `offer-repository.ts#acceptOffer` (MOVO-102/MOVO-118) — ese método abre su propia
  `$transaction`, no anidable con el insert de `handshake_events`. La transacción
  única hace, en orden: `transition()` (defensa en profundidad contra el grafo
  canónico), el mismo CAS `updateMany({where:{id,status:from}})` que `updateStatus`
  (reusa la `ShipmentConcurrentModificationError` ya existente, sin wiring nuevo en
  `error-handler.ts`), el insert en `shipment_events` (mantiene `/shipments/:id/events`
  completo) y el insert en `handshake_events`. La garantía real de exclusión mutua
  contra una confirmación concurrente es este CAS de Postgres, no la lectura de Redis
  (que solo resuelve el caso normal de nonce vencido/superado) — verificado con un
  test de dos `/confirm` corriendo en paralelo con el mismo nonce válido.
- **`actor_id`/`counterparty_id` de `handshake_events`**: `actor_id` es quien confirma
  (llamó a `/confirm`, el receptor de la custodia); `counterparty_id` es quien generó
  el QR (el cedente) — mismo criterio que `actor_id` en `shipment_events` (quien
  ejecutó la acción). `nonce_hash` (sha256 hex) nunca guarda el nonce en claro, ya
  cumplió su función de un solo uso en Redis.
- **`FundsReleaseNotifier` (AC7, molde ADR-012/017)**: la liberación de fondos real
  (captura/split de Mercado Pago) queda deliberadamente fuera de este ticket —
  bloqueada por el caso de soporte escalado con MP — detrás de una interfaz con
  no-op/log en dev-test (`FUNDS_RELEASE_NOTIFIER=console`, único valor hoy). Dispara
  **solo** en la transición a `delivered` (nada se libera en el retiro), fire-and-
  forget, nunca bloquea la respuesta de `/confirm`.
- **`haversineKm` extraído a `src/domain/geo.ts`** (antes vivía duplicada dentro de
  `shipments.service.ts`, MOVO-126): AC4 necesita el mismo cálculo de distancia para
  el umbral de 100m del handshake — se reusa en vez de triplicarlo, sin cambio de
  comportamiento en el uso existente.
- **`GET /internal/users/:id/device-key` (MOVO-157) consumido sin header `x-user-id`**:
  nuevo método `findDeviceKey()` en la interfaz `UsersClient` existente (no un adapter
  nuevo, mismo servicio destino) — a diferencia de `findPublicProfile`, ese endpoint
  interno no pasa por el gateway y no espera ningún header de autenticación
  (perimetral, mismo criterio que `notifications-client.ts`).
- **5 códigos nuevos en `@movo/shared`**: `HANDSHAKE_QR_EXPIRED` (410, AC5),
  `HANDSHAKE_DISTANCE_EXCEEDED` (422, AC4), `HANDSHAKE_INVALID_SIGNATURE` (422, sin
  código explícito en el ticket, mismo criterio 422 que el de distancia),
  `HANDSHAKE_CEDENTE_KEY_MISSING` (409, precondición de un tercero — mismo criterio
  que `TRIP_NOT_ACTIVE`/`SHIPMENT_NOT_AVAILABLE_FOR_ASSIGNMENT`, no el `404
  DEVICE_KEY_NOT_FOUND` de MOVO-157: ese código ya está atado a un 404 en otro
  endpoint), `HANDSHAKE_INVALID_SHIPMENT_STATE` (409). **410 es la primera vez que se
  usa este status en el repo** (el resto de "estado vencido" del proyecto usa 409,
  ej. `SHIPMENT_RECEIVER_CONFIRMATION_EXPIRED`) — mandato explícito del AC5 del
  ticket, no una inconsistencia a corregir.
- **DER actualizado**: `shipments.handshake_events` reemplaza el placeholder
  `shipments.custody_transfer_event` de `docs/movo_der.dbml` (sin ticket hasta ahora)
  con las columnas que este ticket realmente persiste — `signature`/
  `previous_event_hash`/`event_type`/`result` del placeholder quedan deliberadamente
  afuera (no forman parte del AC3, un futuro ticket podría sumarlos sin romper nada
  vía `ALTER TABLE`). De paso se agregó `users.device_keys` (MOVO-157), que nunca
  había llegado a este archivo.

**Bug real encontrado corriendo el test de concurrencia contra Postgres real (no por
`app.inject()` mockeado)**: `confirmHandshake` resolvía originalmente el `stage`
releyendo `shipment.status` en vivo, igual que `/generate`. Con dos `/confirm`
concurrentes sobre el mismo nonce, el perdedor podía leer el envío DESPUÉS de que el
ganador ya había commiteado la transición (`assigned`→`in_transit`) — resolvía
`stage: "delivery"` en vez de `"pickup"`, exigía `assertIsReceiver` en vez de
`assertIsCarrier`, y el transportista (actor correcto) recibía un 403 en vez de
409/410. Corregido guardando el `stage` DENTRO del desafío pendiente de Redis (fijado
al momento de `/generate`, nunca releído) — `confirmHandshake` ya no llama a
`inferHandshakeStage()` en absoluto, esa función quedó exclusiva de `/generate`. Como
consecuencia, la clave de Redis pasó de `handshake:pending:{shipmentId}:{stage}` a
`handshake:pending:{shipmentId}` (el `stage` vive en el valor, no en la clave — un
envío nunca tiene más de un desafío legítimamente pendiente a la vez) y el chequeo
409 `HANDSHAKE_INVALID_SHIPMENT_STATE` quedó exclusivo de `/generate` (en `/confirm`
era, sin saberlo, la misma fuente de la carrera). Test de regresión dedicado en
`handshake-service.test.ts` (mockeado, sin Postgres) que fija exactamente este
escenario, además del test de concurrencia real contra Postgres.

Tests: `test/geo.test.ts` (extracción de `haversineKm`, regresión), `test/handshake-
crypto.test.ts` (keypair P-256 efímero real vía WebCrypto — firma válida/tampering de
payload/firma de otra clave/clave o firma malformada, nunca lanza), `test/handshake-
service.test.ts` (mocks — TTL, las 4 combinaciones de 403 actor×stage con un QR real
ya generado, 409 clave faltante, 422 firma/distancia, ambas direcciones de transición
con roles correctos, `FundsReleaseNotifier` solo en delivery, y el test de regresión
del bug de arriba), `test/handshake.integration.test.ts` (Postgres+Redis reales,
`app.inject()` — flujo completo generate→confirm de pickup y delivery, la matriz de
errores, y el test de concurrencia de dos `/confirm` en paralelo con el mismo nonce).
**Corrida contra Postgres/Redis reales (Docker) verificada**: suite completa del
servicio 41/41 archivos, 501/501 tests — el test de concurrencia se corrió 5 veces
seguidas sin flakiness tras el fix. `tsc --noEmit`, `npm run build` y `npm run lint`
limpios.

Pendiente / fuera de alcance: integración real de liberación de fondos con Mercado
Pago (AC7, bloqueada por el caso de soporte escalado); generación de claves y su UI
en mobile (MOVO-159/160, ambas bloqueadas por este ticket — el contrato que define
este ticket, canonicalPayload + formato de firma IEEE P1363, es lo que esas dos
historias tienen que implementar del lado del dispositivo).
### MOVO-170 — Enriquecimiento de perfil: usageStats por rol, historial compartido, ratings paginados (`svc-shipments`)

Lado `svc-shipments` de la exposición de datos ya persistidos para el rediseño de
perfil de `movo-mobile` (MOVO-176). Sin migraciones — todo se calcula sobre columnas
existentes (`Shipment.weightKg`, `status`, `createdAt`).

- **`usageStats` (delivered/cancelled/avgPackageWeightKg) se sumó DENTRO de
  `asSender`/`asCarrier` de `GET /internal/users/:id/reputation`**, no como endpoint
  nuevo — `ratings.service.ts#getReputationSummary` ya calculaba
  `transactionCounts.asSender/asCarrier` (delivered por rol); solo hacía falta un
  método nuevo (`shipment-repository.ts#getUsageStatsByRole`, cancelled + `avg(weightKg)`
  por rol) para completar el trío sin una segunda llamada cross-servicio.
  `avgPackageWeightKg` es sobre TODOS los envíos del usuario en ese rol, no solo los
  entregados — no hay AC que pida acotarlo, y "peso promedio de lo que mueve" es más
  informativo que "peso promedio de lo entregado".
- **`GET /shipments/history-with/:userId` nuevo** (`shipments.routes.ts`, junto a
  `/mine`/`/route`/`/available`): historial compartido entre el viewer (`x-user-id`) y
  otro usuario, sin importar el rol de cada uno (emisor/receptor/transportista) en
  cada envío — un `findMany` con OR cubriendo las 3 combinaciones de rol posibles
  entre dos personas, `allDelivered` calculado en JS (necesita saber si TODAS las
  filas son `delivered`, no un conteo).
- **`GET /internal/users/:userId/ratings/recent` pasó a paginado** (`{items,
  nextCursor}`, antes un array plano) — primer precedente de cursor pagination del
  repo (toda la paginación existente es offset/page-based). Keyset simple sobre
  `(createdAt, id)` desc, cursor opaco = base64 de `createdAt|id`
  (`rating-repository.ts#listRecentByRateePaginated`, reemplaza al
  `listRecentByRatee` no paginado de MOVO-146 — único consumidor). Rompe el contrato
  interno anterior a propósito: es un endpoint `hide:true` sin proxear por el gateway,
  y su único consumidor (`svc-users`) se actualizó en el mismo ticket.
- **`raterName` NO se resuelve acá**: `svc-shipments` no conoce nombres de usuario —
  sigue devolviendo `raterId` crudo, la resolución (batch lookup local) vive del lado
  de `svc-users` (ver su CLAUDE.md). Decisión de producto confirmada con el usuario:
  el calificador deja de ser anónimo de cara al calificado.

Tests: `test/shipments-history-with.integration.test.ts` (nuevo, Postgres real — los 3
combos de rol, `allDelivered` con historial mixto, sin historial), casos nuevos en
`test/ratings.integration.test.ts` (usageStats en la respuesta de reputación,
paginación de `ratings/recent` con cursor), `test/ratings-service.test.ts` (usageStats
combina `transactionCounts` con el nuevo `getUsageStatsByRole`). Suite completa
463/463 tests (38 archivos), `tsc --noEmit` limpio. `fake-users-client.ts` actualizado
con los campos nuevos de `PublicProfile` (mismo ajuste que documentó MOVO-152/147 —
sin lógica nueva de este lado, solo compilar).

Pendiente / fuera de alcance: consumo desde `movo-mobile` (MOVO-176, sub-issue
hermana); "recorridos totales" (km) y métricas de puntualidad, explícitamente
excluidas del ticket por falta de definición de producto.

### MOVO-177 — Fecha/hora de retiro alternativa en la oferta (`svc-shipments`)

El transportista ahora puede proponer un día/horario de retiro distinto al pedido por
el emisor, en vez de exigir coincidencia exacta (limitación que el propio ticket de
planificación MOVO-177 identificó como real de backend, no solo de mobile).

- **`sameDay()` reemplazado por `isWithinOfferDateRange()`** (`offer-repository.ts`):
  `offeredDate` ahora acepta desde `shipment.pickupDate` hasta
  `OFFER_DATE_MAX_FORWARD_OFFSET_DAYS` (3) días después — nunca antes (el paquete
  recién está listo desde el día pedido). Mismo error de dominio
  (`OfferDateOutOfRangeError` -> 422 `OFFER_DATE_OUT_OF_RANGE`), solo cambió el rango
  que valida.
- **`Offer.offeredPickupTimeWindowStart/End` nuevas** (migración
  `20260906180000_add_offer_pickup_time_window_override`, ambas `VARCHAR(8)`
  nullable): franja horaria alternativa, solo presente cuando el transportista
  propone un día/horario distinto — `null` significa "usa la ventana del envío tal
  cual". Both-or-neither validado en `shipments.service.ts#createOfferForShipment`
  (`VALIDATION_FAILED` si viene solo uno de los dos, `OFFER_PICKUP_WINDOW_INVALID` ->
  422 nuevo en `@movo/shared#ApiErrorCode` si `end <= start`).
  Expuestas en `offerResponse`/`createOfferResponse`/`myOfferResponse`.
- El límite de 3 días es una constante propia de `offer-repository.ts`, no de
  `@movo/shared` — es la única regla de negocio que lo consume por ahora.

Tests: 2 casos actualizados (`offer-repository.integration.test.ts`,
`shipments-offers-create.integration.test.ts` — el rango ya no rechaza "un día
después") + 5 casos nuevos (rango excedido, franja horaria válida, both-or-neither,
`end <= start`). Suite completa 469/469, `tsc --noEmit` limpio.

**Adelantado el mismo día (feedback de UI sobre el mockup, MOVO-180 sección 2):**
`GET /shipments/:id` ahora expone `offersSummary: { count, minPriceNetArs } | null`
cuando el caller es un transportista ajeno viendo un envío `published`
(`computeOffersSummaryForCarrier`, `shipments.service.ts#getShipmentDetail`) —
conteo + neto mínimo de las ofertas `pending` vigentes, derivado del `priceOffered`
(bruto, único valor persistido) con la misma tasa que `computeOfferGrossPrice`,
deliberadamente SIN identidad de los competidores (nombre/id/rating). `null` si no
recibió ninguna oferta activa todavía. Reusa `offerRepository.listByShipment` en vez
de un método de repositorio nuevo — pocas ofertas por envío, no amerita otra query.
No se tocó `GET /shipments/available` (listado): ninguna pantalla real lo pedía ahí
todavía. Tests: `shipment-service.test.ts` (agregado excluye ofertas no-`pending`),
`shipments-detail.integration.test.ts` (Postgres real, incluye assert de que la
respuesta nunca contiene el id del competidor).

Pendiente / fuera de alcance: entrega estimada (día/franja) para el transportista —
evaluada durante esta misma US contra el mockup de MOVO-177, pero requiere contrato
de backend nuevo (columnas de `Offer`, propagación a `Shipment` al aceptar) sin
construir todavía. Documentado en detalle en **MOVO-180** (Urgent, mismo ciclo) — el
mobile (`movo-mobile/CLAUDE.md`) ya tiene esa UI construida contra el contrato
propuesto, sin mandarlo todavía al servidor.

### MOVO-180 — Contrato de backend: entrega estimada en la oferta (`svc-shipments`)

Sección 1 del ticket (la 2, `offersSummary`, ya se había adelantado sobre MOVO-177 --
ver el comentario de actualización en Linear). `Offer`/`Shipment` suman
`estimatedDeliveryDate`/`estimatedDeliveryTimeWindowStart`/`estimatedDeliveryTimeWindowEnd`
(migración `20260906180000_add_estimated_delivery_window`), expuestos en
`createOfferBody`, `offerResponse`/`createOfferResponse`/`myOfferResponse` y
`shipmentResponse`. Se copian del ganador al `Shipment` al aceptar la oferta
(`offer-repository.ts#acceptOffer`, mismo `updateMany` que ya setea `carrierId`).

Decisiones clave:
- **Discrepancia encontrada contra la letra del ticket**: el ticket describe
  `app/(app)/transport/[id]/offer.tsx` ya recolectando estos campos en una sección "A
  qué hora entregás (estimado)" y solo omitiéndolos del body. Ese archivo no existe --
  MOVO-149 (la US que de verdad implementó "hacer una oferta" en mobile) terminó en un
  diseño distinto y más simple (`components/transport/create-offer-sheet.tsx`, una
  hoja modal sin ningún campo de entrega estimada). El texto del ticket describe el
  mockup/plan de MOVO-177, no lo que MOVO-149 mergeó. Documentado acá porque cambia el
  cálculo de riesgo de la siguiente decisión.
- **Los tres campos son opcionales al ofertar, no obligatorios** (la pregunta abierta
  del ticket): dado que el mobile actual no los recolecta en absoluto (punto anterior),
  volverlos obligatorios habría roto `POST /shipments/:id/offers` para el único cliente
  real que existe hoy. Quedan both-or-neither (422 `VALIDATION_FAILED` si se manda
  parte de los tres), `estimatedDeliveryTimeWindowEnd` > `Start`, y
  `estimatedDeliveryDate >= offeredDate` -- las tres validaciones sincrónicas, antes de
  cualquier I/O, en `shipments.service.ts#createOfferForShipment`.
- **Horario como `String @db.VarChar(8)`, no `@db.Time`**: a diferencia de
  `pickupTimeWindowStart/End` (`Shipment`), que sufren el gotcha de timezone-anclaje
  documentado en MOVO-80 (`@db.Time`/`@db.Date` ancladas a UTC, necesitan
  `toISOString().slice(...)` manual en cada DTO para no correrse con el offset del
  proceso), acá un `"HH:MM:SS"` de pared se persiste y se lee tal cual, sin ningún
  tratamiento especial -- decisión tomada al escribir el schema de Prisma de este
  ticket, no heredada de ningún patrón previo (`estimatedDeliveryDate` sí sigue siendo
  `@db.Date`, mismo tratamiento que `offeredDate`/`pickupDate`).
- **Mobile fuera de alcance de este PR**: sin UI real que recolecte estos campos
  (punto de arriba), no hay nada que cablear del lado de `movo-mobile` todavía --
  queda para cuando exista un ticket de UI para esto (ninguno todavía en Backlog).

Tests: `test/shipments-offers-create.integration.test.ts` (6 casos nuevos: sin los
tres campos, con los tres, validación both-or-neither, franja invertida, entrega
anterior al retiro, caso límite mismo día) y `test/offers-accept-reject.integration.test.ts`
(3 casos nuevos: propagación al aceptar, ganadora sin declarar entrega estimada, ida y
vuelta completa por HTTP verificando el formato date-only de `GET /shipments/:id`).
Suite completa del servicio 471/471 tests (38 archivos), `tsc --noEmit` y `eslint`
limpios. Confirmado que `app.swagger()` expone los campos nuevos en
`POST /shipments/{id}/offers`.

Pendiente / fuera de alcance: UI mobile de entrega estimada (sin ticket todavía);
"ofertas actuales" (sección 2 del ticket) ya resuelta antes de este PR, ver el
comentario de actualización de MOVO-180 en Linear.

### Bug reportado en producción — feed de matching envío↔viaje sin filtro de fecha (MOVO-163, sin ticket propio)

`GET /trips/:id/matches` (MOVO-161/163) recomendaba envíos cuya ventana de retiro no
tenía ninguna relación con la fecha del viaje declarado (ej. viaje el 8/9, envío
recomendado con ventana el 27/9) — el filtro de MOVO-163 siempre fue puramente
geométrico (corredor + radio de desvío de MOVO-50), `trip.departureAt` nunca se usaba
para nada. El único filtro de fecha existente, `isPickupWindowExpired` (cliente
mobile y barrido del backend), compara contra el reloj real (`now`), no contra el
viaje — no cubre este caso.

- **Criterio elegido: mismo día calendario** (no ventana horaria exacta ni tolerancia
  configurable) — decisión de producto tomada con el usuario al reportar el bug.
  `pickup_date` coincide con el día de `trip.departureAt` en huso horario argentino.
- **`domain/pickup-window.ts#toArgentinaCalendarDate(instant)`** nueva, inversa de
  `pickupWindowEndInstant`: dado un instante real (`trip.departureAt`, `@db.Timestamptz`),
  devuelve el día calendario argentino anclado a medianoche UTC — mismo formato que
  `Shipment.pickupDate` (`@db.Date`), comparable por igualdad directa en SQL.
- **`shipmentRepository.listAvailable` gana un `pickupDate` opcional**, incorporado a
  `availableShipmentsWhereSql` (única fuente del `WHERE` compartido entre datos y
  conteo, MOVO-142). Deliberadamente opcional: el modo genérico "cerca mío" de
  MOVO-142 (`GET /shipments/available`, sin viaje de por medio) no lo manda y sigue
  sin filtrar por fecha — solo `trips.service.ts#getTripMatches` lo pasa.

Tests: `pickup-window.test.ts` (3 casos nuevos de `toArgentinaCalendarDate`, incluido
el cruce de día UTC↔Argentina), `trips-service.test.ts` (caso dedicado a ese mismo
cruce de día contra el mock de `listAvailable`), `shipment-repository.integration.test.ts`
(2 casos nuevos: filtra con `pickupDate`, no filtra sin él). Los tests de integración
contra Postgres real no se pudieron correr en este entorno (sin Docker/Postgres
disponible) — quedan a validar contra CI.

**Unificación posterior (sin ticket propio, encontrada al corregir el mismo bug del
lado mobile — MOVO-183, `movo-mobile/CLAUDE.md`)**: `movo-mobile` necesitaba la misma
cuenta de día calendario argentino para su propia franja "de paso" client-side
(`computeOnTripDetour`, sin backend que cruce el feed completo contra todos los
viajes activos — ver más abajo) y la había reimplementado a mano. El cálculo puro se
extrajo a `@movo/shared#toArgentinaCalendarDateString` (`(instant: Date | string) =>
"YYYY-MM-DD"`, ver `shared/movo-shared/CLAUDE.md`); `toArgentinaCalendarDate` de este
servicio ahora es un wrapper de una línea sobre esa función compartida, solo
reconstruye el `Date` anclado que necesita para comparar contra `@db.Date` en SQL.

### MOVO-188 — Ranking competitivo de la oferta propia (posición, mínimo y máximo)

`GET /offers/mine` (MOVO-145) suma `competitiveRank: { rank, total, lowestPriceNetArs,
highestPriceNetArs } | null` a cada ítem, para el aviso "Quedaste 4.º de 5" del mockup
de MOVO-151/182. `null` si la oferta no está `pending` o si su envío ya no acepta
ofertas.

Decisiones clave:
- **Batch, no por ítem (AC5)**: `offer-repository.ts#listPendingOffersByShipmentIds`
  trae, en una sola query, las ofertas `pending` efectivas de todos los `shipmentId`
  distintos de la página, ordenadas por `priceOffered` (bruto) ascendente.
  `offers.service.ts#listMyOffers` ubica ahí la posición de cada oferta propia y
  convierte piso/techo a neto — mismo criterio de conversión que
  `computeOffersSummaryForCarrier` (MOVO-180, `shipments.service.ts`).
- **"El envío ya no acepta ofertas" es un caso real, no defensivo**: `cancelShipment`
  no toca las filas de `offers` (solo notifica, ver MOVO-108 más arriba), así que una
  oferta puede seguir `pending` en base sobre un envío ya `cancelled`. El ranking se
  computa solo si, además de `pending`, `shipment.status === published` — si no, `null`
  sin consultar competidores para ese envío.
- **Sin identidad de los competidores (AC4)**: mismo criterio que `offersSummary`
  (MOVO-180) — agregado puro (posición/piso/techo), nunca quién más ofertó.
- **`GET /offers/:id` (MOVO-190, AC6) no expone el campo todavía**: ese endpoint no
  existe en este servicio — MOVO-190 lo suma reusando el mismo
  `listPendingOffersByShipmentIds`.

**Fixes de review (PR #142, antes de mergear) — desempate a igual `priceOffered`**:
en ARS es común que varias ofertas coincidan centavo a centavo — un `orderBy:
priceOffered` sin más no garantiza qué fila queda primero entre iguales (Postgres no
promete orden estable ahí), así que el `rank` podía cambiar solo entre dos llamadas
sin que nada cambiara en la realidad. Se agregó una cascada de desempate (decisión de
producto, no pedida por ningún AC de MOVO-188): a igual precio, gana quien tiene
mejor reputación `asCarrier` (MOVO-147); a igual reputación, quien entregó más envíos
como transportista (`shipment-repository.ts#countDeliveredAsCarrierByIds`, `groupBy`
nuevo); a igual todo eso, quien ofertó primero (`createdAt`); el `id` es el piso
final. Ambos criterios nuevos se resuelven en batch sobre los `carrierId` únicos que
compiten en la página completa (`ratings.service.ts#getCarrierReputationScoresBatch`,
nuevo — requirió `rating-repository.ts#listForReputationByRateeIds` batch, mismo
criterio N+1 que el resto de MOVO-188) — como mucho dos queries MÁS para toda la
página, nunca una por competidor. `getCarrierReputationScores` se inyecta en
`createOffersService` igual que `getCarrierReputationScore` (MOVO-143,
`shipments.service.ts`): un `ratingsService` propio armado en `offers.routes.ts`, sin
que `offers.service.ts` importe `ratings.service.ts` directo.

Segundo fix del mismo review, no relacionado al desempate: `listByCarrier`
(`offer-repository.ts`) y `listPendingOffersByShipmentIds` evaluaban la expiración
perezosa (AC11) contra dos `new Date()` independientes -- una oferta que vencía justo
en el medio de los dos podía leerse `pending` en una función y ya no aparecer en la
otra, degradando `competitiveRank` a `null` sin necesidad. `listMyOffers` ahora crea
un único `now` y lo pasa explícito a ambas llamadas.

Tercer fix: `toNetArs` (conversión bruto→neto) estaba duplicada inline en
`offers.service.ts` y en `shipments.service.ts#computeOffersSummaryForCarrier`
(MOVO-180) — extraída a `computeNetFromGross()` en
`shared/movo-shared/src/config/commission.ts` (inversa de `computeOfferGrossPrice`),
mismo criterio de centralización que ese archivo ya usa. Las dos llamadas ahora
reusan la misma función.

Tests nuevos: 3 casos en `offers-mine.integration.test.ts` (reputación desempata,
envíos entregados desempata a igual reputación, `createdAt` desempata a igual todo lo
demás). Suite completa del servicio verificada contra Postgres/Redis reales:
534/538 (los 4 que fallan son de `handshake.integration.test.ts`, preexistentes en la
rama antes de este fix, no relacionados). `tsc --noEmit` limpio.

### MOVO-185 — Contexto enriquecido de envío en `GET /offers/mine` (distancia y resumen del paquete)

`OfferShipmentContext` (`models/offer.ts`) suma `distanceKm` (Haversine pickup→delivery,
redondeado a 1 decimal, `domain/geo.ts#haversineKm` reusado sin duplicar) y el resumen
del paquete (`packageType`, `weightKg`, `description`) para el mockup de "Mis ofertas"
(MOVO-151/182). Ampliación de proyección pura: `offer-repository.ts#mapOfferWithShipment`
ya tenía todas las columnas disponibles vía el `include: { shipment: true }` de
MOVO-145, solo hacía falta mapearlas — sin tocar el `select`/`include` en sí.

- **Sin lat/lng crudos en la respuesta (AC1)**: mismo criterio de proyección mínima que
  `AvailableShipment` (MOVO-142) — solo la distancia ya calculada viaja, ningún
  consumidor pide las coordenadas todavía.
- **`OfferShipmentContext` es el único lugar de verdad (AC3)**: `GET /offers/:id`
  (MOVO-190, bloqueado por este ticket) va a reusarlo tal cual, sin trabajo adicional.
- Sin migraciones (AC4): todos los campos ya existían en `Shipment`.

Tests: caso dedicado con las mismas coordenadas de referencia que `geo.test.ts` (Plaza
San Martín → Nueva Córdoba) en `offer-repository.integration.test.ts`, más los campos
nuevos sumados a los casos ya existentes de `AC4` en ese archivo y en
`offers-mine.integration.test.ts` (incluye assert de que `pickupLat`/`pickupLng` nunca
viajan). Suite completa del servicio 542/542 tests (42 archivos). `tsc --noEmit` y
`eslint` limpios. Confirmado que `app.swagger()` expone los 4 campos nuevos en
`GET /offers/mine`.

### MOVO-186 — Desglose neto/comisión en todas las respuestas de oferta

`GET /offers/mine`, `POST /offers/:id/accept`, `/reject` y `/withdraw` ahora devuelven
`priceNetArs`/`commissionAmountArs` junto a `priceOffered` (bruto) — hasta ahora solo
`POST /shipments/:id/offers` (MOVO-143) exponía el desglose, obligando al cliente a
recalcular la comisión a mano en el resto de las pantallas que tocan una oferta
(mockup de MOVO-151/182).

- **Un solo lugar de verdad, ya centralizado desde MOVO-188**: `decomposeOfferGrossPrice()`
  nueva en `@movo/shared` (ver su `CLAUDE.md`) — `offer.dto.ts#toOfferDto` (accept/
  reject/withdraw) y `offers.routes.ts#toMyOfferDto` (`/mine`) la llaman cada uno sobre
  su propio `offer.priceOffered`, sin reimplementar la resta bruto-neto.
  `computeOffersSummaryForCarrier` (MOVO-180) no se tocó -- ya usaba
  `computeNetFromGross` desde el fix de review de MOVO-188, y solo necesita el neto,
  no el desglose completo.
- **Tasa vigente AL MOMENTO DE LA LECTURA, no la que regía al ofertar (AC1)**: mismo
  criterio ya documentado para `computeOffersSummaryForCarrier`/`competitiveRank` — el
  desglose se recalcula en cada respuesta con `getCommissionConfig()` actual, la
  comisión histórica de la oferta no se persiste en ningún lado.
- **`toMyOfferDto` se dejó en `offers.routes.ts`, no se movió a `offer.dto.ts`**
  (aunque el ticket lo sugería): ya hace su propio formateo de fechas ahí (gotcha de
  timezone de columnas `@db.Date`) y moverlo no aportaba nada — solo se le sumó el
  desglose en el lugar donde ya vivía.

Tests: 4 casos nuevos (uno por endpoint) en `offers-mine.integration.test.ts`,
`offers-accept-reject.integration.test.ts` (accept y reject) y
`offers-withdraw.integration.test.ts`, contra un `priceOffered` conocido (1150 ->
neto 1000, comisión 150 con la tasa 15% default). Suite completa del servicio
545/545. `tsc --noEmit` y `eslint` limpios en los archivos de esta US. Confirmado que
`app.swagger()` expone los campos nuevos en los 4 endpoints.

### MOVO-181 — `PATCH /offers/:id`: modificar una oferta `pending` (precio y/o fecha/franja de retiro)

Cierra el hueco que dejó `offer-state-machine.ts` (MOVO-102): no había forma de
corregir una oferta sin retirarla y crear una nueva, perdiendo el hilo con el emisor.
`PATCH /offers/:id` nuevo en `offers.routes.ts`/`.schema.ts`/`.service.ts`;
`offerRepository.update()` nuevo en `offer-repository.ts`.

Decisiones clave:
- **No es una transición de `offer-state-machine.ts`**: `status` no cambia (sigue
  `pending`), así que la precondición "solo sobre una oferta efectivamente `pending`"
  se resuelve como un chequeo propio (`OfferNotEditableError` -> 409
  `OFFER_NOT_EDITABLE`, código nuevo en `@movo/shared`), no como una arista más del
  grafo de MOVO-102.
- **PATCH parcial real**: cada uno de los 3 campos editables (`priceOfferedArs`,
  `offeredDate`, la franja horaria propuesta) es independiente — mandar solo el precio
  no toca fecha/franja. La franja sigue siendo both-or-neither (mismo criterio que
  `POST /shipments/:id/offers`, MOVO-177), validada contra el `offeredDate` EFECTIVO
  (el nuevo si el patch también lo cambia, el ya persistido si no).
- **Mismas validaciones que la creación, reusadas, no reimplementadas**:
  `combineDateAndTime`/`normalizeTime`/`anchorDateUtc` de `shipments.service.ts` se
  exportaron (antes privadas) para que `offers.service.ts#updateOffer` valide la
  franja horaria con el mismo criterio exacto que `createOfferForShipment`. El rango
  de `offeredDate` contra `pickupDate` reusa `isWithinOfferDateRange`/
  `OFFER_DATE_MAX_FORWARD_OFFSET_DAYS`, ya privados en `offer-repository.ts` desde
  MOVO-177 — `update()` vive en el mismo archivo, sin exportarlos.
- **Compare-and-swap contra `status`, no contra los campos editables**: mismo
  mecanismo que `applyTerminalTransition` — si un accept/reject/withdraw concurrente ya
  escribió sobre la fila entre la lectura y el `UPDATE` de `update()`, `count` da 0 y
  lanza `OfferConcurrentModificationError` (409 `OFFER_CONCURRENT_MODIFICATION`, ya
  mapeado desde MOVO-144). Ojo: dos `PATCH` concurrentes entre sí NUNCA compiten por
  este mecanismo (ninguno toca `status`), así que ambos pueden aplicar — el 409 solo
  aparece contra una operación que sí cambia `status`.
- **Fila releída vía `mapOffer()` tras el `UPDATE`** (no reconstruida a mano — fix de
  review, PR #152: la versión original armaba el `Offer` devuelto campo por campo y
  quedaba desactualizada cada vez que se agregaba una columna nueva, ej. rompía `tsc`
  contra `develop` en cuanto MOVO-187/189 sumaron sus propios campos). `update()` hace
  un `findUniqueOrThrow` extra dentro de la misma transacción antes de mapear — costo
  aceptable acá (PATCH puntual, no un hot path), a diferencia de `acceptOffer`/
  `applyTerminalTransition`, que sí evitan la relectura por volumen de llamadas
  concurrentes.
- **La franja horaria propuesta admite `null` explícito en el body del PATCH** (fix de
  review, PR #152): `patchOfferBody` solo aceptaba `string` para
  `offeredPickupTimeWindowStart/End`, así que el reset a "usa la ventana del envío tal
  cual" que este mismo párrafo ya documentaba como soportado por `UpdateOfferInput`
  era en realidad inalcanzable por HTTP (400 de AJV antes de llegar a
  `offers.service.ts`). `PatchOfferInput`/`updateOffer()` distinguen ahora los tres
  casos: ambos ausentes (no tocar), ambos `string` (nueva franja, validada como
  antes) y ambos `null` (reset, sin validar rango horario) — un solo extremo, o un
  extremo `null` y el otro `string`, siguen rechazados.
- **No extiende `expiresAt` ni resetea `createdAt`** (pregunta abierta del ticket,
  resuelta a favor de la opción más simple): sigue siendo la misma oferta con el mismo
  plazo, solo cambian los campos que el transportista corrigió.
- **No hizo falta tocar el gateway**: el prefijo `/offers` ya proxea method-agnostic
  desde MOVO-145, sin filtrar por verbo HTTP.

Tests: `offer-repository.integration.test.ts` (7 casos nuevos: patch completo,
patch parcial sin tocar los campos no incluidos, rango de fecha inválido con rollback
completo, no editable sobre `accepted` y sobre `pending` vencida/`expired`, oferta
inexistente, compare-and-swap real `update()` vs `withdraw()` concurrentes) +
`offers-update.integration.test.ts` nuevo (13 casos vía HTTP: desglose neto/comisión
en la respuesta, fecha+franja juntas, `createdAt`/`expiresAt` intactos, 403 ajena, 404,
409 sobre `accepted` y sobre vencida, 422 rango de fecha, 422 ambos-o-ninguno de la
franja, 422 fin≤inicio, 400 precio≤0 (AJV, `exclusiveMinimum`), 400 body vacío
(`minProperties: 1`), 409 concurrente contra un `withdraw` en paralelo). Suite completa
del servicio 566/566 (43 archivos), corrida contra Postgres/Redis reales. `tsc --noEmit`
y `eslint` limpios. Confirmado que `app.swagger()` expone `PATCH /offers/{id}`.
**Gotcha de entorno encontrado al correr la suite en esta máquina** (mismo síntoma que
documentó MOVO-108, causa distinta): el volumen de Postgres tenía el rol `movo` con una
password desincronizada de `.env`/`docker-compose` — mismo fix, `ALTER ROLE movo WITH
PASSWORD 'movo'` (no toca datos) — y le faltaban 3 migraciones ya mergeadas a `develop`
(`create_handshake_events_table`, `add_estimated_delivery_window`,
`add_offer_pickup_time_window_override`), aplicadas con `prisma migrate deploy`.

### MOVO-187 — Snapshot de identidad y confianza del emisor visible al transportista

Agrega `senderNameAtOffer`/`senderVerifiedAtOffer`/`senderRatingAtOffer` a `Offer` —
snapshot del **emisor** al momento de ofertar, simétrico al que `MOVO-102`/`143` ya
resuelven para el transportista (`carrierNameAtOffer`/`carrierRatingAtOffer`). Mismo
criterio ya elegido para ese caso: snapshot congelado, no lectura en vivo (consistente
con el resto de `Offer`, es el dato correcto para una disputa futura, evita una llamada
cross-servicio extra en cada `GET /offers/mine`). AC4 (conteo de envíos, "34 envíos"
del mockup) no suma ninguna columna ni query nueva — reusa `transactionCounts.asSender`
que `PublicProfile`/`GET /users/:id` ya expone (MOVO-152/170); el mobile lo resuelve
por su cuenta.

- **Resuelto en `createOfferForShipment` en el mismo momento que el snapshot del
  transportista**: `usersClient.findPublicProfile(shipment.senderId, shipment.senderId)`
  para nombre/verificación, `getSenderReputationScore(shipment.senderId)` (callback
  nuevo en `ShipmentsServiceOptions`, mismo molde que `getCarrierReputationScore` —
  `getReputationSummary(senderId).asSender.reputationScore`, llamada LOCAL sin HTTP,
  wireada en `shipments.routes.ts` reusando la misma instancia de `ratingsService`)
  para la calificación.
- **Hallazgo real, corregido en el mismo cambio**: el AC3 del ticket asumía que el
  snapshot del transportista (`MOVO-143`) ya toleraba un fallo de `usersClient` sin
  bloquear la oferta ("los campos quedan null, igual que carrierRatingAtOffer puede
  serlo") — el código real no lo hacía: `usersClient.findPublicProfile` para el
  transportista no tenía ningún `try/catch`, así que un `usersClient` caído SÍ
  bloqueaba la creación de la oferta, contra lo que el propio comentario de esa línea
  ya decía. Se agregó `resolveSnapshotProfile()` (mismo patrón try/catch+`logger?.warn`
  que `createShipment` ya usa para el nombre del emisor en el copy del push) y se
  aplicó a **ambos** snapshots — no solo al nuevo del emisor, también al del
  transportista que arrastraba el gap desde `MOVO-143`. Decisión tomada con el usuario:
  se corrigen los dos juntos, no solo el archivo/alcance literal del ticket, para no
  dejar una asimetría real (un mismo tipo de fallo bloqueando la oferta por un lado y
  no por el otro).
- **Los 3 campos son nullable** (igual que sus pares de `carrier*AtOffer`): cualquier
  fallo de `usersClient`, perfil no encontrado, o ausencia de calificaciones previas
  degrada a `null`, nunca bloquea la creación de la oferta (AC3).
- **Migración a mano** (`prisma/migrations/20260912210000_add_sender_snapshot_to_offers/`),
  mismo patrón `ALTER TABLE ... ADD COLUMN` que el resto de las columnas de `Offer`
  agregadas incrementalmente (MOVO-177/180).

Tests: `test/offer-repository.integration.test.ts` (round-trip del snapshot y su
default `null`), `test/shipments-offers-create.integration.test.ts` (emisor
verificado/no verificado, con una calificación previa vía seed directo de `Rating`, y
el test de regresión del hallazgo: un `usersClient` que falla para transportista Y
emisor no bloquea la creación — los 4 campos de snapshot quedan `null`, con una `app`
propia para no afectar el resto del describe), `test/offers-mine.integration.test.ts`
(expone los 3 campos nuevos). Suite completa del servicio 537/553 (los 16 que fallan
son el mismo bug preexistente de credenciales de `offers-mine.integration.test.ts` ya
documentado en `MOVO-208`, sin relación con este ticket — verificado aparte con un rol
temporal de Postgres, ver ese mismo procedimiento). `tsc --noEmit`, `npm run build` y
`eslint` limpios. Confirmado que `app.swagger()` expone los 3 campos nuevos en
`POST /shipments/:id/offers` y `GET /offers/mine`.

Pendiente / fuera de alcance: `GET /offers/:id` (MOVO-190, bloqueado por este ticket)
todavía no existe — cuando se implemente, reusa el mismo `Offer`/`toOfferDto`, sin
trabajo adicional; DER actualizado (`docs/movo_der.dbml`, tabla `shipments.offers`).

### MOVO-208 — Extensión del set canónico de estados: `assigned_unfunded` y `completed`

Agrega dos estados al set canónico de `ShipmentStatus` (MOVO-79, cerrado en 9 desde
MOVO-105) — el enum pasa a 11 valores, en `@movo/shared` + Postgres + la máquina de
estados, en el mismo PR, conforme obliga el AC6 de `MOVO-79`. Sin disparo real todavía:
`MOVO-210` (saga de asignación) dispara las transiciones de `assigned_unfunded`,
`MOVO-212` (captura y split) dispara `delivered → completed` — ambos bloqueados por
Mercado Pago. Ver ADR-021 (`CLAUDE.md` raíz) para el razonamiento completo.

- **`assigned_unfunded`** (decisión de arquitectura del hold de `MOVO-12` "opción B"):
  transportista asignado y método de pago validado, pero sin hold creado — el retiro es
  a más de N días y el hold recién se programa a T-24h. Se inserta en
  `shipment-state-machine.ts#VALID_TRANSITIONS` como rama ALTERNATIVA a
  `assignment_pending` desde `published` (no un paso adicional de esa misma ruta):
  `published → assigned_unfunded → {assigned, published, cancelled}`. **Nunca sale
  hacia `in_transit` directo** (AC2 del ticket) — un envío sin hold confirmado no puede
  retirarse, tiene que pasar por `assigned` primero.
- **`completed`**: entrega confirmada Y pago liberado — terminal, sin salidas, entra
  solo desde `delivered → completed`. Es una consecuencia POSTERIOR de `delivered`, no
  un resultado alternativo — decisión que gobierna todo lo de abajo.
- **Migración escrita a mano** (`prisma/migrations/
  20260912200000_add_assigned_unfunded_and_completed_states/`, mismo patrón que
  `svc-users` en `20260805235652_add_kyc_verification_movo_72`): dos `ALTER TYPE ...
  ADD VALUE ... AFTER ...` (Postgres 16 soporta `BEFORE`/`AFTER` y permite correrlo
  dentro de una transacción normal si el valor nuevo no se usa en la misma transacción).
  **Reversibilidad (AC1)**: Postgres no soporta `DROP VALUE` nativo — el camino
  documentado como comentario en la propia migración recrea el tipo sin los 2 valores
  nuevos (`CREATE TYPE ..._old` + `ALTER TABLE ... USING ...` + `DROP TYPE` + `RENAME
  TYPE`). Hallazgo real escribiendo el test de reversibilidad: el `DEFAULT` de
  `shipments.status` (`awaiting_receiver_confirmation`) no castea automático al tipo
  nuevo — hay que `DROP DEFAULT` antes del `ALTER COLUMN ... TYPE` y `SET DEFAULT` de
  nuevo al final, contra el tipo ya renombrado. Verificado en
  `test/migration-reversibility.integration.test.ts`, que corre ese camino completo
  dentro de una transacción de Prisma que nunca se commitea (lanza un sentinel al
  final) — prueba el SQL contra Postgres real sin tocar la base de dev.
- **Alcance ampliado, confirmado con el usuario**: 4 lugares que comparaban
  `status === DELIVERED` a secas en features ya shippeadas se corrigieron para tratar
  `completed` como equivalente — sin esto, se habrían roto silenciosamente recién
  cuando `MOVO-212` empezara a mover envíos reales a `completed` (no ahora, pero sí un
  bug latente sobre código ya en producción). Nuevo export
  `FULFILLED_SHIPMENT_STATUSES: readonly ShipmentStatus[] = [DELIVERED, COMPLETED]` en
  `shipment-state-machine.ts`, reusado en:
  - `shipment-repository.ts#hasActiveShipmentsForUser` (MOVO-134, baja de cuenta): el
    `notIn` de "no activo" suma `COMPLETED` junto a `DELIVERED`/`REJECTED_BY_RECEIVER`/
    `CANCELLED` — sin esto, un envío `completed` bloquearía la baja de cuenta para
    siempre. `ASSIGNED_UNFUNDED` sigue contando como activo por default, correctamente
    (no se agregó a ningún lado).
  - `countCompletedTransactions`/`countDeliveredAsCarrierByIds` (MOVO-147 reputación,
    MOVO-188 desempate de ranking): `status: DELIVERED` → `status: { in:
    FULFILLED_SHIPMENT_STATUSES }`.
  - `getSharedHistory#allDelivered` (MOVO-170): un envío `completed` también cuenta
    como "llegó a destino". Comparación con `===` explícito (`r.status ===
    ShipmentStatus.DELIVERED || r.status === ShipmentStatus.COMPLETED`), no
    `.includes()` sobre el array — `r.status` acá es el enum generado por Prisma
    (string literal), no el enum de `@movo/shared`, así que `Array.includes()` no
    tipa contra él aunque `===` sí (comparación con overlap de literales).
  - `ratings.service.ts#assertRatingWindowAllowsWrite` (MOVO-146/153, gate de
    calificación): pasa de exigir `status === DELIVERED` exacto a `!FULFILLED_
    SHIPMENT_STATUSES.includes(shipment.status)` — sin esto, nadie podría calificar un
    envío una vez que llega a `completed`. `deliveredAt` sigue siendo la referencia real
    de la ventana de 72hs en los dos casos, no se toca al transicionar a `completed`.
- **Deliberadamente NO tocado** (depende de decisiones de `MOVO-210`/backend, no de
  este ticket): `shipments.service.ts` (gate HTTP de cancelación, sigue bloqueando
  `assigned` con 409 y no conoce `assigned_unfunded` — la máquina de estados ya permite
  `assigned_unfunded → cancelled`, pero conectar el endpoint real es trabajo de
  `MOVO-210`); `trip-repository.ts#ACCEPTED_OFFER_FILTER` (ya excluye solo `CANCELLED`,
  así que `completed`/`assigned_unfunded` quedan incluidos por default correctamente,
  sin tocar nada); `movo-mobile#canCancelShipment` (mismo motivo que el gate HTTP: no
  tiene sentido ofrecer un botón que el backend today rechazaría).
- **Mobile** (`movo-mobile/src/lib/shipment-format.ts`, `components/shipments/
  timeline-section.tsx`, `app/(app)/shipments/index.tsx`): obligatorio por AC6 del
  propio ticket (verificar que MOVO-128/MOVO-27 rendericen los estados nuevos con
  etiqueta legible) y porque `STATUS_LABEL`/`EVENT_ICON` son `Record<ShipmentStatus,
  ...>` exhaustivos — no compilan sin las 2 claves nuevas. `HAPPY_PATH` suma `completed`
  al final de `delivered` (relación 1:1 sin ambigüedad); **no** suma `assigned_unfunded`
  — es una rama alternativa a `assignment_pending`, insertarla en el array lineal
  rompería `remainingLifecycleSteps` de la rama existente, queda documentado como
  decisión de producto pendiente. Ver `movo-mobile/CLAUDE.md` para el detalle.
- **`MOVO-192`/`MOVO-206`** (los otros dos endpoints que el AC6 pide verificar) **no
  existen todavía como código** (ambos en estado `Todo`) — sus propios ACs ya
  referencian `assigned_unfunded`/`completed` explícitamente, así que quedan listos
  para consumir el enum extendido cuando se implementen; no había nada que romper hoy.
- **`delivery_failed` evaluado y descartado** (decisión explícita del ticket, no un
  olvido): 5 preguntas de negocio sin responder (hold, reversión a `published`, quién
  declara la falla, si es lo mismo que `disputed`, qué pasa con el paquete físico) — ver
  la nota dedicada en `docs/shipments/state-diagram.md`.
- **DTE/DER actualizados**: `docs/shipments/state-diagram.md` (Mermaid, 11
  estados/18 transiciones, nota de `delivery_failed`) y `docs/movo_der.dbml`.

Tests: `test/shipment-state-machine.test.ts` (5 transiciones válidas + 4 inválidas
nuevas, incluida `assigned_unfunded → in_transit` del AC2, y `completed` sumado al
array de estados terminales del test de "todo estado no terminal tiene salida"),
`test/migration-reversibility.integration.test.ts` (nuevo, contra Postgres real),
`test/account-deletion.integration.test.ts` (caso `assigned_unfunded` activo +
`completed` sumado al `it.each` de terminales), `test/shipments-history-with.
integration.test.ts` (un envío `completed` cuenta como `allDelivered: true`),
`test/ratings.integration.test.ts` (calificar un envío `completed` funciona igual que
uno `delivered`; `transactionCounts` cuenta `completed` igual que `delivered`).
Verificado también manualmente contra `offers-mine.integration.test.ts` (cubre
`countDeliveredAsCarrierByIds`) con un rol Postgres temporal — ese archivo tiene un bug
preexistente sin relación (credenciales hardcodeadas `user:password` en vez de
`movo:movo`, `ec0c7973`, `ldalmagro1`, 2026-08-25) que le impide correr en este entorno
tal como está: no se tocó, es de otro ticket. Suite completa del servicio: 547/562 (los
15 que fallan son ese mismo archivo, por el bug preexistente, no por este cambio).
`tsc --noEmit` limpio en `svc-shipments` y `movo-mobile`.

Pendiente / fuera de alcance: disparo real de las transiciones (`MOVO-210`/`MOVO-212`,
bloqueados por Mercado Pago); `delivery_failed` (evaluado y descartado, ver arriba);
gate HTTP de cancelación desde `assigned_unfunded` y botón de cancelar en mobile para
ese estado (dependen de `MOVO-210`); ADR-021 redactado en `CLAUDE.md` raíz, pendiente
de que el usuario lo publique en Drive (decisión explícita, no un olvido); bug
preexistente de credenciales en `offers-mine.integration.test.ts` (de otro ticket, no
se tocó).

#### ADR-021 completo (texto para pegar en Drive, `[Movo] 004 - Sprint 0.md`)

> **ADR-021 — Extensión del set canónico de `ShipmentStatus`: `assigned_unfunded` y `completed`**
>
> **Contexto**
>
> `MOVO-79` (criterio 6) cerró el set canónico de `ShipmentStatus` en 9 valores, con una
> regla explícita: agregar un valor obliga a actualizar, en el mismo PR, el enum de la
> migración, `ShipmentStatus` de `@movo/shared` y el AC3 de `MOVO-19`. Este ADR
> documenta por qué se reabre esa decisión (`MOVO-208`) y qué se agrega.
>
> Dos motivos distintos, detectados al refinar el hold de fondos (`MOVO-12`):
>
> 1. **La decisión de arquitectura del hold (`MOVO-12`, "opción B")**: la reserva de
>    Mercado Pago caduca en 5 a 7 días. Si el hold se crea en la aceptación de la
>    oferta (como hacía `assignment_pending` hasta ahora) y el retiro real ocurre
>    varios días después, la reserva puede morir antes de que el paquete se mueva —
>    esto rompe el caso normal de la plataforma (transportistas que planifican viajes
>    con anticipación), no un caso borde. La opción B ancla el hold cerca del retiro:
>    con retiro cercano, se reserva en la aceptación (`assignment_pending`, sin
>    cambios); con retiro lejano, se valida el método de pago pero **no se crea
>    reserva todavía**, y un job la crea a T-24h de la ventana de retiro. Ese estado
>    intermedio — transportista asignado, sin hold — no tiene representación en el set
>    canónico actual: `assigned` está definido como "hold confirmado, transportista
>    asignado" y ese significado no se puede estirar para cubrir "sin hold".
> 2. **`delivered` como único estado final del camino feliz**: después de la entrega
>    todavía falta capturar el pago (`MOVO-13`) y calificar (`MOVO-22`). No hay forma de
>    distinguir un envío entregado y cobrado de uno entregado y pendiente de cobro, ni
>    de saber cuándo un envío está realmente cerrado.
>
> **Decisión**
>
> Se agregan dos estados, el set canónico pasa de 9 a 11:
>
> | Estado | Significado | Entradas | Salidas |
> | -- | -- | -- | -- |
> | `assigned_unfunded` | Transportista asignado y método de pago validado, pero sin hold creado todavía. El retiro es a más de N días. | `published → assigned_unfunded` | `→ assigned` (hold programado exitoso), `→ published` (hold programado fallido), `→ cancelled` |
> | `completed` | Entrega confirmada, pago liberado y proceso cerrado. Terminal. | `delivered → completed` | Ninguna. Terminal |
>
> `assigned_unfunded` nunca transiciona a `in_transit` directo: un envío sin hold
> confirmado no puede retirarse, tiene que pasar por `assigned` primero — es la
> salvaguarda concreta que impide retirar un paquete sin fondos reservados.
>
> Ninguna de las dos transiciones se dispara todavía: `MOVO-210` (saga de asignación)
> dispara las de `assigned_unfunded`, `MOVO-212` (captura y split) dispara
> `delivered → completed`. Ambos bloqueados por Mercado Pago (caso de soporte
> escalado, sandbox con error en `application_fee` + Auth & Capture). Este ADR y su
> implementación (`MOVO-208`) dejan las transiciones disponibles y probadas en la
> máquina de estados, sin esperar a que MP se destrabe — mismo criterio ya aplicado en
> `MOVO-158` con `FundsReleaseNotifier`.
>
> **Nombre de `assigned_unfunded`**: elegido por consistencia con el estilo del enum
> existente (snake_case descriptivo) y porque deja explícito que el transportista **sí**
> está asignado, lo que falta son los fondos. Alternativas descartadas:
> `awaiting_funds_hold` (no comunica que ya hay transportista asignado) y
> `pending_funds` (ambiguo respecto de `assignment_pending`, el estado ya existente).
>
> **`delivery_failed`: evaluado y descartado explícitamente**
>
> No se agrega. Hoy no tiene transiciones de salida definidas y sería un estado al que
> se puede entrar sin saber cómo salir — peor que no tenerlo. Preguntas sin responder
> antes de poder agregarlo:
>
> - ¿Qué pasa con el hold de fondos? ¿Se libera, se reembolsa al emisor, se paga
>   parcialmente al transportista por el traslado hecho?
> - ¿El envío vuelve a `published` para que otro transportista lo tome, o queda
>   cerrado?
> - ¿Quién puede declarar la falla: el transportista, el receptor, un admin, o un
>   timeout automático?
> - ¿Se diferencia de `disputed`, o una entrega fallida **es** una disputa?
> - ¿Qué pasa con el paquete físicamente, que sigue en manos del transportista?
>
> Queda registrado como el hueco más importante del camino de excepción del proyecto,
> con impacto concreto en `MOVO-199` (si el receptor no aparece, el envío queda en
> `in_transit` indefinidamente y el transportista se queda con el paquete sin salida en
> el sistema). Se resuelve con los estados existentes mientras tanto (`cancelled` con
> `reason`, o `disputed`).
>
> **Trade-off aceptado**
>
> La máquina de estados ya permite un camino (`assigned_unfunded`, y la transición a
> `completed`) que ningún endpoint HTTP dispara todavía — documentado explícitamente
> como "disponible y probado, no disparado" en vez de dejarlo implícito. El riesgo es
> bajo porque el propio bloqueo de Mercado Pago hace que sea imposible alcanzar estos
> estados en producción hasta que `MOVO-210`/`MOVO-212` existan; el riesgo real que sí
> se mitigó en el camino es que otras 4 features ya shippeadas (baja de cuenta,
> reputación, historial compartido, calificaciones) que asumían `delivered` como único
> estado post-entrega quedaron corregidas para tratar `completed` como equivalente,
> antes de que `MOVO-212` pudiera exponer ese bug en producción.
>
> **Referencias**: `MOVO-208` (este ticket), `MOVO-12` (decisión de arquitectura del
> hold), `MOVO-210` (saga de asignación), `MOVO-212` (captura y split), `MOVO-79`/
> `MOVO-105` (set canónico original).
**Gap encontrado después, al trabajar MOVO-189 (sin corregir, fuera de alcance de esa
US)**: `GET /shipments/:id/offers` usa su propio `offerResponse` en
`shipments.schema.ts` (autocontenido, no importa de `offers.schema.ts`) que nunca sumó
`priceNetArs`/`commissionAmountArs` -- pese a que el título de esta US dice "todas las
respuestas de oferta", ese endpoint sigue sirviendo solo el bruto (fast-json-stringify
descarta en silencio cualquier campo que `toOfferDto` agregue pero el schema no
declare). No tiene test que lo hubiera detectado (`shipments-offers-list.integration.test.ts`
no verifica esos dos campos). Pendiente: sumarlos ahí también.

### MOVO-189 — Tracking de "vista" del emisor sobre una oferta recibida

Backend puro del mockup "Transportista - Mis Ofertas" (MOVO-151/182): sumó
`viewedAtBySender: Date | null` a `Offer` (migración
`20260912190000_add_offer_viewed_at_by_sender`), expuesto crudo (sin traducir a copy,
eso es de UI) en los 5 endpoints que devuelven una oferta (`GET /shipments/:id/offers`,
`GET /offers/mine`, accept/reject/withdraw).

Decisiones clave:
- **Opción (a) del refinamiento**: cualquier `GET /shipments/:id/offers` marca como
  vistas las `pending` efectivas del envío (no expiradas -- reusa `offerStatusWhere`,
  MOVO-102/188) que todavía tuvieran `viewedAtBySender: null`. Un solo `updateMany`
  nuevo (`offer-repository.ts#markPendingOffersViewedBySender`), corrido antes de
  `listByShipment` para que la misma respuesta ya refleje el valor recién seteado.
- **Solo cuenta si el caller es el EMISOR real, no un admin auditando** (AC1 habla
  específicamente de "el emisor vio"): `listShipmentOffers` compara
  `callerId === shipment.senderId` antes de marcar, aunque `assertIsSenderOrAdmin` deje
  pasar a ambos por igual.
- **Best-effort, mismo criterio que las notificaciones push**: `try/catch` +
  `logger?.warn` alrededor del `updateMany` -- un fallo ahí nunca bloquea la respuesta
  200 con las ofertas.
- **`GET /offers/:id` (mencionado en el AC2 del ticket) no existe todavía** -- es
  MOVO-190, bloqueado por esta US. El campo ya viaja en el modelo/DTO compartido para
  que ese ticket lo herede sin tocar nada acá.

Tests nuevos en `shipments-offers-list.integration.test.ts` (primera lectura marca,
segunda no pisa; oferta creada después de la primera lectura aparece `null` hasta la
próxima; un admin que lista no marca nada; una oferta ya `rejected` conserva el valor
que tenía al resolverse) y uno en `offers-mine.integration.test.ts` (expone el campo,
pasa de `null` a seteado tras la lectura del emisor). Suite completa del servicio
551/551, `tsc --noEmit` y `eslint` limpios. Confirmado que `app.swagger()` expone el
campo nuevo en los 5 endpoints. DER (`docs/movo_der.dbml`) actualizado con la columna.

### MOVO-219 — Integración de desvío marginal en el feed de viajes (`GET /trips/:id/matches`)

Integración entre `svc-shipments` y `svc-pricing-logistics` para enriquecer y ordenar los envíos disponibles que hacen match con un viaje registrado por un transportista:

- **Adapter `PricingLogisticsClient`** (`src/adapters/pricing-logistics-client.ts`):
  - Consume `POST /routes/evaluate-candidates` del servicio de ruteo y precios con timeout estricto de 1000 ms (`AbortSignal.timeout(1000)`).
  - Cumple política *No-Fallback* (ADR-021): si el servicio de ruteo falla o agota el timeout, lanza `ApiError` 503 `ROUTING_SERVICE_UNAVAILABLE` o 502 `ROUTING_SERVICE_ERROR`, propagado directamente al cliente HTTP sin inventar estimaciones o falsear métricas de desvío.
  - Códigos de error incorporados en `ApiErrorCode` de `@movo/shared`.
- **Pipeline de evaluación en `trips.service.ts` (`getTripMatches`)**:
  - Prefiltro geométrico/temporal en base de datos: corredor $\le 15$ km y misma fecha calendario de Argentina.
  - Retorno temprano si la consulta previa arroja 0 candidatos (evita llamadas de red innecesarias a `svc-pricing-logistics`).
  - Consulta a `pricingLogisticsClient.evaluateCandidates`, descarte de resultados inviables (`feasible === false`), enriquecimiento con `detourDistanceKm` y `detourDurationMinutes`, y ordenamiento ascendente por `detourDistanceKm`.
- **Contratos y DTOs (`trips.schema.ts`, `models/shipment.ts`, `trips.routes.ts`)**:
  - `MatchedShipment extends AvailableShipment` con `detourDistanceKm: number` y `detourDurationMinutes: number`.
  - `availableShipmentResponse` en Fastify Swagger actualizado con validación estricta de ambos campos obligatorios.
  - `pricingLogisticsClient` requerido en `TripsServiceDeps` (no opcional), garantizando evaluación No-Fallback consistente.
  - Fail-safe estricto: candidatos no evaluados o sin métricas en la respuesta de ruteo se descartan, nunca se asumen viables ni con desvío cero.
  - Preservación del conteo `total` del prefiltro de base de datos para cálculo consistente de paginación.
  - Protección ante JSON malformado en `PricingLogisticsClient` mapeado a `502 ROUTING_SERVICE_ERROR`.

Tests: 6 tests unitarios en `test/pricing-logistics-client.test.ts`, 5 tests nuevos en `test/trips-service.test.ts` y 2 tests en `test/trips.routes.test.ts`. 139/139 tests unitarios pasando limpios, `tsc --noEmit` y `npm run lint` sin errores ni warnings.

### MOVO-192 — Endpoints de envíos activos por rol (`/sending`, `/transporting`, `/receiving`)

Backend de `MOVO-191`/`MOVO-193` (home operativo del mobile, ya implementado contra un
mock del contrato). Tres endpoints nuevos en `shipments.routes.ts`
(`registerActiveShipmentsRoute`, un solo registrador parametrizado por rol en vez de
tres bloques casi idénticos): `GET /shipments/sending|transporting|receiving`, cada uno
devuelve los envíos "activos" (`ACTIVE_SHIPMENT_STATUSES` nuevo en
`shipment-state-machine.ts` — `assigned_unfunded`/`assigned`/`in_transit`, MOVO-208 ya
mergeado) donde el caller participa en el rol correspondiente. Sin paginación (fuera de
alcance del AC).

Decisiones clave:
- **Contrato tomado tal cual lo dejó comentado el equipo mobile en Linear** (camelCase,
  no el snake_case literal del AC5; `counterparty` como objeto `{name, initials}`) en
  vez de renegociarlo — `movo-mobile/src/api/shipments-client.ts#ActiveShipmentSummary`
  ya lo consume así desde `MOVO-193`. El tipo se movió a `@movo/shared`
  (`types/shipment.ts#ActiveShipmentSummary`/`ActiveShipmentStatus`/
  `ActiveShipmentCounterparty`), como pedía el propio comentario del ticket — el mobile
  sigue con su copia local hasta que migre a importarlo desde ahí (fuera de alcance de
  este ticket, que es 100% backend).
- **`agreedPriceArs` quedó `number | null`, no `number`** (el tipo que mobile había
  mockeado): la columna real (`shipments.agreed_price_ars`) sigue nullable y **ningún
  flujo la puebla todavía** — `offer-repository.ts#acceptOffer` fija `carrierId`/
  `estimatedDeliveryDate` al pasar a `assignment_pending` pero nunca `agreedPriceArs`
  (gap preexistente, anterior a esta US, sin ticket propio). En la práctica un envío
  activo siempre responde `agreedPriceArs: null` hoy — documentado explícitamente en
  vez de mentir con un `number` que el backend no puede garantizar.
- **"Contraparte relevante" (AC5) resuelta contra la matriz de acción contextual del
  AC4 de `MOVO-191`, no un campo fijo por rol** (`domain/active-shipment.ts
  #resolveActiveShipmentCounterpartyId`): `sending`/`receiving` siempre ven al
  transportista asignado (con quien coordinan retiro/entrega); `transporting` ve al
  emisor mientras el paquete no salió (`assigned_unfunded`/`assigned`, la próxima
  acción es retirarlo) y pasa a ver al receptor una vez `in_transit` (la próxima acción
  es entregarlo) — es el único de los tres roles donde la contraparte no es fija.
  Decisión propia (no estaba en ningún AC literal), justificada en el comentario de la
  función.
- **`isToday`/`pickupWindowExpired` (AC6) como funciones puras nuevas**
  (`domain/active-shipment.ts#isShipmentPickupToday`/`isActiveShipmentPickupWindowExpired`),
  reusando `toArgentinaCalendarDateString` (`@movo/shared`) e `isPickupWindowExpired`
  (`pickup-window.ts`, MOVO-142) en vez de reimplementar el cálculo. `pickupWindowExpired`
  es siempre `false` en `in_transit` sin importar la fecha: un envío ya retirado no
  tiene ventana de retiro pendiente (AC6 lo pide explícito: "y el envío SIGUE en
  `assigned`/`assigned_unfunded`").
- **`getInitials` duplicada a propósito** (mismo algoritmo que
  `movo-mobile/src/lib/profile-format.ts#getInitials`, primera letra del primer y del
  último término): no hay ningún módulo de formato de texto compartido entre Node y
  React Native en `@movo/shared` hoy, y esta única función no ameritaba crear uno.
- **`usersClient.findPublicProfile` deduplicado por contraparte, no uno por ítem**:
  varios envíos activos del mismo caller pueden compartir la misma contraparte (mismo
  transportista en dos envíos, por ejemplo) — `listActiveShipments` arma un `Set` de
  ids únicos antes de resolver perfiles. Un fallo de red en esa resolución no tira la
  lista completa (try/catch + fallback `"Usuario de Movo"`/`"?"`, mismo criterio
  best-effort que `resolveSnapshotProfile`).
- **AC10 (índice sobre `carrier_id`) ya existía**: `shipments_carrier_id_idx` se
  agregó en una migración anterior (`20260828210000_add_shipments_status_lat_lng_indexes`
  o previa) — verificado en `prisma/schema.prisma`, sin necesidad de migración nueva.
- **Autorización (AC8) sin capa adicional**: a diferencia de `getShipmentDetail`, acá
  no hace falta ningún chequeo de acceso más allá de JWT válido — la query del
  repositorio (`shipment-repository.ts#listActiveShipments`) ya filtra por
  `senderId`/`carrierId`/`receiverId === callerId`, así que no hay ninguna fila ajena
  que autorizar o rechazar.

Tests: `test/active-shipment.test.ts` (unitario, dominio puro — bordes de medianoche
argentina de `isShipmentPickupToday`, `pickupWindowExpired` por estado,
`resolveActiveShipmentCounterpartyId` en los 3 roles incluyendo el cambio de
contraparte de `transporting` en `in_transit`, `getInitials`) y
`test/shipments-active.integration.test.ts` (Postgres real — un usuario emisor de un
envío y transportista de otro aparece en ambos endpoints y no en el tercero,
`assigned_unfunded` cuenta como activo, `published`/`assignment_pending` no cuentan,
autorización, lista vacía 200, orden por `pickupDate`+`pickupTimeWindowStart`, los tres
casos de contraparte, DTO sin ids crudos). Suite completa del servicio 626/626 (1 fallo
intermitente en un archivo no relacionado, `shipments-offers-create.integration.test.ts`,
reproducido también en aislado antes de este cambio — timeout de conexión bajo carga de
toda la suite corriendo junta, no una regresión). `tsc --noEmit` y `eslint` limpios.
Confirmado que `app.swagger()` expone los 3 paths nuevos.

Pendiente / fuera de alcance: paginación (explícitamente fuera del AC); mobile
consumiendo el endpoint real en vez de su mock (`MOVO-193` ya está Done contra el mock,
migrar es un ajuste de esa rama, no de este ticket); "Estoy transportando" en el home
(fase 2 de `MOVO-193`, todavía no llama a `GET /shipments/transporting`).

### MOVO-196 — Exigir evidencia fotográfica del stage antes de permitir el handshake

Cierra el hueco que dejaba MOVO-158: el handshake de retiro/entrega se podía confirmar
sin una sola foto. Sin migración — `PhotoStage.pickup`/`.delivery` ya existían en el
enum desde MOVO-104, sin habilitar hasta ahora en el contrato HTTP ni en ninguna regla
de negocio.

Decisiones clave:
- **El ticket pedía `src/repositories/shipment-photo-repository.ts` (no existe)**: la
  consulta nueva (`countPhotosByStage`) se agregó a `shipment-repository.ts`, junto a
  `addPhoto`/`listPhotos`/`existsPhotoByS3Key` — este servicio nunca tuvo un
  repositorio de fotos separado (MOVO-81).
- **`PHOTO_STAGE_VALUES` en `shipments.schema.ts` solo tenía `"creation"`** pese a que
  el dominio (`PhotoStage`, `addPhoto`) ya era genérico por stage desde MOVO-104 — el
  propio comentario del archivo ya anticipaba este ticket como el que sumaría
  `pickup`/`delivery` ahí. Sin este cambio, AJV rechazaba con 400 cualquier
  `stage: pickup|delivery` antes de llegar a la capa de autorización.
- **`MIN_EVIDENCE_PHOTOS_PER_STAGE`/`MAX_EVIDENCE_PHOTOS_PER_STAGE`** (`domain/
  evidence-photos.ts`, nuevo, 1 y 5): constantes nombradas, no un literal embebido —
  mismo criterio que `MIN_CREATION_PHOTOS_TO_PUBLISH` (MOVO-81) para la misma frase del
  AC ("no hardcodeada en el flujo"). Distinto módulo porque es una regla de negocio
  distinta (gatea el handshake, no `-> published`) sin relación con `creation`.
- **AC5 corrige un gap real, no solo agrega uno nuevo**: `photos.service.ts` nunca
  restringía `presign`/`confirm` por `stage` — solo exigía `callerId === senderId` sin
  importar qué etapa se mandara, así que el emisor ya podía (sin que nada lo evitara)
  presignar `stage: pickup`, y el transportista no podía subir nada en absoluto.
  `assertCanRegisterPhoto()` (nuevo, `photos.service.ts`) resuelve los dos: `creation`
  sigue siendo del emisor, `pickup`/`delivery` pasan a `assertIsCarrier` (mismo helper
  que ya usaba el handshake, MOVO-158).
- **Orden de validación del handshake (AC3)**: el chequeo de evidencia se insertó en
  `confirmHandshake` DESPUÉS de la autorización (`assertIsCarrier`/`assertIsReceiver`)
  pero ANTES de `findDeviceKey`/verificación de firma/distancia — evita pagar la
  llamada a `svc-users` y el WebCrypto verify en un intento que de todas formas iba a
  fallar. `stage` sigue viniendo del desafío pendiente de Redis, nunca de
  `shipment.status` (no se tocó esa parte, sigue siendo la fuente de verdad fijada por
  el fix de concurrencia de MOVO-158).
- **AC8 (tope de 5) sin código de error dado por el ticket**: se agregó
  `PHOTO_STAGE_LIMIT_EXCEEDED` (422), familia `PHOTO_*` existente. Solo aplica a
  `pickup`/`delivery` — `creation` no tiene tope propio (MOVO-81 solo le puso mínimo).
- **`GET /:id/evidence-status` (AC6) con autorización propia, no `assertShipmentAccess`**:
  el transportista asignado también necesita consultarlo antes de intentar el
  handshake, y ese helper compartido no conoce `carrierId` — mismo criterio inline que
  ya usó el AC8 de MOVO-142 en `getShipmentDetail`. `stage: null` (con
  `satisfied: true`) para cualquier estado del envío sin handshake pendiente.

Tests: 2 casos nuevos en `handshake-service.test.ts` (los dos códigos de rechazo +
assert de que `findDeviceKey` nunca se llama cuando falta evidencia), 5 casos nuevos en
`handshake.integration.test.ts` (sin evidencia en retiro/entrega, una foto solo
presignada-nunca-confirmada no cuenta, reintento exitoso con el mismo nonce tras
agregar la evidencia) + 4 casos nuevos de `GET /:id/evidence-status`, 6 casos nuevos en
`photos.integration.test.ts` (autorización por etapa en las dos direcciones, tope de 5
en `pickup`). Los fixtures compartidos de retiro/entrega de `handshake.integration.test.ts`
ahora seedean evidencia por default (`withPickupEvidence`/`withDeliveryEvidence`,
default `true`) para no romper los tests preexistentes que no son sobre MOVO-196. Suite
completa del servicio 657/657 (47 archivos), corrida contra Postgres/Redis reales.
`tsc --noEmit` y `eslint` limpios en los archivos de esta US. Confirmado que
`app.swagger()` expone `/shipments/{id}/evidence-status`.

Pendiente / fuera de alcance (explícito del ticket): comparación automática
creation↔pickup para detectar daños (visión por computadora, a registrar como historia
futura); visibilidad agrupada de fotos por stage para emisor/receptor/admin (MOVO-194).
### MOVO-206 — Agregación de paradas del transportista y contrato con pricing-logistics (`GET /shipments/my-route`)

Endpoint `GET /shipments/my-route` en `shipments.routes.ts`: agrega las paradas activas
del transportista autenticado y consulta el solver VRPTW multi-parada de
`movo-svc-pricing-logistics` (`POST /optimize/route`, MOVO-205). Base operativa para la
pantalla mobile del mapa y recorrido de entrega (MOVO-10 / MOVO-207).

Decisiones clave:
- **Cálculo on-demand sin persistencia (AC7 / AC9):** A diferencia de la Spike MOVO-50
  (donde se planteó una `solution_cache` para la aceptación puntual de una oferta en el
  feed), acá se calcula en tiempo real a partir de la posición GPS actual del
  transportista (`lat`, `lng`). Al completarse o cancelarse una parada (AC3 de MOVO-10 /
  MOVO-207), el recálculo natural excluye las paradas completadas de inmediato, sin
  requerir invalidación distribuida de caché. OR-Tools resuelve 2-10 paradas en <15ms.
- **Composición de paradas (AC2):**
  - `assigned`: aporta 2 paradas (`pickup` y `delivery`).
  - `in_transit`: aporta 1 parada (solo `delivery`, ya retirado).
  - `assigned_unfunded`: no aporta paradas (retiro a más de N días, no ejecutable hoy).
  - `delivered` / `completed`: no aportan paradas.
- **Degradación heurística resiliente (AC6):** Si `movo-svc-pricing-logistics` falla
  (502, 503, timeout de 1000ms), no se responde error 500 al transportista: se devuelve
  la lista de paradas ordenada heurísticamente (retiros antes que entregas, y dentro de
  cada grupo por ventana horaria de inicio) con `optimized: false` y disclaimer visible.
- **Ruta vacía limpia (AC4):** Si el transportista no tiene paradas activas, responde 200
  con `stops: []`, `totalDistanceKm: 0`, `totalDurationMinutes: 0`, `optimized: true`
  sin llamar a OR-Tools.
- **Autorización estricta (AC8):** Solo el transportista autenticado (`x-user-id` del
  JWT) obtiene su propia ruta. No se acepta `carrierId` por parámetro.
- **Contratos tipados en `@movo/shared`:** `CarrierRoute` y `CarrierRouteStop`
  exportados en `types/routing.ts` para consumo coordinado entre backend y mobile.

Tests: `test/carrier-route.test.ts` (9 tests unitarios puros de dominio),
`test/pricing-logistics-client.test.ts` (10 tests del adapter, incluyendo `optimizeRoute`
con timeouts y errores 502/503), `test/shipments-my-route.service.test.ts` (4 tests de
servicio), `test/shipments-my-route.routes.test.ts` (5 tests de endpoints HTTP). Total:
28 tests nuevos, 127/127 unitarios de shipments pasando limpios, `tsc --noEmit` y `npm run lint`
100% en verde.

### MOVO-222 — `GET /shipments/pending-ratings`: envíos con calificaciones pendientes de dar

Cierra el gap que `use-attention-tasks.ts` (mobile, MOVO-193) había dejado documentado
en su propio comentario: no existía ningún endpoint que listara, para el usuario
autenticado, los envíos entregados donde todavía falta calificar a una contraparte
(`ratings-client.ts` solo permite crear/leer una calificación puntual). Endpoint nuevo
`GET /shipments/pending-ratings` (`shipments.routes.ts`/`.service.ts`/`.schema.ts`) +
dominio puro nuevo `src/domain/pending-rating.ts`.

Decisiones clave:
- **Endpoint dedicado, no un campo en `GET /shipments/mine`** (la alternativa que el
  propio ticket dejaba planteada) — decisión tomada con el usuario. `/mine` nunca
  incluyó envíos donde el usuario es solo `carrierId` (gap desde MOVO-80), y el DoD del
  ticket pide explícitamente el caso "transportista con 2 contrapartes" — ampliar el
  filtro de `/mine` para cubrirlo habría cambiado la paginación/orden de 3 pantallas
  mobile ya existentes (`RecentShipmentsSection`, "Mis Envíos", `use-attention-tasks.ts`)
  fuera del alcance de este ticket (100% backend). `shipmentRepository.
  findPendingRatingCandidates()` (nuevo) escanea sender+receiver+carrier, a diferencia
  de `listByUser()` (`/mine`).
- **Regla de "interacción física" de MOVO-153 reproducida del lado del backend por
  primera vez** (`pending-rating.ts#expectedRateeRoles`): emisor y receptor solo
  califican al transportista, el transportista califica a ambos. `ratings.service.ts`
  (MOVO-146) nunca impuso este pareo -- deja que cualquier parte califique a cualquier
  otra -- así que sin esta función el flag hubiera podido sugerir, ej., que el emisor
  tiene pendiente calificar al receptor, algo que el mobile nunca ofrece.
- **Solo se listan envíos con algo pendiente** (`pendingRatingFor` nunca viaja vacío en
  un ítem) -- el servicio filtra server-side en vez de forzar a cada consumidor a
  chequear el largo del array, mismo motivo por el que se descartó el campo en `/mine`
  ("no cargar el endpoint con un dato que la mayoría no necesita").
- **`RatingRole`/`PendingRatingShipment` migrados a `@movo/shared`** (primera vez que
  `RatingRole` cruza el barrel compartido -- antes vivía duplicado como enum Prisma en
  el backend y como literal propio en `movo-mobile/ratings-client.ts`).
- **`rating-repository.ts#listByRaterForShipments`** (batch, mismo criterio N+1 que
  `listForReputationByRateeIds` de MOVO-188) resuelve qué ya calificó el caller sin una
  query por candidato.
- Sin paginación (mismo criterio que MOVO-192): el volumen realista (envíos entregados
  en las últimas 72hs con algo pendiente) nunca es grande.

Tests: `test/pending-rating.test.ts` (dominio puro -- las 3 reglas de pareo, ventana
vencida, disputa, `completed` también calificable, ajeno al envío),
`test/shipments-pending-ratings.service.test.ts` (mocks -- wiring del servicio, ventana
de candidatos, filtrado de ítems sin nada pendiente),
`test/shipments-pending-ratings.integration.test.ts` (Postgres real -- los 3 casos
límite del DoD: ventana vencida, ya calificado, transportista calificado parcialmente
con 2 contrapartes; más un test de regresión explícito confirmando que el mismo envío
NO aparece para el transportista en `GET /shipments/mine`, la razón real del endpoint
dedicado). Suite completa del servicio verificada contra Postgres/Redis reales: 673
tests pasan (las 17 fallas de `offers-mine.integration.test.ts` son el bug preexistente
de credenciales ya documentado en MOVO-208, sin relación con este ticket). `tsc --noEmit`
y `eslint` limpios. Confirmado que `app.swagger()` expone `/shipments/pending-ratings`.

Pendiente / fuera de alcance: consumo real desde `movo-mobile`
(`use-attention-tasks.ts`, MOVO-193) -- ese ticket ya documentó el gap apuntando acá,
migrar la sección "Requiere tu atención" a usar este endpoint queda para cuando se
retome ese lado.

### MOVO-221 — Rediseño de estados de viaje (declared/active/completed) + límite de 1 viaje activo por transportista

`TripStatus` (`@movo/shared`) gana `declared`, insertado antes de `active` -- pasa a
ser el estado inicial real de un viaje (`trip-repository.ts#create()`, antes nacía
directo en `active` sin ningún paso explícito de "arrancar el viaje"). Endpoint nuevo
`POST /trips/:id/start` (`declared -> active`). Dos migraciones separadas
(`20260916140000_add_trip_status_declared` + `20260916140100_backfill_trip_declared_
and_active_unique`) porque Postgres no permite usar un valor de enum recién agregado
con `ADD VALUE` dentro de la misma transacción que lo agrega (mismo mecanismo ya
documentado en MOVO-208) -- la segunda migración hace el backfill de datos (`active`
preexistente -> `declared`, ningún viaje pudo "iniciarse" de verdad hasta ahora) y crea
el índice único parcial `trips_carrier_active_unique` (`carrier_id) WHERE
status='active'`, no representable en el DSL de Prisma (mismo patrón que
`offers_shipment_carrier_pending_unique`, MOVO-102).

Decisiones clave:
- **`TripRepository.start()` es compare-and-swap + índice único parcial, no dos
  chequeos separados**: `updateMany({where: {id, status: declared}})` (mismo patrón
  CAS que `acceptOffer`/`updateStatus`, MOVO-102/118) protege contra doble-tap
  concurrente sobre el MISMO viaje; el índice único parcial (atrapado como `P2002` ->
  `TripAlreadyHasActiveTripError`) es la garantía real contra dos viajes DISTINTOS del
  mismo transportista compitiendo por ser el único `active` -- verificado con un test
  de concurrencia real (`Promise.allSettled` de dos `start()` en paralelo sobre dos
  viajes `declared` del mismo `carrierId`, contra Postgres real, sin flakiness).
  `update()` (PATCH) recibió el mismo catch de `P2002`: un `PATCH {status: active}` a
  mano viola igual el límite si ya hay otro activo, sin necesidad de pasar por
  `start()` -- la garantía vive en la base, no en un único punto de entrada HTTP.
- **`TRIP_NOT_ACTIVE` (MOVO-162) nunca se renombra ni se elimina** (contrato de wire,
  `@movo/shared`) pese a que el chequeo que lo lanzaba (`createOfferForShipment`,
  `shipments.service.ts`) cambió de exigir `active` a secas a aceptar `declared` O
  `active` -- una oferta se hace normalmente mientras el viaje todavía no arrancó.
  Reemplazado por el código nuevo `TRIP_NOT_AVAILABLE` (409), que solo rechaza
  `cancelled`/`completed`. Mismo criterio aplicado a `GET /trips/:id/matches`
  (`trips.service.ts#getTripMatches`) -- **gap real cerrado de paso**: ese endpoint
  nunca había chequeado `trip.status` en absoluto, así que un viaje `cancelled`/
  `completed` seguía devolviendo matches indefinidamente.
- **El warm-up del motor VRPTW en `/start` (AC2 del ticket) es fire-and-forget y
  reusa `GET /shipments/my-route` (MOVO-206), no lo reimplementa**: dispara
  `pricingLogisticsClient.optimizeRoute` con las paradas de TODOS los envíos activos
  del transportista (`aggregateCarrierStops` + `listActiveShipments`, mismos
  helpers que `getMyRoute`) usando el origen del viaje como proxy de posición --
  nunca bloquea ni afecta la respuesta de `/start` (try/catch mudo + `logger?.warn`),
  y el resultado se descarta (mismo criterio "on-demand sin persistencia" de
  MOVO-206 AC7/AC9: no hay dónde guardarlo en `Trip`, y el mobile pide la ruta real
  por separado con la posición GPS real en ese momento, más precisa que el origen
  declarado). El ticket describía esto como "sin conectar a ningún flujo real
  todavía" -- ya no es así desde MOVO-206, discrepancia documentada acá igual que
  otros casos similares (MOVO-180) en vez de reimplementar por las dudas.
- **Decisiones de las preguntas abiertas del ticket ("a definir en refinamiento"),
  resueltas sin bloquear la implementación**: (1) un viaje `declared` se puede
  iniciar en cualquier momento, sin relación con `departureAt` -- restringir a "solo
  el día de" no lo pedía ningún AC y habría requerido definir semántica de timezone
  antes de tener un caso de uso real; (2) `GET /trips/:id/matches` sigue funcionando
  mientras el viaje está vivo (`declared` o `active`), no solo `declared` -- mismo
  criterio "vivo vs. terminal" que el resto del rediseño; (3) del lado mobile, la
  franja "de paso" (`computeOnTripDetour`) pasa a alimentarse de los viajes
  `declared` (los N pendientes de iniciar), no `active` -- con el límite de 1 activo
  por cuenta, cruzar contra `active` cubriría como mucho un solo viaje a la vez.
- **`POST /trips/:id/start` autoriza dueño+admin** (mismo criterio que
  `getTrip`/`updateTrip`/`deleteTrip`, no el más estricto de `assertIsSender` de
  MOVO-129) -- ninguna razón real para excluir admin de una transición de estado
  administrativa.
- **Qué pasa con un viaje `declared` cuyo `departureAt` ya pasó y nadie lo inició**:
  explícitamente fuera de alcance del ticket, sin sweep de expiración -- a diferencia
  de la confirmación del receptor (MOVO-130) o el retiro vencido de un `published`
  (bug de MOVO-148), acá no hay ningún AC que lo pida y la decisión de negocio
  (¿se cancela solo? ¿queda "declarado vencido"?) sigue sin tomarse.
- **Test de integración explícito pedido por el ticket** ("un envío no puede terminar
  asociado a más de un viaje a la vez"): la garantía ya se cumplía sin cambios de
  código (`Offer.tripId` vive en `Offer`, y `acceptOffer` -- MOVO-102/144 -- ya marca
  `superseded` cualquier otra oferta `pending` del mismo envío al aceptar una, así que
  solo puede existir una oferta `accepted` por envío) -- solo hacía falta el test que
  lo fijara de punta a punta contra Postgres real, con dos transportistas y dos viajes
  distintos ofertando sobre el mismo envío.
- **DER actualizado** (`docs/movo_der.dbml`): `trip_status_enum` con el valor nuevo y
  el default de `shipments.trips.status` documentado como `declared`.

Tests: `test/trip-lifecycle.integration.test.ts` nuevo (Postgres real -- default
`declared`, `start()` feliz/404/409×2, aislamiento por `carrierId`, el test de
concurrencia de dos `start()` en paralelo, `update()` respeta el mismo límite, y el
test de exclusividad envío↔viaje de arriba), casos nuevos en `trips-service.test.ts`
(`startTrip` completo + gating de `getTripMatches`), `trips.routes.test.ts` (HTTP de
`POST /:id/start`) y `shipments-offers-create.integration.test.ts` (`tripId` con viaje
`declared`/`active`/`cancelled`/`completed`). Suite completa del servicio verificada
contra Postgres/Redis reales: 54 archivos, 718/718 tests. `tsc --noEmit` y `eslint`
limpios. Confirmado que `app.swagger()` expone `POST /trips/{id}/start`.

Pendiente / fuera de alcance: disparo de `completed` (`delivered`-equivalente para
viajes, sin ticket todavía -- ningún AC de MOVO-221 lo pedía, la máquina de estados de
Trip no tiene hoy ninguna transición real hacia `completed` más allá de lo que ya
permitía `PATCH`); expiración de un `declared` vencido (ver arriba, decisión de
producto pendiente); mobile más allá del mini-fix de `transport.tsx` (no hay UI
todavía para el botón "Iniciar viaje" en sí -- `POST /trips/:id/start` queda listo
para que ese ticket lo consuma).
**Correcciones de review (mismo PR, antes de merge):**
- **Prefiltro SQL con margen sobre el freeze de disputa**: `findPendingRatingCandidates`
  cortaba en SQL a las `RATING_WINDOW_HOURS` (72hs) a secas, ignorando que
  `isRatingWindowOpen` puede extender la ventana real por tiempo en `disputed`
  (MOVO-146 AC9) -- un candidato con freeze quedaba descartado antes de llegar al
  chequeo fino. Inalcanzable hoy porque `disputed` no tiene transición de salida
  modelada, pero se hubiera vuelto un bug real y silencioso apenas exista resolución
  de disputas. Fix: nuevo `MAX_DISPUTE_FREEZE_HOURS` (`rating-window.ts`, margen
  práctico de 30 días) sumado al prefiltro -- el filtro exacto sigue en
  `isRatingWindowOpen` por candidato, esto solo evita que el prefiltro sea más
  estricto que esa verdad. Test de regresión en la integración simulando el freeze
  con eventos insertados directo contra la tabla (mismo criterio que
  `deliveredHoursAgo` para simular estados que la state machine actual no alcanza
  sola).
- **`listEvents` en paralelo**: `listPendingRatings` traía los eventos de cada
  candidato en un `for` secuencial -- un round-trip por candidato -- mientras el
  lookup de ratings ya estaba batcheado. Ahora `Promise.all` junto con
  `listByRaterForShipments`.
- **`ratingDeadline` en el wire contract** (`PendingRatingShipment`): antes solo
  viajaba `deliveredAt`, forzando a cualquier cliente a recomputar 72hs a mano --
  imposible de hacer bien porque el freeze de disputa extiende la ventana de forma
  variable. Ahora se expone el deadline absoluto ya resuelto por
  `computeRatingWindowDeadline`, mismo criterio que
  `ActiveShipmentSummary.receiverConfirmationDeadline`.
- **Guarda explícita en vez de cast ciego para `carrierId`**: la columna es nullable
  en el schema; el mapeo asumía por invariante del state machine que nunca lo sería
  en un envío `delivered`/`completed`. Ahora se valida en runtime y se omite (con
  `logger.warn`) el ítem si la invariante alguna vez se rompiera, en vez de arriesgar
  un 500 de serialización para toda la lista.
- **`RatingRole` desduplicado también del lado de `movo-mobile`**:
  `src/api/ratings-client.ts` reexporta el tipo desde `@movo/shared` en vez de
  mantener su propio literal -- de las 3 copias que señalaba el comentario original
  (Prisma, shared, mobile) quedan 2 unificadas.

### MOVO-190 — `GET /offers/:id`: detalle de una oferta propia (`svc-shipments`)

Cierra la cadena de contrato que dejaron abierta MOVO-185/186/187/188/189: hasta
ahora el transportista solo podía ver el contexto enriquecido de una oferta
dentro del listado paginado (`GET /offers/mine`) o en la respuesta "recién
mutada" de accept/reject/withdraw (sin `shipment`/`competitiveRank`) — no había
forma de "abrir" una oferta puntual desde la lista para el detalle de MOVO-182.
`GET /offers/:id` nuevo en `offers.routes.ts`, mismo shape que un ítem de
`myOfferResponse` (`offersSchemas.offerDetailResponse`, alias directo de
`myOfferResponse` — sin tercer schema parcial).

Decisiones clave:
- **Autorización trivial, no `assertIsSender*`**: "propia" = `offer.carrierId ===
  callerId` (mismo chequeo ya usado por `withdrawOffer`/`updateOffer`) — 404
  `OFFER_NOT_FOUND` si no existe, 403 `AUTH_FORBIDDEN` si es de otro
  transportista. Los helpers `assertIsSender`/`assertIsSenderOrAdmin` de
  `shipments.routes.ts` son para el emisor mirando ofertas ajenas, no aplican
  acá.
- **`findByIdWithShipmentContext(id, now?)` nuevo en `offer-repository.ts`**:
  mismo `include: { shipment: true }` + `mapOfferWithShipment` que
  `listByCarrier`, para una sola fila — evita duplicar la proyección de
  `OfferShipmentContext`.
- **`competitiveRank` para un solo ítem sin duplicar el batch**: la lógica que
  antes vivía inline en `listMyOffers` (armado de competidores, desempate,
  piso/techo) se extrajo a `attachCompetitiveRanks(items, now, ...)` en
  `offers.service.ts` — `listMyOffers` la llama con la página completa,
  `getOfferDetail` con `[offer]`. Mismo `now` compartido entre la lectura de la
  oferta y el batch de competidores (criterio anti-carrera ya fijado por el fix
  de review de MOVO-188).
- **`viewedAtBySender` nunca se marca desde este endpoint**: ese campo significa
  "el emisor vio la oferta" (MOVO-189) y se marca solo desde
  `GET /shipments/:id/offers` cuando el caller es el emisor real — acá viaja de
  solo lectura, tal cual persistido.
- **Sin cambios en el gateway**: el prefijo `/offers` ya proxea method-agnostic
  desde MOVO-145/181.

Tests: `test/offers-detail.integration.test.ts` nuevo (7 casos contra Postgres
real: detalle feliz con todos los campos, 403 ajena, 404 inexistente, pending
vencida reportada `expired` sin tocar la fila, `competitiveRank: null` sobre
envío cancelado y sobre oferta `accepted`, 401 sin `x-user-id`). Suite completa
del servicio 667/667 (51 archivos). `tsc --noEmit` y `eslint` limpios.
Confirmado que `app.swagger()` expone `GET /offers/{id}`.

### MOVO-235 — `GET /shipments/my-route` acotado a un viaje activo (`tripId`)

Antes de este ticket, `GET /shipments/my-route` (MOVO-206) siempre agregaba TODOS los
envíos activos del transportista, sin relación con ningún `Trip` — decisión explícita
de ese ticket, pero que dejaba de tener sentido apenas MOVO-221 introdujo el ciclo de
vida real de viaje (`declared -> active -> completed`, 1 solo `active` por cuenta): el
mapa de MOVO-207 necesita mostrar solo las paradas del viaje que se inició, no todos los
envíos activos sin distinción. `GET /shipments/my-route` gana un query param `tripId`
opcional.

Decisiones clave:
- **Sin `tripId`: comportamiento idéntico a MOVO-206 (AC2)** — `shipmentRepository.
  listActiveShipments()` gana un 3er parámetro opcional que, sin valor, no cambia el
  `where` original. Ningún consumidor existente (el warm-up de `POST /trips/:id/start`,
  MOVO-221, y el endpoint de MOVO-192) se ve afectado.
- **El vínculo Shipment -> Trip no es una columna propia** (AC1): pasa por la oferta
  ganadora (`Shipment.offers` -> `Offer.tripId` + `status: accepted`, relación que ya
  existía en el schema) — filtrar es sumar `offers: { some: { tripId, status:
  "accepted" } }` al `where` de Prisma, sin migración nueva.
- **AC4 (a definir en refinamiento en el ticket original): se exige `trip.status ===
  active`, no el criterio más laxo "declared o active"** que usan `getTripMatches`/
  `createOfferForShipment` — decisión tomada con el equipo: el mapa de MOVO-207 navega
  acá recién después de tocar "Iniciar viaje", así que abrir la ruta de un viaje
  `declared` no tiene ningún caso de uso real todavía. 409 con el código
  `TRIP_NOT_ACTIVE`, que había quedado sin uso desde MOVO-221 (en ese momento se
  reemplazó por el más laxo `TRIP_NOT_AVAILABLE`) — acá sí es exactamente la semántica
  correcta.
- **AC3 (autorización) reusa el mismo patrón ya establecido por `createOfferForShipment`
  para validar un `tripId` ajeno**: `tripRepository.findById` -> 404 `TRIP_NOT_FOUND` si
  no existe -> 403 `AUTH_FORBIDDEN` si `trip.carrierId !== callerId` -> validación de
  estado. Nada nuevo en `error-handler.ts` (los 3 códigos ya estaban wireados).
- **AC5 (¿reusar la ruta que ya calculó `POST /trips/:id/start`?) resuelto como "no
  aplica", documentado explícitamente en el código** (mismo criterio que MOVO-206
  AC9): el warm-up de `/start` es fire-and-forget y descarta su resultado (no hay
  columna en `Trip` para persistirlo) — no existe ningún cache real del que esta ruta
  pueda leer. El único cache Redis del dominio (`route_solution:{tripId}:{candidateId}`,
  MOVO-218, TTL 30 min) es para matching de candidatos, no para la ruta agregada del
  viaje.
- **Gap de negocio encontrado en el camino, derivado a ticket propio (`MOVO-238`,
  backlog)**: un viaje `declared` cuyo `departureAt` ya pasó sin ninguna oferta
  `accepted` queda `declared` para siempre — `TripStatus` no tiene ningún valor
  `expired` (ni columna ni derivado, a diferencia de `OfferStatus`) y no hay ningún
  sweep para `Trip` (sí existen para otros dominios: MOVO-130, MOVO-124). No bloqueaba
  a este ticket (con AC4 exigiendo `active`, un `declared` vencido simplemente sigue
  devolviendo 409 para siempre, mismo resultado que un viaje que nunca arrancó), pero
  quedaba mal dejarlo sin ticket.

Tests: 6 casos nuevos en `test/shipments-my-route.service.test.ts` (filtra con
`tripId`, sin `tripId` no toca `tripRepository`, 404/403/409, guard de
`tripRepository` no inyectado) y 3 en `test/shipments-my-route.routes.test.ts`
(propaga `tripId` de la query, 400 si no es uuid, 409 propagado). Suite completa del
servicio verificada contra Postgres/Redis reales: 758/758 (55 archivos). `tsc --noEmit`
y `npm run lint` limpios.

Gotcha de entorno (no de esta implementación): el Postgres local no tenía corridas las
últimas 5 migraciones (incluida `20260916140000_add_trip_status_declared` de MOVO-221)
y el cliente Prisma generado localmente estaba desactualizado — cualquier verificación
de este ticket contra la suite completa fallaba con "invalid input value for enum...
'declared'" hasta correr `npx prisma generate` + `npx prisma migrate deploy` acá y
`npm run build` en `shared/movo-shared` (dist también desactualizado). Sin relación con
el código de este ticket, documentado por si el mismo gap aparece en otra máquina.

**Fixes de review (PR #173, Alena1812, antes de mergear):**
- **`assertTripAccess` nuevo** (`src/modules/trips/trip-access.ts`, mismo criterio que
  `assertShipmentAccess` de `assert-shipment-access.ts`): el bloque "cargar viaje -> 404
  -> 403 por dueño -> chequeo de estado" se repetía a mano 7 veces entre
  `trips.service.ts` (getTrip/updateTrip/deleteTrip/startTrip/getTripMatches) y
  `shipments.service.ts` (createOfferForShipment, getMyRoute) — la duplicación ya había
  driftado: `getMyRoute` no tenía el bypass de admin que sí tenían `getTrip`/
  `getTripMatches`, así que un Administrador se llevaba 403 al pedir la ruta de un
  viaje ajeno. Nuevo helper centraliza SOLO la parte de autorización (`allowAdmin`
  default `true`; `createOfferForShipment` lo usa con `allowAdmin: false` porque ahí
  nunca hay caso de uso legítimo de que un admin oferte "en nombre de" otro
  transportista) — la carga del viaje (`tripRepository.findById` + 404) se queda en
  cada caller, mismo criterio que `assertShipmentAccess`.
- **`getMyRoute` gana `callerRoles`** (4to parámetro, default `[]`) — `shipments.routes.ts`
  lo resuelve con `getUserRolesFromHeader` (ya usado en el resto del archivo) y se lo
  pasa al service.
- **Mensaje del 409 `TRIP_NOT_ACTIVE` diferenciado por estado**: antes siempre decía
  "Iniciá el viaje antes de pedir su ruta", pero ese mismo código dispara también para
  `cancelled`/`completed` (nunca van a "iniciarse") — ahora un viaje `declared` recibe
  el mensaje de "iniciá el viaje" y cualquier otro estado no-`active` recibe "ya no está
  en curso".
- **`OfferStatus.ACCEPTED` en vez del literal `"accepted"`** en el filtro de
  `shipment-repository.ts#listActiveShipments` — inconsistente con el resto del
  servicio, que siempre usa el enum de `@movo/shared`.
- **Bug latente documentado, no corregido (no disparable todavía)**: el filtro
  `offers.some({ tripId, status: accepted })` matchea cualquier oferta `accepted` con
  ese `tripId`, incluida una vieja de un envío re-ofertado bajo otro viaje más
  adelante. Hoy imposible (`offer-state-machine.ts` no modela ninguna salida de
  `accepted`), deja de serlo apenas exista el revert de hold fallido (MOVO-210) —
  comentario explícito en el código apuntando a ese ticket en vez de una solución
  especulativa sin el diseño real de MOVO-210.
- **Por qué el trip-scoping se queda en `ShipmentRepository` y no pasa a un
  `TripRepository.listShipments()` propio** (sugerencia de review): habría significado
  duplicar `ACTIVE_SHIPMENT_STATUSES`/`mapShipment`/el orden por `pickupDate` en
  `trip-repository.ts`, o que `TripRepository` importe de `ShipmentRepository` —
  dirección de dependencia que no existe hoy en ningún otro lado del servicio.
  Documentado como decisión explícita (comentario en el propio método), no como punto
  ignorado.
- Tests nuevos: mensaje del 409 para `declared` vs. `cancelled`/`completed` (cubre el
  caso `cancelled` que faltaba), bypass de admin en `getMyRoute`, propagación de
  `x-user-roles` a nivel HTTP. Suite completa del servicio: 761/761 (55 archivos).
  `tsc --noEmit` y `npm run lint` limpios.

### Pendientes de este servicio

- **AC6 de MOVO-81 sin confirmar por el equipo**: el gate quedó implementado sobre
  `→ published` (interpretación propuesta en Linear); si el equipo responde distinto,
  es un ajuste acotado a `shipment-repository.ts#updateStatus()`.
- **Liberación del hold de MercadoPago al cancelar (MOVO-29) y cancelación con
  penalización desde `assigned`**: bloqueadas por `svc-payments`, que hoy no tiene
  holds/capture reales — ver MOVO-108 arriba.
- **`agreedPriceArs` nunca se persiste al aceptar una oferta** (encontrado al
  implementar MOVO-192): `offer-repository.ts#acceptOffer` fija `carrierId`/
  `estimatedDeliveryDate*` al pasar a `assignment_pending`, pero no
  `agreedPriceArs` — la columna queda `null` en todo envío activo hoy, aunque el
  precio final ya está implícito en la oferta ganadora (`priceOffered`). Sin ticket
  propio; candidato natural para cuando se retome `MOVO-210` (saga de asignación),
  que de todos modos va a tocar esa misma transición.
