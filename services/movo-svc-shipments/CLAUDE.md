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

Fixes de review (PR #76, tmvergara): `confirmPhoto` no era idempotente (un reintento
del cliente insertaba dos filas para el mismo `s3Key`, duplicando evidencia contra el
gate de AC6) — `@@unique([shipmentId, s3Key])` + `addPhoto()` atrapa el `P2002` y
devuelve la fila existente (mismo criterio que `isPendingOfferConflict` de MOVO-102).
`InsufficientCreationPhotosError` nunca se traducía a `ApiError` (500 en vez de 409
apenas el gate fuera alcanzable por HTTP) — wireado en `error-handler.ts`.

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

**Fix de review (PR #96, tmvergara) — TOCTOU real entre `confirmPhoto()` y el sweep**:
el chequeo de AC3 contra Postgres y el `deleteObject` del sweep no eran atómicos —
una confirmación que llegaba justo pasado `ORPHAN_PHOTO_RETENTION_HOURS` podía
intercalarse: el sweep lee "no confirmada", `confirmPhoto()` commitea la fila, el sweep
borra el objeto igual — la foto queda "confirmada" apuntando a un objeto ya borrado.
Se agregó un lock por key de S3 en Redis (`SET NX PX`, TTL 5s) tomado tanto por
`confirmPhoto()` como por el sweep antes de tocar S3/Postgres (`confirmPhoto()` en
conflicto responde 409 `PHOTO_CONFIRMATION_IN_PROGRESS`; el sweep reevalúa en la
próxima corrida). Mismo fix espejado en `svc-users` (mismo bug).

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

Pendiente / fuera de alcance: negociación encadenada y cualquier UI de mobile
(MOVO-150, bloqueado por este ticket).

Fixes de review (PR #105, JcBordino4): `listShipmentOffers` filtra también por
`shipment.status` (no solo el de la oferta) para no listar `pending` de un envío ya
cancelado como vigente (`includeResolved=true` las sigue mostrando en el historial).
`acceptOffer()` devuelve las ofertas `superseded` directo de la transacción en vez de
un `listByShipment` aparte. Mobile: `use-push-notifications.ts` reconoce
`offer_accepted`/`offer_superseded`/`offer_rejected` (antes solo navegaba a un
dead-end).

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

**Fixes de review (PR #142) — desempate a igual `priceOffered`**: en ARS es común que
varias ofertas coincidan centavo a centavo y Postgres no promete orden estable entre
iguales, así que el `rank` podía cambiar entre dos llamadas sin que nada cambiara en
la realidad. Cascada de desempate (decisión de producto, no pedida por ningún AC):
mejor reputación `asCarrier` (MOVO-147) → más envíos entregados como transportista →
quien ofertó primero (`createdAt`) → `id`. Resuelto en batch sobre los `carrierId`
únicos de la página (como mucho dos queries más, nunca una por competidor).

Segundo fix: `listByCarrier` y `listPendingOffersByShipmentIds` evaluaban la
expiración perezosa (AC11) contra dos `new Date()` independientes — una oferta podía
leerse `pending` en una función y no en la otra, degradando `competitiveRank` a `null`
sin necesidad. `listMyOffers` ahora usa un único `now` para ambas.

Tercer fix: `toNetArs` estaba duplicada en `offers.service.ts` y en
`computeOffersSummaryForCarrier` (MOVO-180) — extraída a `computeNetFromGross()` en
`@movo/shared` (inversa de `computeOfferGrossPrice`).

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

Pendiente / fuera de alcance: disparo real de las transiciones (`MOVO-210`/`MOVO-212`,
bloqueados por Mercado Pago); `delivery_failed` (evaluado y descartado, ver arriba);
gate HTTP de cancelación desde `assigned_unfunded` y botón de cancelar en mobile para
ese estado (dependen de `MOVO-210`); ADR-021 redactado en `CLAUDE.md` raíz, pendiente
de que el usuario lo publique en Drive (decisión explícita, no un olvido); bug
preexistente de credenciales en `offers-mine.integration.test.ts` (de otro ticket, no
se tocó).

#### ADR-021 completo (texto para pegar en Drive)

Texto completo del ADR (contexto, alternativas, tabla de estados, `delivery_failed`
evaluado y descartado, trade-off aceptado) recortado de este archivo el 2026-09-20
para bajar su tamaño — sigue disponible en el historial de git (commit que agregó la
sección MOVO-208) y pendiente de pegar en Drive (`[Movo] 004 - Sprint 0.md`), tal como
ya documentaba el pendiente de MOVO-208 más abajo. El resumen de una línea ya vive en
la tabla de ADRs del `CLAUDE.md` raíz.

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
- **Serialización de ventanas de retiro con timezone real (`formatPickupInstant`):**
  `pickupDate` (@db.Date) y `pickupTimeWindow*` (@db.Time) se anclan en UTC sumando el offset
  argentino (+3h UTC), evitando que viajen con fecha base 1970 a `svc-pricing-logistics`
  lo que invalidaba falsamente candidatos en el evaluador de factibilidad.


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

Pendiente / fuera de alcance: disparo de `completed` (`delivered`-equivalente para
viajes, sin ticket todavía -- ningún AC de MOVO-221 lo pedía, la máquina de estados de
Trip no tiene hoy ninguna transición real hacia `completed` más allá de lo que ya
permitía `PATCH`); expiración de un `declared` vencido (ver arriba, decisión de
producto pendiente); mobile más allá del mini-fix de `transport.tsx` (no hay UI
todavía para el botón "Iniciar viaje" en sí -- `POST /trips/:id/start` queda listo
para que ese ticket lo consuma).

**Correcciones de review (mismo PR):**
- **Prefiltro SQL con margen sobre el freeze de disputa**: `findPendingRatingCandidates`
  cortaba en SQL a las 72hs a secas, ignorando que `isRatingWindowOpen` puede extender
  la ventana real por tiempo en `disputed` (MOVO-146 AC9). Inalcanzable hoy (`disputed`
  no tiene salida modelada) pero hubiera sido un bug silencioso apenas exista
  resolución de disputas. Fix: `MAX_DISPUTE_FREEZE_HOURS` (margen de 30 días) sumado
  al prefiltro — el filtro exacto sigue en `isRatingWindowOpen` por candidato.
- **`listEvents` en paralelo**: `listPendingRatings` traía eventos en un `for`
  secuencial — ahora `Promise.all` junto con `listByRaterForShipments`.
- **`ratingDeadline` en el wire contract**: antes solo viajaba `deliveredAt`,
  forzando a cualquier cliente a recomputar 72hs a mano (imposible de hacer bien con
  el freeze de disputa) — ahora se expone el deadline absoluto ya resuelto.
- **Guarda explícita en vez de cast ciego para `carrierId`** (nullable en el schema,
  la invariante de la state machine lo asumía no-nulo en `delivered`/`completed`):
  se valida en runtime y se omite el ítem con `logger.warn` en vez de arriesgar un 500.
- **`RatingRole` desduplicado también en `movo-mobile`**: `ratings-client.ts` reexporta
  el tipo desde `@movo/shared` en vez de mantener su propio literal.

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

### MOVO-179 — Push notification al publicarse un envío compatible con un viaje declarado

Quinto disparador de `notifications-client.ts` (los otros 4 son de MOVO-108/129):
al transicionar un envío a `published` (`acceptShipment`), avisa a los
transportistas con un viaje `active` cuyo corredor contiene tanto el retiro
como la entrega del envío — matching inverso de MOVO-161/50 (dado un envío,
qué viajes lo contienen; el matching directo ya existente es al revés: dado un
viaje, qué envíos matchean).

- **`src/domain/geo.ts#distanceToSegmentKm`**: port a JS de
  `haversineSegmentDistanceKm` (`shipment-repository.ts`, hasta ahora solo en
  SQL). Necesario porque acá el segmento (corredor del viaje) varía por CADA
  fila candidata, no es fijo como en el matching directo — no se portó a
  `$queryRaw` por ese motivo.
- **`trip-repository.ts#findActiveTripsMatchingShipment`**: trae los `Trip`
  `active` (excluyendo `carrierId` del propio sender/receiver del envío) y
  filtra en memoria con `distanceToSegmentKm` contra ambos puntos del envío.
  **Sin bounding-box/SQL de corredor** (a diferencia del matching directo) —
  decisión deliberada por bajo volumen esperado de viajes `active`
  simultáneos, mismo criterio que descartó un índice compuesto en MOVO-130.
- **Sin `radiusKm` por viaje**: `Trip` nunca persistió ese campo (solo existe
  como query param no persistido en `GET /trips/:id/matches`) — el trigger
  usa siempre `TRIP_DEFAULT_MAX_DETOUR_KM` (`ShipmentsServiceOptions
  .tripMatchDetourRadiusKm`, wireado en `shipments.routes.ts`).
- **AC4 (de-duplicar por `carrierId`, no por `tripId`)**: si el mismo
  transportista matchea con más de un viaje viable, se notifica una sola vez,
  referenciando el viaje con `departureAt` más próximo — desempate propio, el
  AC no fija el criterio.
- **`shortAddress()` local a `shipments.service.ts`**: primer componente de
  una dirección completa (antes de la primera coma) para el copy del push
  (`{origenCorto} → {destinoCorto}`) — no había ningún helper de formato de
  dirección reusable en el repo todavía.
- **Segunda pasada, decisión de equipo (Peter, comentario de Linear)**: el AC1
  literal pide "mismo criterio geométrico que MOVO-161", pero ese prefiltro
  solo puede dar falsos positivos (un envío que en línea recta cae en el
  corredor pero que la ruta real no hace viable) — exactamente lo que
  `GET /trips/:id/matches` ya resuelve desde MOVO-219 consultando
  `pricing-logistics`. Se sumó `evaluateTripMatchFeasibility()` (nuevo, mismo
  archivo): sobre los candidatos que YA pasaron el prefiltro geométrico
  (nunca sobre el universo completo de viajes `active`, para no gastar la
  cuota de Google Routes en algo que ni siquiera pasaba el corredor), llama a
  `pricingLogisticsClient.evaluateCandidates` (un viaje candidato por
  llamada, ya que ese contrato está pensado "un viaje, muchos paquetes" y acá
  es al revés) y solo notifica si `feasible: true`. **Política distinta a la
  No-Fallback de MOVO-219**: si `pricing-logistics` falla para un candidato,
  se trata como "no viable, no notifica" (logueado, nunca se propaga) en vez
  de un 502/503 — tiene sentido acá porque es un disparador best-effort en
  segundo plano (AC2), no una respuesta que el usuario está esperando en
  pantalla. `pricingLogisticsClient` pasó a ser una dependencia requerida de
  `dispatchTripMatchPushes` (ya viajaba opcional en `ShipmentsServiceOptions`
  desde MOVO-206) — sin él, el trigger no dispara, mismo criterio que sin
  `tripRepository`.

**Fix de review (PR #172)**: `dispatchTripMatchPushes` no envolvía todo su cuerpo en
try/catch, a diferencia del resto de disparadores best-effort del archivo — un fallo
de `tripRepository.findActiveTripsMatchingShipment` (primera línea, error de
Prisma/DB) se propagaba como unhandled promise rejection en vez de loguear y seguir.
Corregido envolviendo el cuerpo completo — los try/catch internos por notificación
individual (AC4) quedan sin tocar.

**Conflicto de merge contra `develop` (MOVO-221, mergeado antes) — resuelto en el
mismo PR**: `TripRepository` recibió dos métodos en paralelo (`findActiveTripsMatchingShipment`
de este ticket y `start()` de MOVO-221) — conflicto trivial, se conservaron ambos. Efecto
no trivial: `Trip.create()` pasó de nacer `active` (lo que este ticket asumía) a nacer
`declared` (MOVO-221) — los tests de matching/push necesitaron un `start()` explícito.
El caso "dos viajes `active` del mismo transportista" dejó de ser alcanzable vía la API
real (`trips_carrier_active_unique` de MOVO-221 lo impide) — cobertura movida a
`trip-lifecycle.integration.test.ts` para no duplicar.

### MOVO-200 — PoC del canal de tiempo real (`svc-shipments`)

Decisión completa (WebSocket nativo, comparación de tecnologías, impacto en infra) en
ADR-022, `CLAUDE.md` raíz. Acá solo el código de la PoC (AC5 del spike, no la
implementación final — esa es MOVO-201): `src/plugins/websocket.ts` (registra
`@fastify/websocket`) + `src/modules/tracking/tracking-poc.routes.ts`
(`GET /shipments/:id/track`, WS). Valida el JWT con `verifyAccessToken` (`@movo/shared`)
directo en el handshake de conexión, no con `x-user-*` (ADR-010) — esta PoC conecta
directo al servicio, sin el proxy del gateway que MOVO-201 todavía no implementa.
Autoriza por pertenencia al envío (`assertShipmentAccess`, más el `carrierId`
asignado, que ese helper no conoce — mismo criterio que AC8 de MOVO-142) y empuja una
única posición de muestra al conectar. Sin salas, sin difusión a más de un suscriptor,
sin ingesta real de GPS. Probada de punta a punta contra un servidor TCP real (no
`injectWS`/`app.inject` — el test double de `@fastify/websocket` para WS tiene un
problema de timing propio al enviar un mensaje inmediatamente después del upgrade,
sin relación con el código de la ruta) con los 4 caminos: sin token (cierre `4001`),
usuario ajeno al envío (`4003`), envío inexistente (`4004`), y el push real al
emisor autorizado — primero con un repositorio fake, después repetido contra un envío
real insertado en Postgres (Docker). Instrucciones para correrla (histórico; MOVO-201
reemplazó la PoC y movió la doc a `docs/tracking/README.md`):
`docs/tracking-poc/README.md` (raíz del repo, ya no existe).

Suite completa del servicio corrida contra Postgres/Redis reales (Docker):
719/719 tests, 54/54 archivos. En el camino se encontró y corrigió un bug preexistente
sin relación con esta US: `offers-detail.integration.test.ts` y
`offers-mine.integration.test.ts` usaban el placeholder literal de `.env.example`
(`postgresql://user:password@...`) como fallback de `DATABASE_URL` en vez de
`movo:movo` (el resto de los tests de integración) — fallaban con
`password authentication failed` al correr sin la env var ya seteada en el shell.

### Bug reportado probando MOVO-151 en dispositivo — `Offer.expiresAt` nunca se completaba (sin ticket propio)

`deriveEffectiveOfferStatus` (AC11 de MOVO-102, expiración perezosa de una oferta
`pending`) es correcta, pero `expiresAt` quedaba `null` para SIEMPRE: nunca lo seteó
ningún caller real. `createOfferForShipment` (`POST /shipments/:id/offers`, MOVO-143)
armaba el `offerRepository.create({...})` sin ese campo, y el repositorio lo
defaultea a `null` cuando falta — así que ninguna oferta creada por HTTP podía
reportarse `expired` sin importar cuánto hubiera pasado la fecha de retiro. Los tests
que sí cubren AC11 (`offer-repository.integration.test.ts`,
`offers-mine.integration.test.ts`) nunca lo detectaron porque llaman al repositorio
directo pasando `expiresAt` a mano — nadie probaba que el flujo HTTP real generara
uno.

- **`expiresAt` = cierre de la ventana de retiro EFECTIVA de la oferta**: la franja
  propuesta si el transportista propuso una (MOVO-177), la del propio envío si no.
  Una sola regla compartida, `offerExpiresAtInstant` (`domain/pickup-window.ts`, sobre
  el mismo ajuste de offset de Argentina que ya usaba el barrido de `published`
  vencidos), usada por la creación y por la edición — sin duplicar la derivación entre
  `shipments.service.ts` y `offers.service.ts`.
- **`PATCH /offers/:id` (MOVO-181) recibió el mismo fix, no solo la creación**:
  cambiar `offeredDate` y/o la franja propuesta sin recomputar `expiresAt` habría
  dejado la oferta venciendo contra una ventana vieja. Se recomputa **dentro de
  `offerRepository.update`**, sobre la fila leída en la misma transacción, no en el
  servicio: así el valor sale del mismo estado contra el que se hace el
  compare-and-swap. Cuando el patch recomputa `expiresAt`, ese CAS cubre además
  `offeredDate`/`offeredPickupTimeWindowStart/End` (no solo `status`): dos PATCH
  concurrentes (uno cambia la fecha, otro la franja) ya no pueden dejar un `expiresAt`
  derivado de una mezcla que nunca coexistió — el segundo en escribir recibe 409
  `OFFER_CONCURRENT_MODIFICATION` (review de PR #177). Un patch de solo precio no
  recomputa nada ni entra en ese conflicto.
- **Encontrado por el usuario probando la pantalla de MOVO-151 en dispositivo**, no
  por un test — una oferta con fecha de retiro del día anterior seguía apareciendo
  "Pendiente" en "El resto" de Mis ofertas, contradiciendo el footer propio de esa
  pantalla ("Las ofertas pendientes se cierran solas cuando pasa la fecha de
  retiro").

Tests nuevos: 2 casos en `shipments-offers-create.integration.test.ts` (ventana del
envío sin franja propuesta, franja propuesta override), 2 en
`offers-update.integration.test.ts` (cambiar `offeredDate` recomputa contra la nueva
fecha, resetear la franja propuesta a `null` recomputa contra la ventana del envío en
vez de la franja vieja). Suite completa del servicio 775/775 tests (55 archivos),
contra Postgres/Redis reales. `tsc --noEmit` y `eslint` limpios en los archivos de
este fix.
### MOVO-234 — Auto-crear `Trip` al aceptar una oferta sin viaje asociado

Decisión de producto confirmada previamente (ver la descripción del ticket): ofertar
sin viaje sigue sin fricción (no se le exige al transportista "declarar viaje" antes
de ofertar), pero si la oferta ganadora no tenía `tripId`, `offerRepository.acceptOffer()`
(`offer-repository.ts`) ahora crea un `Trip` `declared` a partir del propio envío y lo
asocia a la oferta, todo dentro de la misma transacción atómica de la aceptación (AC1/
AC2) — igual que si el transportista lo hubiera declarado a mano.

Decisiones clave:
- **`departureAt` = inicio de la ventana de retiro EFECTIVAMENTE acordada** (una de las
  dos preguntas que el ticket dejaba explícitamente abiertas, resuelta con el usuario):
  se prefirió el inicio de la franja horaria por sobre el mediodía genérico, mismo
  criterio que ya usaba el dominio para el CIERRE de esa misma ventana
  (`pickupWindowEndInstant`). `domain/pickup-window.ts#acceptedOfferPickupWindowStartInstant`
  nueva (simétrica, misma base `anchorTimeOfDayToInstant` extraída para no duplicar el
  anclaje UTC+offset Argentina) — usa `Offer.offeredDate`/`offeredPickupTimeWindowStart`
  (lo que el transportista efectivamente propuso al ofertar, MOVO-177) por sobre
  `Shipment.pickupDate`/`pickupTimeWindowStart` (lo pedido originalmente por el emisor)
  cuando el transportista propuso una franja distinta.
- **Placeholder de `vehicleType` = `"Vehículo sin especificar"`** (la otra pregunta
  abierta del ticket, resuelta con el usuario): texto neutro, mismo tono que
  `UNKNOWN_COUNTERPARTY_NAME`. `resolveAutoTripVehicleType()` (`offers.service.ts`)
  resuelve `${vehicle.brand} ${vehicle.model}` desde `PublicProfile.vehicle` (MOVO-172,
  mismo formato que usa `movo-mobile` al declarar un viaje a mano) si el transportista
  tiene ficha cargada; degrada al placeholder ante cualquier fallo de `usersClient`, sin
  bloquear jamás la aceptación (mismo patrón try/catch+`logger?.warn` que
  `resolveSnapshotProfile`).
- **Resolución de `usersClient` ANTES de la transacción de Postgres, nunca dentro**:
  `acceptOffer()` de `offers.service.ts` resuelve `vehicleType` (I/O de red) antes de
  llamar a `offerRepository.acceptOffer()`, que recién ahí abre la transacción — no se
  puede intercalar una llamada HTTP dentro de una transacción de Postgres sin arriesgar
  tenerla abierta el tiempo de un round-trip de red. `AutoTripDefaults` (nuevo,
  `offer-repository.ts`) es el único dato que cruza esa frontera.
- **Origen/destino del `Trip` = retiro/entrega del propio `Shipment`** (columnas ya
  disponibles dentro de la transacción, sin I/O extra): se agregó un
  `tx.shipment.findUniqueOrThrow` puntual (el repositorio hasta ahora solo tocaba
  `shipment` vía `updateMany`, sin necesitar la fila completa) — costo aceptable, ocurre
  como mucho una vez por aceptación, nunca en el hot path de otro `acceptOffer` que ya
  tenía `tripId`.
- **AC5 (asociar a un `Trip` `declared` compatible existente en vez de crear uno nuevo)
  explícitamente NO implementado**: el propio ticket lo marca como optimización a
  evaluar después, "crear siempre uno nuevo es un comportamiento correcto y más simple"
  — no es un gap, es la primera versión tal como la pidió el AC.
- **AC3 (aviso al transportista) vía `notificationsClient.sendPush` únicamente**:
  `dispatchAutoTripCreatedPush()` nueva, mismo patrón fire-and-forget best-effort que el
  resto de `offers.service.ts`. El copy/canal final (push vs. in-app) es
  responsabilidad de `movo-mobile` (MOVO-236, bloqueado por este ticket) — acá solo se
  dispara el trigger de backend, tal como el ticket delimita en su sección "Fuera de
  alcance".

Tests: `test/pickup-window.test.ts` (2 casos nuevos de `acceptedOfferPickupWindowStartInstant`
— sin franja propuesta usa la del envío, con franja propuesta la reemplaza) y 5 casos
nuevos en `test/offers-accept-reject.integration.test.ts` (Postgres real: crea el `Trip`
con origen/destino/`departureAt` correctos y lo asocia a `Offer.tripId`, `departureAt`
con franja propuesta de MOVO-177, no crea un `Trip` nuevo si la oferta ya tenía `tripId`,
push `trip_auto_created` disparada, placeholder de `vehicleType` sin ficha de vehículo
cargada). Suite completa del servicio verificada contra Postgres/Redis reales: 765/765
(55 archivos). `tsc --noEmit` y `npm run lint` limpios.

Pendiente / fuera de alcance: AC5 (fusión con un `Trip` `declared` compatible existente,
ver arriba); UI del aviso in-app/push (MOVO-236).

**Fixes de review (PR #176, Alena1812, antes de mergear):**
- **Race condition real entre la resolución de `autoTripDefaults` y la transacción de
  `acceptOffer`**: `offers.service.ts` solo resolvía el vehículo del transportista
  (`resolveAutoTripVehicleType`) cuando `offer.tripId` era `null` en una lectura PREVIA
  a la transacción del repositorio -- si el transportista borraba su `Trip` mientras la
  aceptación estaba en curso (permitido sobre una oferta todavía `pending`,
  `Offer.trip` es `onDelete: SetNull`), `current.tripId` podía llegar `null` DENTRO de
  la transacción sin que hubiera `autoTripDefaults` con qué crear un `Trip`
  compensatorio -- la oferta quedaba `accepted` con `tripId: null` y sin ningún viaje,
  rompiendo AC1/AC2. Corregido resolviendo el vehículo SIEMPRE, sin condicionar a la
  lectura previa -- el costo (una llamada de más a `usersClient` cuando la oferta YA
  tenía viaje) es aceptable frente a la garantía. La decisión real de auto-crear sigue
  siendo la del repositorio (`current.tripId === null`, releído dentro de la
  transacción), nunca la del service.
- **`departureAt` podía quedar en el pasado**: nada validaba que la ventana de retiro
  no hubiera vencido para cuando se acepta la oferta (el barrido de expiración de
  `published`, sin ticket propio, tiene hasta ~15min de lag) -- a diferencia de
  `POST /trips` a mano, que rechaza `departureAt` no futuro
  (`TRIP_DEPARTURE_IN_PAST`), el `Trip` auto-creado podía nacer con salida ya pasada.
  Corregido con un clamp (`departureAt = max(ventana efectiva, ahora)`) -- no bloquea
  la aceptación de la oferta por esto (ya es un caso de borde tolerado en otras partes
  del dominio), en vez de eso ancla el viaje a "ahora" como aproximación razonable.
- **Duplicación de código real**: la creación del `Trip` estaba reimplementada inline
  en `offer-repository.ts` en vez de reusar el mapeo de `TripRepository.create()`
  (mismo `CreateTripInput` armado dos veces, riesgo de que un campo nuevo se agregara
  a un lado y no al otro). Extraído `buildTripCreateData()` (`models/trip.ts`, única
  fuente de verdad del `data:` de Prisma, siempre `status: declared`) -- reusado por
  `trip-repository.ts#create()` y por el `Trip` auto-creado de `acceptOffer`. Lo que
  NO se comparte es el `db.trip.create()`/`tx.trip.create()` en sí: `acceptOffer`
  necesita ejecutarlo dentro de su propia transacción (`tx`), no anidable con un
  `TripRepository` que solo opera sobre el `PrismaClient` de nivel superior.
- **JSDoc huérfano**: el comentario original de `acceptOffer` en la interfaz
  `OfferRepository` (compare-and-swap/atomicidad, AC8/AC9) quedó separado del bloque
  nuevo de MOVO-234 por un `*/` de por medio -- la mayoría de los tooltips de IDE solo
  muestran el último bloque pegado a la firma. Fusionados en un solo JSDoc.

Tests nuevos en `test/offers-accept-reject.integration.test.ts` (Postgres real): la
resolución de vehículo se sigue disparando con `tripId` ya seteado (spy sobre
`usersClient.findPublicProfile`), y el `Trip` auto-creado sobre una ventana de retiro
ya vencida (`PICKUP_DATE` del archivo, deliberadamente en el pasado respecto de
"ahora" al correr el test) nunca queda con `departureAt` anterior al momento de la
request. Los dos tests preexistentes que verificaban un `departureAt` exacto
necesitaron fixtures con `pickupDate`/`offeredDate` propios en el futuro (agregado
`overrides` opcional a `createPublishedShipment()`) -- con el clamp nuevo, el
`PICKUP_DATE` compartido del archivo (ya en el pasado) hubiera pisado el valor
esperado. Suite completa del servicio verificada contra Postgres/Redis reales:
780/780 (55 archivos). `tsc --noEmit` y `eslint` limpios.
### MOVO-201 — Canal de tiempo real: implementación real (reemplaza la PoC de MOVO-200)

Reemplaza `src/plugins/websocket.ts` y `src/modules/tracking/tracking-poc.routes.ts` de
la PoC por la implementación real: `src/plugins/realtime.ts`, `src/services/
realtime-authorizer.ts`, `src/modules/tracking/tracking.routes.ts` (renombrado, ya no
"poc"), `src/realtime/shipment-status-events.ts`. `movo-api-gateway` también cambió —
ver su `CLAUDE.md` (MOVO-201). Doc de uso: `docs/tracking/README.md` (antes
`docs/tracking-poc/`).

Decisiones clave:
- **AC4 (cierre al llegar a un estado terminal) vía `EventEmitter` en proceso, no
  polling**: `shipment-repository.ts#updateStatus()` (única vía de escritura de
  `status`, MOVO-104) emite `shipment-status-events.ts#emitShipmentStatusChanged` justo
  después de que la transacción confirma; `realtime.ts` escucha ese evento y cierra en
  el acto (código WS `4009`) cualquier socket registrado para ese `shipmentId`. Cierra
  también al conectar si el envío YA está en ese estado, no solo si lo alcanza estando
  conectado. `TRACKING_CLOSED_STATUSES` (nuevo en `shipment-state-machine.ts`) es
  `delivered`/`completed`/`cancelled`/`rejected_by_receiver`/`disputed` — no es lo mismo
  que "terminal en el grafo" (`disputed` sí lo es; `delivered` no, pero corta tracking
  igual, AC6 de MOVO-11). Verificado que `updateStatus()` es el único hook necesario:
  `offer-repository.ts#acceptOffer()` escribe `status` directo sin pasar por acá, pero
  nunca hacia un valor de `TRACKING_CLOSED_STATUSES`.
- **`RealtimeRegistry` (`realtime.ts`) en memoria, sin distribución entre réplicas** —
  mismo criterio que el `EventEmitter` de arriba: `svc-shipments` corre en una sola
  instancia (ADR-006), no hace falta Redis pub/sub ni un message broker (ADR-001) para
  esto. Agnóstico del tipo de mensaje (AC8): `shipmentId -> Set<socket>`, para que la
  ingesta de posiciones (MOVO-202) y el chat (MOVO-26) lo reusen sin rediseñarlo.
- **Ya no empuja una posición de muestra hardcodeada** (a diferencia de la PoC) — manda
  `{type:"connected", shipmentId}` y queda esperando; la ingesta real (MOVO-202, ticket
  hermano) es quien va a publicar sobre el mismo `RealtimeRegistry`.
- **Heartbeat ping/pong cada 30s** (`HEARTBEAT_INTERVAL_MS`, `tracking.routes.ts`) —
  recomendación de review sobre PR #170 (comentario en MOVO-201/Linear): mantiene la
  conexión viva detrás de nginx/Cloudflare y termina el socket si un cliente deja de
  responder. Constante hardcodeada, no env var — no depende del ambiente.
  `infra/nginx/templates/default.conf.template` bajó `proxy_read_timeout` de 3600s
  (valor de MOVO-200 sin heartbeat) a 90s ahora que existe.
- **Auth de browser (`movo-admin`/MOVO-33) diseñada, no implementada**: el mecanismo
  elegido para cuando haga falta es un subprotocolo (`Sec-WebSocket-Protocol`), no un
  query param (`?token=...`, quedaría logueado en nginx/Cloudflare) — decisión tomada
  ahora porque el review la pidió explícitamente, implementación diferida porque MOVO-33
  no bloquea a MOVO-201 y todavía no tiene consumidor. El mobile (único consumidor real
  hoy, MOVO-204) sigue usando `Authorization: Bearer` en el handshake, que RN sí soporta.
- **Sigue validando el JWT en el propio servicio, no solo `x-user-*`** aunque ahora sí
  hay proxy de gateway (a diferencia de la PoC): una conexión WS es de larga duración,
  más que el TTL de cualquier chequeo hecho solo en el handshake HTTP de otra ruta.
- **AC7 (logs y métricas mínimas) resuelto solo con logs estructurados**, sin un
  endpoint/stack de métricas nuevo: el repo no tiene Prometheus/StatsD en ningún lado
  (ADR-006, EC2+Docker Compose sin infra de monitoreo) y agregar uno para esta única
  US sería sobre-ingeniería. `tracking.routes.ts`/`realtime.ts` loguean con `event`
  estructurado (conexión aceptada/rechazada con motivo, cerrada por error o por cambio
  de estado) y cada log de conexión/cierre incluye `activeConnections` — alcanza para
  diagnosticar por `docker logs`/CloudWatch sin infra nueva. `RealtimeRegistry.
  activeConnections()` queda como método público por si un futuro endpoint de salud
  quiere exponerlo, pero no se creó ninguno en este ticket.

Tests: `test/tracking.integration.test.ts` (nuevo, servidor TCP real vía `app.listen` +
cliente `ws` real, mismo motivo que la PoC para no usar `injectWS`/`app.inject`) — los 3
caminos de conexión del DoD (token propio acepta, token ajeno rechaza `4003`, sin token
rechaza `4001`) más token malformado (también `4001`), envío inexistente (`4004`),
transportista asignado acepta, envío ya `delivered` rechaza al conectar (`4009`), y el
cierre automático de una conexión abierta al pasar a `delivered` (`4009`, AC4). El
comportamiento del heartbeat (ping/pong, terminar sin pong) no tiene test automatizado
propio — verificarlo requeriría manipular temporizadores reales de un socket TCP real,
no vale la complejidad para este alcance; queda como verificación manual
(`docs/tracking/README.md`). `vitest.config.ts` suma `src/services/**/*.ts` al
`include` de cobertura -- `realtime-authorizer.ts` es lógica de auth real (mismo
criterio que `adapters`/`repositories`), no un plugin de Fastify, y quedaba fuera del
reporte pese a estar ejercitado por este mismo test. Suite completa del servicio:
756/756 (56 archivos), 91.29% statements / 85.12% branches -- sin bajar respecto a la
base de MOVO-200 (719/719 antes de esta US).

Pendiente / fuera de alcance de MOVO-201: ingesta y persistencia real de posiciones GPS
y emisión desde el mobile (MOVO-202, ticket hermano), chat (MOVO-26), auth de browser
(diseñada arriba, sin implementar), y verificación contra un deploy real en dev/prod
(AC6 del ticket) — sin acceso a esa infra desde esta sesión.

**Fixes de review (PR #174, JcBordino4, antes de mergear) — dos críticos que rompían el
ticket end-to-end**:
- **La entrega vía handshake (MOVO-158) no cerraba el tracking**: `in_transit ->
  delivered` se escribe en `handshake-repository.ts#confirmAndPersist` (su propio
  `$transaction`, no pasa por `shipment-repository.ts#updateStatus()`), así que nunca
  emitía `shipmentStatusChanged` — el comentario que decía "verificado que
  `updateStatus()` es el único hook necesario" no contemplaba ese segundo escritor.
  `confirmAndPersist` ahora emite también, después de que su propia transacción
  confirma (mismo criterio anti-rollback que `updateStatus`). Test nuevo en
  `tracking.integration.test.ts` que dispara el cierre por el flujo real
  `/handshake/generate` + `/handshake/confirm` (con firma ECDSA real vía WebCrypto),
  no por `repo.updateStatus(DELIVERED)` como hacía el test original.
- **`authorization` no llegaba a través del gateway** (ver `gateway/CLAUDE.md`,
  MOVO-201) — sin este fix, toda conexión de tracking que pasara por el gateway (en vez
  de conectar directo al servicio, como hacen los tests de este archivo) cerraba con
  `4001`.
- Nit del mismo review: `ws` movido de `dependencies` a `devDependencies`
  (`package.json`) — `src/` solo usa `import type { WebSocket } from "ws"`,
  `@fastify/websocket` ya trae el runtime real; `ws` + `@types/ws` en dev alcanzan para
  los tests (`tracking.integration.test.ts`/`websocket-proxy.test.ts` del gateway) sin
  arriesgar un drift de versión con la que trae `@fastify/websocket`.

Suite completa tras los fixes: 757/757 (56 archivos), corrida contra Postgres/Redis
reales.

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

### MOVO-202 — Ingesta de posiciones del transportista: última posición en Redis, traza persistida cada ~45s y purga (ADR-023)

Recepción, almacenamiento y difusión de la posición GPS del transportista durante
`in_transit`. Tabla nueva `shipments.carrier_positions` (append-only, AC9),
`src/repositories/position-repository.ts` + `src/services/position-service.ts` +
módulo HTTP nuevo `src/modules/positions/`. Bloqueado por MOVO-201 (canal de tiempo
real, ya Done) — reusa su `RealtimeRegistry` para difundir.

Decisiones clave:
- **Ingesta por `POST /shipments/:id/positions` (HTTP corriente), no un mensaje sobre
  el WS de MOVO-201** — el AC1 del ticket dejaba la elección abierta. El consumidor
  real (MOVO-203, emisión en foreground/background) va a reportar desde tareas de
  background del SO, donde mantener un socket persistente vivo es frágil (el SO mata
  conexiones en background mucho antes que tareas de red puntuales) — un POST corriente
  es la vía robusta. El canal de MOVO-201 sigue siendo exclusivamente de RECEPCIÓN: el
  mapa (MOVO-204) se suscribe ahí y recibe cada posición que este endpoint difunde
  (`RealtimeRegistry.broadcast`, AC5, nuevo método — primer uso real del registro
  agnóstico de tipo de mensaje que MOVO-201 dejó preparado sin ningún publisher
  todavía).
- **AC2 literal: 403, no 409, para un envío en el estado equivocado**
  (`SHIPMENT_NOT_IN_TRANSIT`, código nuevo) — inusual (el resto del repo usa 409 para
  "estado equivocado"), pero es lo que el ticket pide explícito ("cualquier otro actor
  o estado responde 403"), no una interpretación libre.
- **Cadencia de ~45s (AC4) decidida en Redis, sin tocar Postgres en el camino
  caliente**: un hash `position:last:{shipmentId}` guarda la última posición conocida
  (AC3, se pisa en CADA reporte). La cadencia la gobierna un claim atómico aparte,
  `SET position:cadence:{shipmentId} 1 PX <CARRIER_POSITION_MIN_PERSIST_INTERVAL_MS> NX`
  (45000, constante de dominio en `position-service.ts`, no env var — es una regla de
  producto fija, no un parámetro operativo): solo el reporte que gana el claim llama a
  `positionRepository.create()`. Un `hget` + comparación + `hset` separados (primera
  versión) dejaba pasar dos persistencias dentro de la misma ventana ante reportes
  solapados (review de PR #178); el claim no se libera, expira solo por TTL, salvo si
  `create()` falla (se hace `del` para no perder hasta ~45s de traza). La difusión
  (AC5) y la actualización de "última posición conocida" pasan siempre, sin importar
  si esta posición puntual se persiste.
- **`PositionRedisClient`, interfaz angosta, no el cliente `ioredis` completo** —
  mismo criterio que `HandshakeRedisClient` de MOVO-158: los tests fakean un Map en
  memoria en vez de mockear una librería entera. `app.redis` la satisface
  estructuralmente sin ningún adapter.
- **AC3 conectado hasta el mapa, no solo hasta Redis**: `tracking.routes.ts` (MOVO-201)
  ahora, apenas registra un socket nuevo, lee la última posición conocida y la manda
  (`{type:"position",...}`) ANTES de esperar el próximo reporte real — sin esto, AC3
  ("es lo que consume el AC4 de MOVO-11") no tenía ningún camino real hasta un
  suscriptor que se conecta después de que el transportista ya viene reportando. No
  estaba en el file list original del ticket, pero sin este engranaje el dato en Redis
  no le llega a nadie dentro del alcance de este ticket.
- **`POSITION_PURGE_ELIGIBLE_STATUSES` (`shipment-state-machine.ts`) = mismo set que
  `TRACKING_CLOSED_STATUSES` MENOS `disputed`**: un envío `disputed` nunca es candidato
  a purga mientras siga en ese estado (decisión de negocio confirmada con el usuario —
  ver ADR-023 abajo). El ancla de "cuándo cerró" es `Shipment.lastStatusChangedAt` (ya
  existía, mantenida por `updateStatus()` desde MOVO-104/105) — si algún día se modela
  una salida real de `disputed`, ese mismo timestamp pasa a marcar la resolución sin
  tocar ningún código acá, cumpliendo "el plazo cuenta desde la resolución, no desde el
  cierre original" sin lógica especial.
- **Retención de 30 días (ADR-023), confirmada con el usuario en el momento de
  refinar el ticket** (el propio ticket exigía definir N "junto con el equipo") —
  `CARRIER_POSITION_RETENTION_DAYS`, sweep periódico
  (`carrier-position-purge-sweep.ts`, mismo esqueleto `setInterval`+lock de Redis que
  `pickup-expiry-sweep.ts`), intervalo default 60min (menos urgente que los sweeps
  operativos de 15min — un rezago de hasta 1h sobre un plazo de 30 días no cambia nada).
- **AC7 (supresión de cuenta alcanza las posiciones), best-effort, no bloqueante** —
  confirmado con el usuario: `DELETE /internal/account-deletion/users/:userId/
  carrier-positions` nuevo (mismo módulo que `active-shipments`, MOVO-134), borra TODAS
  las posiciones donde el usuario fue transportista, sin importar retención (supresión
  inmediata, distinta del ciclo normal). Llamado desde
  `movo-svc-users#deleteAccount` DESPUÉS de la `$transaction` local (dos bases
  distintas, no se puede componer en una transacción cross-servicio) — un fallo se
  loguea (`carrier_positions_delete_failed`) pero nunca revierte ni bloquea una baja
  que el resto ya completó, mismo criterio que el borrado best-effort de la foto de
  perfil en el mismo método. El barrido periódico igual la alcanza más tarde si esto
  falla, aunque no de inmediato. `shipments-client.ts` (`svc-users`) ganó
  `deleteCarrierPositions`, mismo patrón "el cliente lanza, el caller decide" que
  `findReputation`.
- **`accuracyM` requerido, no nullable** — el AC1 lo lista como parte de los 5 campos
  a reportar, tratado igual que `lat`/`lng`, no como opcional.

Tests: `test/position-service.test.ts` (unitario -- autorización de los 3 roles +
todos los estados no-`in_transit`, cadencia de ~45s reportando cada 5s del DoD,
última posición conocida siempre actualizada, difusión de cada reporte, purga y
supresión delegando en el repositorio), `test/position-repository.integration.test.ts`
(Postgres real -- create con timestamps encolados, purga respeta retención, un envío
`disputed` nunca es candidato incluso con 365 días encima, la resolución
`disputed`→`cancelled` reinicia el conteo desde ese momento, los 4 estados elegibles,
`deleteAllForCarrier` sin importar estado), `test/positions-report.integration.test.ts`
(HTTP -- feliz, cadencia end-to-end, 403 por actor/estado en sus 5 variantes, 404, 401,
400 de AJV, confirma que `app.swagger()` expone el path),
`test/carrier-position-purge-sweep.test.ts` (mismo patrón mockeado que
`pickup-expiry-sweep.test.ts`), 2 casos nuevos en `test/tracking.integration.test.ts`
(última posición conocida se manda al conectar / no se manda nada de más sin ella), 3
casos nuevos en `test/account-deletion.integration.test.ts` (borra, aísla por
transportista, usuario sin posiciones). Suite completa del servicio: 837/837 tests (60
archivos), contra Postgres/Redis reales. `movo-svc-users`: 520/520 (49 archivos).
`tsc --noEmit` y `eslint` limpios en los tres paquetes tocados (`shared/movo-shared`,
`movo-svc-shipments`, `movo-svc-users`).

Pendiente / fuera de alcance (igual que el propio ticket): emisión desde el mobile en
foreground/background (MOVO-203) y el mapa de seguimiento (MOVO-204), ambos bloqueados
por este ticket; cálculo de ETA a partir de la traza y detección de desvíos de ruta
(explícitamente fuera de alcance); verificación contra un deploy real en dev/prod (sin
acceso a esa infra desde esta sesión); traducción a copy del código
`SHIPMENT_NOT_IN_TRANSIT` en `movo-mobile/src/lib/error-messages.ts` (sin consumidor
real todavía, MOVO-203 la agrega cuando exista); ADR-023 pendiente de que el usuario lo
publique en Drive (texto completo abajo), igual que los ADRs 012-021.

#### ADR-023 completo (texto para pegar en Drive, `[Movo] 004 - Sprint 0.md`)

> **ADR-023 — Retención de la traza GPS del transportista**
>
> **Contexto**
>
> MOVO-202 persiste la traza de desplazamiento del transportista durante un envío
> `in_transit` (una posición cada ~45s, no solo la última) para dejar evidencia ante
> una disputa (MOVO-30) — no para analítica ni perfilado, propósito que el propio
> ticket obligaba a declarar explícitamente. Una traza de geolocalización de una
> persona física es un dato personal sensible (Ley 25.326): persistirla sin una
> retención acotada y una purga automática real es, tal como advertía el ticket, un
> hallazgo directo en cualquier auditoría de cumplimiento y contradice el derecho de
> supresión que el proyecto ya implementó (MOVO-39, Done).
>
> **Decisión**
>
> - **Retención: 30 días desde que el envío cierra** (`delivered`/`completed`/
>   `cancelled`/`rejected_by_receiver` — el conjunto exacto vive en
>   `POSITION_PURGE_ELIGIBLE_STATUSES`, `shipment-state-machine.ts`). El ancla es
>   `Shipment.lastStatusChangedAt`, no una columna nueva.
> - **Un envío `disputed` nunca es candidato a purga mientras siga en ese estado** —
>   la traza puede ser evidencia de la disputa en curso. `disputed` no tiene hoy
>   ninguna transición de salida modelada (`VALID_TRANSITIONS`, mismo motivo que
>   ADR-021 dejó pendiente la resolución de disputas), así que en la práctica la
>   traza de un envío disputado queda retenida sin límite mientras dure. El día que
>   exista una transición real de salida, el plazo de 30 días cuenta desde ESE
>   momento (la resolución), nunca desde el cierre original anterior a la disputa —
>   consecuencia directa de anclar en `lastStatusChangedAt` en vez de en un timestamp
>   de "primer cierre", sin necesitar ningún cambio de código cuando esa transición
>   se modele.
> - **Purga por job periódico** (`carrier-position-purge-sweep.ts`, cada 60 minutos
>   por default, configurable), no manual ni a demanda — mismo mecanismo ya aceptado
>   en el proyecto para los otros barridos (MOVO-124/130, y el bug de retiro vencido
>   de `published`).
> - **La supresión de cuenta (MOVO-39) no espera los 30 días**: al dar de baja una
>   cuenta, la traza del usuario como transportista se borra de inmediato (best-effort
>   cross-servicio, `movo-svc-users` → `movo-svc-shipments`) — es supresión de datos
>   personales a pedido, un caso distinto del ciclo de vida normal de retención.
>
> **Por qué 30 días, no otro número**
>
> Decisión de equipo, no un mínimo/máximo derivado de una norma específica: cubre la
> ventana típica en la que una disputa se abre después de una entrega (el propio
> flujo de calificación del proyecto usa una ventana de 72hs para calificar,
> MOVO-146, mucho más corta) con margen de sobra, sin retener datos de geolocalización
> más tiempo del que razonablemente hace falta para su propósito declarado —
> principio de minimización de datos.
>
> **Trade-off aceptado**
>
> El plazo es corto en términos de posible litigio civil (que puede escalar mucho
> después de 30 días) — se aceptó igual porque el propósito declarado de esta traza es
> evidencia operativa de una disputa gestionada por la plataforma (MOVO-30), no
> evidencia judicial de largo plazo; si una disputa sigue abierta, queda cubierta por
> la excepción de `disputed` de arriba, que no tiene límite de tiempo mientras dure. El
> borrado cross-servicio de la supresión de cuenta es best-effort, no transaccional
> (no existe 2PC entre `movo-svc-users` y `movo-svc-shipments`, ADR-001) — si falla, el
> barrido periódico igual alcanza esa traza más tarde si el envío ya cerró, pero un
> envío todavía activo cuyo transportista se da de baja (caso ya bloqueado aguas
> arriba: la baja exige cero envíos activos) no es un escenario alcanzable en la
> práctica.
>
> **Referencias**: `MOVO-202` (este ticket), `MOVO-201` (canal de tiempo real),
> `MOVO-39`/`MOVO-134` (derecho de supresión), `MOVO-30` (disputas), `MOVO-146`
> (ventana de calificación, referencia de plazo corto ya aceptada en el proyecto).

### MOVO-245 — Preferencias de notificación push: enforcement + triggers de custodia/inicio de viaje

Sub-issue de backend de MOVO-239/MOVO-240 (catálogo de push, separada de la mobile
MOVO-246). Los ~13 call sites de `sendPush` existentes (envíos/ofertas/viajes/
calificaciones) pasan a usar el copy/categoría centralizados de `@movo/shared`
(`renderNotificationTrigger`/`notificationTriggerCategory`, ver
`shared/movo-shared/CLAUDE.md`) — `category` pasa a un campo obligatorio de
`SendPushNotificationInput`, el enforcement real (toggle maestro/categoría/horario de
silencio) vive del lado de `movo-svc-users`.

- **Dos avisos nuevos que antes no existían, cerrando un gap real del catálogo**:
  el handshake de custodia (`handshake.service.ts`) no disparaba ningún push — ahora
  el retiro avisa a emisor **y** receptor (el receptor nunca sabía que su paquete ya
  estaba en camino) y la entrega avisa a emisor y transportista, cada uno con copy
  propio (antes de este ticket ninguno de los dos existía). El inicio de un viaje
  (`trips.service.ts#dispatchTripStartedPushes`, `startTrip`) tampoco notificaba a
  nadie — ahora avisa a emisor/receptor de cada envío del viaje todavía sin retirar
  (`ASSIGNED_UNFUNDED`/`ASSIGNED`); un envío ya `IN_TRANSIT` del mismo viaje no entra,
  para no duplicar el aviso que ya disparó el handshake de retiro.
- **`sendCustodyPush` (`src/utils/dispatch-push.ts`, fix post-review de PR #182)**:
  colapsa el patrón repetido 3 veces (handshake pickup/delivery, inicio de viaje) de
  renderizar un trigger + `sendPush` + tragarse el error con un `logger?.warn` propio
  — un trigger nuevo de custodia solo necesita un call site, no volver a copiar ese
  try/catch de ~20 líneas.
- **`RoutesProvider.getRouteDurations` (uno-a-muchos, fix post-review de PR #182)**:
  `dispatchTripStartedPushes` pedía un `getRoute` por envío pendiente del viaje (N
  llamadas billables de Google Routes API con el mismo origen — hallazgo de code
  review, ver ADR-015/`GOOGLE_MAPS_MAX_ELEMENTS`). Ahora una sola llamada a
  `Compute Route Matrix` (1 origen x N destinos, `google-routes-provider.ts`) resuelve
  el ETA de todos los envíos pendientes de una vez; un destino sin ruta resuelve a
  `durationSeconds: null` sin tirar el resto de la matriz.

Tests: unitarios verdes en los 3 paquetes (incluidos los nuevos de
`google-routes-provider.test.ts`/`mock-routes-provider.test.ts` para
`getRouteDurations`); los de integración de MOVO-245 en sí quedaron escritos pero sin
poder correrse en este entorno por falta de Postgres/Redis local.

Pendiente / fuera de alcance: mobile de MOVO-246 (pantalla de configuración,
consumiendo las categorías `custody` nuevas); verificar en CI los tests de
integración que no se pudieron correr localmente.

### MOVO-238 — Expiración automática de viajes `declared` vencidos

Cierra el gap que MOVO-221 dejó explícito: un viaje `declared` cuyo `departureAt` pasó
sin que nadie lo iniciara quedaba `declared` para siempre. Sweep nuevo
`src/plugins/trip-expiry-sweep.ts` (mismo esqueleto `setInterval` + lock Redis que
`pickup-expiry-sweep.ts`, lotes de 100, `TRIP_EXPIRY_SWEEP_INTERVAL_MINUTES`/`_ENABLED`,
default 15min/true) sobre `trip-repository.ts#cancelOverdueDeclared`.

Decisiones clave:
- **AC2 resuelto como "bloquea, no cascadea"** (mismo criterio que MOVO-134): un viaje
  vencido con algún paquete aceptado (`ACCEPTED_OFFER_FILTER`, que ya ignora envíos
  `cancelled`) queda `declared` y no se toca — también es coherente con que
  `update`/`delete` ya rechacen ese viaje. Sin cascada de cancelación de envíos.
- **AC5: log estructurado (`trip_auto_cancelled`) + `updatedAt`, sin tabla de eventos
  de `Trip`** — no hay otro consumidor de un historial de viaje que lo justifique.
- **Sin `expired` en `TripStatus`**: se cancela directo a `cancelled`, como pedía AC1.
- **Compare-and-swap por viaje** (`updateMany` re-evaluando el mismo `where`): si el
  viaje se inicia o se le acepta un paquete entre el SELECT y el UPDATE, se saltea. Queda
  una ventana mínima contra un `acceptOffer` concurrente sobre ese `tripId` (no toca la
  fila `trips`), aceptada.
- Env vars en los 3 lugares (`.env.example`, `envSchema`, `infra/docker-compose.yml`).

Pendiente / fuera de alcance: notificar al transportista (evaluado, no implementado);
ciclo de un viaje `active` que nunca llega a `completed`.

### MOVO-250 — Ajustes de ingesta y canal de tracking (ADR-024)

Fija el contrato backend ↔ mobile para la cola offline (MOVO-203) y el envío en segundo
plano (MOVO-242). El patrón se mantiene (ingesta por HTTP, difusión por WebSocket, ADR-024
lo deja escrito por primera vez); cambia cómo el backend trata la cola offline.

Decisiones clave:
- **Última posición conocida monótona (AC1)**: `position-service.ts` la actualiza con un
  script Lua (`UPDATE_LAST_KNOWN_IF_NEWER_SCRIPT`) que compara contra `capturedAtMs` del
  hash y solo escribe si `capturedAt` es ESTRICTAMENTE posterior. Redis y el broadcast
  avanzan juntos: una posición vieja o igual no mueve el marcador ni se difunde, pero sí
  puede entrar a la traza. `PositionRedisClient` ganó `eval` y perdió `hset`/`expire`.
- **Cadencia por tramo de `capturedAt` (AC2)**: el claim pasó de `position:cadence:{id}`
  (ventana móvil desde la llegada) a `position:cadence:{id}:{floor(capturedAt/45s)}`,
  `SET NX` con TTL de 7 días (igual que la última posición: una cola puede vaciarse horas
  después). El resultado no depende del orden de llegada, permite completar tramos
  atrasados y hace idempotente el reenvío de un lote. Sigue liberando el claim si el
  `create` falla.
- **Validación de `capturedAt` (AC3)**: rechaza (422 `INVALID_CAPTURED_AT`, código nuevo
  en `@movo/shared`) un `capturedAt` más de 2 min en el futuro o más de 2 min anterior a
  `shipment.lastStatusChangedAt`, que mientras el envío está `in_transit` es el instante
  en que pasó a ese estado (no hay columna propia). La tolerancia
  (`CAPTURED_AT_CLOCK_SKEW_TOLERANCE_MS`) es simétrica: fix de review de PR #190, la
  primera versión no la tenía hacia el pasado y rechazaba la primera muestra del tránsito
  si el GPS muestreó segundos antes de que el servidor confirmara el handshake o el reloj
  del teléfono estaba atrasado. Si `lastStatusChangedAt` es null (datos viejos) no se
  aplica el piso.
- **Lote (AC4)**: `POST /shipments/positions`, `{positions: [...]}` de 1 a 100
  (`MAX_POSITIONS_PER_BATCH`). Responde 200 con `results[]` (`index`, `shipmentId`,
  `status: accepted|rejected`, `persisted`/`code`); `FORBIDDEN` es la traducción de
  `AUTH_FORBIDDEN` del endpoint individual. Un envío distinto se lee una sola vez por
  lote. Un error de infra (DB/Redis caídos) NO se convierte en rechazo por ítem: falla el
  request entero y el cliente reintenta, seguro por la idempotencia de arriba. El
  individual sigue existiendo y comparte `assertCanReport`/`ingest`.
- **Rate limit (AC5)**: el límite general del gateway es 200/min por IP compartido con
  toda la API, y el individual (`/:id/positions`, path con parámetro) sigue bajo ese
  límite. El lote tiene contador propio en `getRateLimitOverrides()`:
  **30 requests/min por IP** (hasta 3.000 posiciones/min). Es lo que `MOVO-242` debe
  respetar; el keyGenerator del gateway es por IP, no por usuario.
- **`{type:"status", shipmentId, status}` (AC6)**: `realtime.ts` lo difunde en cada
  `shipment-status-changed`, antes del cierre `4009` para que el cliente reciba el estado
  final. `offer-repository.ts#acceptOffer` (`published → assignment_pending`) escribía
  `status` directo sin emitir el evento: ahora lo emite tras el commit. `assigned` ya
  aceptaba la suscripción (`TRACKING_CLOSED_STATUSES` no lo incluye), cubierto por test.
- **Cierre por vencimiento del JWT (AC7)**: `authorizeRealtimeConnection` devuelve
  `tokenExpiresAtMs` y `tracking.routes.ts` arma un `setTimeout` que cierra con `4001`
  al llegar el `exp` (mismo código que el rechazo por token inválido: el cliente
  reconecta con un token renovado).
- **`RealtimeRegistry.broadcast` (AC8)**: solo a `readyState === 1` (literal, `ws` es
  devDependency) y con try/catch por socket.

Tests: `position-service.test.ts` (AC1-AC4 con fake de Redis que emula el Lua),
`positions-report.integration.test.ts` (Redis y Postgres reales: AC1 con concurrencia,
AC2 con 30 posiciones en orden invertido, AC3, lote mixto, idempotencia, 400/401),
`tracking.integration.test.ts` (AC6 en `assigned`, evento de estado, AC7 con JWT de 2s),
`realtime-registry.test.ts` (AC8). Los tests de integración crean el envío con
`lastStatusChangedAt` 1h atrás para que los `capturedAt` recientes no caigan antes del
inicio del tránsito.

Pendiente / fuera de alcance: prueba del WebSocket contra la EC2 de dev real (pendiente de
MOVO-201 AC6 / ADR-022 AC3); consumo del lote desde `movo-mobile` (MOVO-242) y del evento
`status` (MOVO-159/204); ADR-024 pendiente de pegar en Drive (`[Movo] 004 - Sprint 0.md`),
### MOVO-251 — Gatear ingesta y lectura de tracking por Trip activo, no por Shipment.status

Corrige el modelo de tracking: antes de este ticket, `position-service.ts` gateaba la ingesta
únicamente por `Shipment.status === IN_TRANSIT`, rechazando con 403 posiciones tomadas mientras
el transportista se acercaba a retirar el paquete (estado `ASSIGNED`), y `carrier_positions`
estaba indexada únicamente por `shipment_id`, duplicando filas innecesariamente en envíos
consolidados de un mismo viaje (VRPTW).

Decisiones clave:
- **Autorización por Trip activo (`Trip.status === active`)**: la autorización valida que el
  envío pertenezca a un viaje mediante oferta `accepted` (`ShipmentTrackingContext`) y que dicho
  viaje esté en `active` (MOVO-221). `Shipment.status` se acepta tanto en `assigned` como en
  `in_transit`; se rechaza en `delivered` y estados terminales/cerrados.
- **Nuevo código de error `SHIPMENT_NOT_TRACKABLE`**: reemplaza a `SHIPMENT_NOT_IN_TRANSIT` para
  señalar que el envío no pertenece a un viaje activo o ya no es trackeable. Incorporado en
  `@movo/shared#ApiErrorCode` y reflejado en el esquema de Swagger y respuesta de lote (`PositionRejectionCode`).
- **Persistencia y cadencia por `trip_id` en Postgres y Redis**:
  - `shipments.carrier_positions` gana columna `trip_id UUID NOT NULL` con FK a `trips(id)` y
    `carrier_positions_trip_id_recorded_at_idx`.
  - Migración con backfill desde `shipments.offers` (`status = 'accepted'`) y purga de filas
    huérfanas de testing sin viaje.
  - La clave de cadencia (`persistCadenceBucketKey`) y la última posición conocida en Redis
    (`lastKnownPositionKey`) se indexan por `tripId`: si el transportista lleva dos envíos del mismo
    viaje, la cadencia se evalúa a nivel de viaje y persiste una sola fila en Postgres.
- **Read-side (`getLastKnownPosition`)**: resuelve `shipmentId -> tripId -> position:last:{tripId}`.
  Si el envío sale del viaje o entra en un estado terminal (`TRACKING_CLOSED_STATUSES`), deja de
  resolver posición para ese envío individual (`null`), sin afectar a los demás envíos del viaje.
- **Difusión en tiempo real**: cuando entra una nueva posición para el viaje, se difunde a todos los
  envíos activos asociados a ese viaje.

### MOVO-174 — Conexiones mutuas: contrapartes en común entre dos usuarios (`svc-shipments`)

Endpoint interno `GET /internal/users/:userId/mutual-connections/:otherId` (módulo nuevo
`src/modules/mutual-connections/`, calcado de `account-deletion`: no pasa por el gateway,
`schema.hide: true`) que consulta `movo-svc-users` para el "Ya envió con N personas con las que
vos también enviaste" del perfil. `shipment-repository.ts#countMutualCounterparties` arma, para
cada usuario, el conjunto de contrapartes (en cualquier rol) de sus envíos ENTREGADOS, intersecta
y excluye a los dos usuarios de la cuenta.

- **Devuelve solo `{ totalCount }`, nunca los ids**: decisión de privacidad de MOVO-174 (solo el
  conteo, sin nombrar a terceros que no dieron consentimiento). Así ningún dato de terceros sale de
  este servicio; pasar a "con nombres" sería un cambio de contrato interno acotado.
- **Cuentan solo `delivered`/`completed`** (`FULFILLED_SHIPMENT_STATUSES`): "ya envió con X" habla de
  algo que ocurrió. Distinto de `getSharedHistory` (MOVO-170), que cuenta envíos en cualquier estado.
- **Un envío directo entre los dos usuarios no cuenta** como conexión mutua.

Pendiente / fuera de alcance: mostrar nombres de pila (requeriría revertir la decisión de privacidad
y un ADR corto).

### Pendientes de este servicio

- **AC6 de MOVO-81 sin confirmar por el equipo**: el gate quedó implementado sobre
  `→ published` (interpretación propuesta en Linear); si el equipo responde distinto,
  es un ajuste acotado a `shipment-repository.ts#updateStatus()`.
- **Liberación del hold de MercadoPago al cancelar (MOVO-29) y cancelación con
  penalización desde `assigned`**: bloqueadas por `svc-payments`, que hoy no tiene
  holds/capture reales — ver MOVO-108 arriba.
- **`agreedPriceArs` resuelto en MOVO-244**: `offer-repository.ts#acceptOffer` ahora persiste
  `agreedPriceArs: current.priceOffered` atómicamente al pasar a `assignment_pending`, y
  `getShipmentDetail` cuenta con fallback defensivo que recupera el precio de la oferta aceptada
  si un registro histórico previo no lo tenía persistido.

