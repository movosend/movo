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

### Pendientes de este servicio

- **MOVO-124**: lifecycle rule de S3 para objetos huérfanos de fotos no confirmadas
  (`shipments/*` y, retroactivamente, `profile-photos/*` de MOVO-97) — no es un
  ajuste chico, ver la decisión de MOVO-81 arriba.
- **AC6 de MOVO-81 sin confirmar por el equipo**: el gate quedó implementado sobre
  `→ published` (interpretación propuesta en Linear); si el equipo responde distinto,
  es un ajuste acotado a `shipment-repository.ts#updateStatus()`.
- **Liberación del hold de MercadoPago al cancelar (MOVO-29) y cancelación con
  penalización desde `assigned`**: bloqueadas por `svc-payments`, que hoy no tiene
  holds/capture reales — ver MOVO-108 arriba.
