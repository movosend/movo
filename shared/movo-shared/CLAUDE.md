# CLAUDE.md — shared/movo-shared

Estado de implementación de `shared/movo-shared`. Ver el `CLAUDE.md` de la raíz del
repo para contexto general del proyecto (stack, ADRs, convenciones, git/PR). Entrada
corta por US: qué se hizo, en qué archivos, decisiones no obvias, qué queda pendiente.

## Estado actual de la implementación

### MOVO-67 — `@movo/shared`

JWT (`signAccessToken`/`verifyAccessToken`, TTL 60min), refresh token opaco, contrato
`ApiError`/`ApiErrorCode` (códigos nunca se renombran, solo se agregan), tipos de
dominio (`UserRole`, `KycStatus`, `AccountStatus`). Consumido como npm workspace por
gateway y servicios Node — el mobile lo importa siempre por subpath (ver MOVO-73), el
barrel raíz arrastra `jsonwebtoken`/`node:crypto`.

### MOVO-121 — `Address`/`CreateAddressInput`/`UpdateAddressInput`

`src/types/address.ts` — wire contract de `/addresses` (`movo-svc-users`, MOVO-119),
migrado desde un duplicado local en `movo-mobile/src/api/addresses-client.ts` (mismo
criterio que `PrivateProfile`/`PublicProfile`, MOVO-78). `createdAt`/`updatedAt` son
`string` (ya serializados), no `Date` — es el shape de la respuesta HTTP, no el modelo
interno del backend. El backend (`services/movo-svc-users/src/models/address.ts`) no
se migró a importar este tipo — fuera de alcance de MOVO-121 (mobile-only), su modelo
local ya coincide estructuralmente.

### MOVO-135 — `dni` y `phoneVerified` incorporados a `PrivateProfile`

`src/types/user-profile.ts`. El campo estaba excluido a propósito desde MOVO-77
(review de PR #55) junto con `phoneVerified`/`birthdate`, con la razón anotada en el
propio comentario del tipo: quedaba afuera *"hasta confirmar con quien implemente
MOVO-31 (editar datos personales) si hacen falta"*. MOVO-135 es esa confirmación — la
pantalla de editar perfil lo muestra como dato de solo lectura junto al nombre.

- Tipado como **`string | null`**, no `string`: `User.dni` es opcional en el schema de
  Prisma, así que las cuentas creadas antes de que el registro lo pidiera no lo tienen.
- Sigue **sin ser editable por ninguna vía**: `patchProfileBody` de `svc-users` solo
  acepta `firstName`/`lastName`, y mandar `dni` es 400. Con KYC aprobado quedó validado
  contra el documento por Didit; sin KYC todavía no hay flujo que permita corregirlo.
- `phoneVerified` y `birthdate` siguen afuera — esta US no los necesitó.
- **`phoneVerified` entró en el mismo movimiento**, por la insignia de verificado de la
  fila del teléfono. Ojo con el nombre: habla **solo del teléfono**. No existe
  `emailVerified` ni columna equivalente en la DB — el sistema no tiene forma de verificar
  un email (sin `EmailProvider`, ver MOVO-133), y por eso el OTP del cambio de email viaja
  al teléfono. No construir una insignia de "email verificado" sobre este campo.

### MOVO-139 — `PrivateProfile.emailVerified`

Campo nuevo en el wire contract de `GET /users/me` (`src/types/user-profile.ts`): el
email pasó a ser un dato verificado por OTP (`movo-svc-users`, ADR-017), no solo de
contacto. Lo consume la pantalla de perfil del mobile para la insignia y el CTA de
verificación (MOVO-135). Es obligatorio, no opcional: el backend siempre lo devuelve, y
un `boolean | undefined` obligaría a cada consumidor a decidir qué significa la ausencia.

### MOVO-143 — `config/commission.ts` (comisión de Movo + fee de MercadoPago)

`src/config/commission.ts` — primera config de *negocio* (no de auth) que vive en
`@movo/shared` en vez de en el `envSchema` de cada servicio: `getCommissionConfig()`
(lectura perezosa/memoizada de `MOVO_COMMISSION_RATE`/`MP_TRANSACTION_FEE_RATE` desde
`process.env`, mismo patrón que `auth/config.ts#getJwtConfig()`) y
`computeOfferGrossPrice()` (función pura, neto→bruto). Consumido hoy por
`movo-svc-shipments` (AC6 de MOVO-143, creación de oferta) — pensado para que
`movo-svc-payments` (split real) y `movo-svc-admin` (estadísticas) reusen el mismo
número más adelante en vez de duplicarlo, en particular `mpTransactionFeeRate`, que
esta US define pero todavía no descuenta en ningún lado (`movo-svc-payments` sigue
siendo un esqueleto). `MOVO_COMMISSION_RATE` confirmado en 15%;
`MP_TRANSACTION_FEE_RATE` es un placeholder pendiente de confirmar con el contrato
real de MP.

### MOVO-188 (fix de review, PR #142) — `computeNetFromGross`

`src/config/commission.ts` suma `computeNetFromGross(grossArs, rate?)`, inversa de
`computeOfferGrossPrice`. Reemplaza dos copias inline idénticas
(`offers.service.ts#toNetArs` en `movo-svc-shipments`, y
`shipments.service.ts#computeOffersSummaryForCarrier` desde MOVO-180) que hacían el
mismo `Math.round((gross/(1+rate))*100)/100` por separado — un cambio futuro de
redondeo/fórmula en un lado sin el otro las habría dejado inconsistentes para el mismo
envío. Mismo criterio de centralización que `computeOfferGrossPrice` (MOVO-143).

### MOVO-186 — `decomposeOfferGrossPrice`

`src/config/commission.ts` suma `decomposeOfferGrossPrice(grossArs, rate?)`, que
devuelve el desglose completo `{netArs, commissionAmountArs, grossArs}` a partir del
BRUTO ya persistido — reusa `computeNetFromGross` (MOVO-188) para el neto y deriva
`commissionAmountArs` restando contra el bruto ya redondeado (no con su propia
fórmula), para que `netArs + commissionAmountArs === grossArs` se mantenga incluso en
los bordes de redondeo. Consumido por `movo-svc-shipments` (`offer.dto.ts`/
`offers.routes.ts`) para exponer `priceNetArs`/`commissionAmountArs` en las 4
respuestas de oferta que antes solo devolvían el bruto (`GET /offers/mine`,
accept/reject/withdraw) — hasta ahora solo `POST /shipments/:id/offers` los exponía
(MOVO-143). Test unitario dedicado nuevo, `test/commission.test.ts` (no existía
ninguno hasta esta US, pese a que `computeOfferGrossPrice`/`computeNetFromGross` ya
llevaban dos US sin cobertura propia en `shared`).

### MOVO-152 — `ReputationBreakdown`/`RecentRatingComment` y `PublicProfile` extendido

`src/types/user-profile.ts` — dos tipos nuevos consumidos por `movo-svc-users`
(`src/adapters/shipments-client.ts`), wire contract de los endpoints internos de
`movo-svc-shipments` que ya existían desde MOVO-146/147 sin un consumidor real:
`ReputationBreakdown` (`reputationScore`/`ratingCount`/`isNewProfile`, misma forma que
`ReputationResult` interno de `svc-shipments`) y `RecentRatingComment` (proyección
mínima de `Rating` -- `id`/`raterId`/`score`/`comment`/`createdAt`, sin `shipmentId`/
`rateeId`/`role`).

`PublicProfile` sumó `ratingCount`/`isNewProfile`/`asSender`/`asCarrier`/
`recentRatingComments` — **solo esta proyección**, no `PrivateProfile` (el AC del
ticket dice explícitamente "se agrega al contrato del perfil público"). Cualquier
literal `PublicProfile` construido a mano (tests/fakes) necesita ahora esos 5 campos —
tocó `services/movo-svc-shipments/test/fake-users-client.ts#fakePublicProfile()`.

### MOVO-82 — `QuoteRequest`/`QuoteResponse`/`PriceCalculationMethod`

`src/types/pricing.ts` — wire contract de `POST /quote`
(`movo-svc-pricing-logistics`, primer endpoint de negocio de ese servicio), consumido
por `movo-svc-shipments/src/adapters/pricing-client.ts` y a futuro por el wizard de
creación de envío del mobile (MOVO-83). `PriceCalculationMethod` (hoy solo
`EUCLIDEAN_LINEAR_V1`) identifica la versión del algoritmo que calculó el precio —
reemplazar la implementación provisoria por el motor real no requiere migrar este
contrato, solo agregar un valor nuevo al enum.

### MOVO-162 — `TRIP_NOT_ACTIVE`

Código nuevo en `ApiErrorCode` (`errors/api-error.ts`), consumido por
`movo-svc-shipments#createOfferForShipment` al validar el `tripId` opcional de
`POST /shipments/:id/offers` — 409 cuando el viaje referenciado ya no está `active`
(cancelado/completado). Ver `services/movo-svc-shipments/CLAUDE.md` (entrada de
MOVO-161) para el detalle completo.

**Gotcha de build local (review PR #120, Pedro Yorlano)**: los servicios Node
consumen `dist/*.d.ts` de este paquete (`"types": "dist/index.d.ts"` en
`package.json`), nunca `src/` directo — agregar un `ApiErrorCode` nuevo acá y
correr `tsc --noEmit` en `movo-svc-shipments`/otro consumidor **sin antes** correr
`npm run build` en `shared/movo-shared` falla con `Argument of type "X" is not
assignable to parameter of type 'ApiErrorCode'`, porque el `dist/` local sigue
reflejando el código viejo (`dist/` está gitignoreado, no se reconstruye solo). Si
tocás este paquete, siempre `npm run build` acá antes de tipar contra el cambio
desde otro workspace.

### MOVO-170 — `PublicProfile`/`ReputationBreakdown`/`RecentRatingComment` extendidos, `SharedHistory` nuevo

Enriquecimiento de perfil con datos ya persistidos (`movo-svc-users`/
`movo-svc-shipments`, ver sus `CLAUDE.md`). Todos los campos son aditivos — no rompen
consumidores existentes.

- **`PublicProfile`** sumó `memberSince: string` (ISO), `phoneVerified: boolean`,
  `emailVerified: boolean` — ya existían en `PrivateProfile`, solo faltaba exponerlos
  acá (sin filtrar el teléfono/email reales, mismo criterio que `isVerified`).
- **`ReputationBreakdown`** sumó `usageStats?: { delivered, cancelled,
  avgPackageWeightKg }` — opcional: el fallback `NO_REPUTATION` de
  `movo-svc-users` no lo trae, y no hace falta un objeto con ceros disfrazando
  "sin datos".
- **`RecentRatingComment`** sumó `raterName: string` (no opcional, siempre resuelto
  por `movo-svc-users` antes de responder) — decisión de producto confirmada con el
  usuario: el calificador deja de ser anónimo de cara al calificado.
- **`SharedHistory` nuevo** (`types/shipment.ts`, junto a `ShipmentStatus`):
  `{ sharedShipmentCount, lastSharedAt, allDelivered }`, wire contract de
  `GET /shipments/history-with/:userId` (`movo-svc-shipments`).

### MOVO-171 — `PrivateProfile.bio`/`PublicProfile.bio`

`src/types/user-profile.ts` — `bio: string | null`, campo **requerido** (no opcional)
en ambos tipos, backend en `movo-svc-users` (ver su `CLAUDE.md`). A diferencia de
MOVO-152/170, este campo sí rompe la compilación de cualquier literal `PublicProfile`/
`PrivateProfile` construido a mano sin `bio` — tocó
`services/movo-svc-shipments/test/fake-users-client.ts#fakePublicProfile()` (agregado
`bio: null` al fake, mismo criterio que el resto de los campos que ese servicio no
ejercita de verdad). El mobile tiene su propio ajuste pendiente en otra rama
(MOVO-154/176), fuera del alcance de esta PR.

### MOVO-172 — `VehicleProfile` exportado desde el barrel raíz

`src/types/user-profile.ts` ya tenía el tipo (`VehicleProfile: {brand, model,
cargoCapacityLabel, licensePlate}`) y `PublicProfile.vehicle?: VehicleProfile | null`
definidos desde antes (preparación de MOVO-176), pero `VehicleProfile` no estaba en el
export type del barrel (`src/index.ts`) — el backend de `movo-svc-users` (esta US)
necesitaba importarlo para tipar `toPublicProfile`. Campo aditivo, no rompe ningún
literal `PublicProfile` construido a mano (opcional, a diferencia de `bio` en
MOVO-171).

### `toArgentinaCalendarDateString` (sin ticket propio — refactor de unificación)

`src/utils/argentina-date.ts` — primera utilidad de `@movo/shared` sin relación con
auth/tipos/comisión: la cuenta pura "instante real → día calendario argentino
(`YYYY-MM-DD`)", extraída de `movo-svc-shipments/src/domain/pickup-window.ts` tras
encontrar la misma lógica reimplementada a mano en `movo-mobile` (bug de MOVO-183, la
franja "de paso" del tab Transportar no filtraba por fecha). El backend sigue
envolviendo el resultado en el `Date` anclado que necesita para comparar contra
columnas `@db.Date` en SQL; mobile la consume tal cual. Sin dependencias de Node —
función pura sobre `Date`/`string`, segura también en React Native.

### MOVO-192 — `ActiveShipmentSummary`/`ActiveShipmentStatus`/`ActiveShipmentCounterparty`

`src/types/shipment.ts` — wire contract de `GET /shipments/sending|transporting|
receiving` (`movo-svc-shipments`), primer tipo de este paquete que nace directamente
del contrato que el equipo mobile había dejado comentado en Linear (camelCase, no el
snake_case literal del AC) mientras implementaba `MOVO-193` contra un mock, en vez de
nacer del lado del backend. `ActiveShipmentStatus` acota `ShipmentStatus` a los 3
valores "activos" (`assigned_unfunded`/`assigned`/`in_transit`) en vez de reusar el
enum completo — mismo criterio que otros subconjuntos con nombre propio del proyecto.
`agreedPriceArs: number | null` (no solo `number`, a diferencia del mock de mobile): la
columna real sigue nullable y ningún flujo la puebla todavía al aceptar una oferta (ver
`services/movo-svc-shipments/CLAUDE.md`, MOVO-192, sección de pendientes). El mobile
sigue con su propia copia local del tipo (`shipments-client.ts`) — migrarla a importar
desde acá queda pendiente, fuera de alcance de este ticket (100% backend).

### MOVO-228 — `LEGAL_DOCUMENT_VERSIONS`, `PrivateProfile` extendido, `LEGAL_DOCUMENT_VERSION_MISMATCH`

`src/config/legal.ts` (nuevo, mismo patrón que `config/commission.ts` — primera config
de negocio no relacionada a auth/comisiones): `LEGAL_DOCUMENT_VERSIONS = { terms,
privacy }`, fuente única de verdad de qué versión de cada documento legal es la
vigente hoy — `movo-svc-users` la valida contra lo que manda el registro,
`movo-mobile` la manda y la usa para saber si mostrarle al usuario que hay una
versión nueva. El valor es la fecha de "Última actualización" del propio `.md`
(`docs/legal/`). **Ya no se bumpea a mano acá**: `npm run sync:legal`
(`scripts/sync-legal-docs.ts`, raíz del repo) lo regenera junto con las copias `.ts`
de `movo-mobile` a partir del `.md` — ver la entrada transversal "Automatización de
sync de documentos legales" en el `CLAUDE.md` raíz.

`PrivateProfile` sumó `termsAcceptedAt`/`termsVersion`/`privacyAcceptedAt`/
`privacyVersion` (los cuatro `string | null` — `null` solo para cuentas creadas antes
de este ticket, sin backfill retroactivo) — la "firma electrónica" que se muestra en
Perfil → Legal (`movo-mobile`). Campo aditivo requerido: rompe cualquier literal
`PrivateProfile` construido a mano sin los cuatro (mismo criterio que `bio`,
MOVO-171) — tocó varios fixtures de test en `movo-svc-users`/`movo-mobile`.

`ApiErrorCode` sumó `LEGAL_DOCUMENT_VERSION_MISMATCH` — la app mandó una versión
vieja de Términos/Privacidad al registrarse (app desactualizada).

### MOVO-222 — `RatingRole`/`PendingRatingShipment`

`src/types/shipment.ts` — wire contract de `GET /shipments/pending-ratings`
(`movo-svc-shipments`, endpoint nuevo, no un campo en `ShipmentSummary`/`/mine` — ver
`services/movo-svc-shipments/CLAUDE.md` para la decisión completa). `RatingRole`
(`"sender" | "carrier" | "receiver"`) es la primera vez que este tipo cruza el barrel
compartido — antes vivía duplicado como enum Prisma en `movo-svc-shipments/src/models/
rating.ts` (MOVO-146) y como literal propio en `movo-mobile/src/api/ratings-client.ts`
(MOVO-153), sin unificar porque ningún wire contract lo había necesitado hasta ahora.
**Corrección de review (mismo PR):** `ratings-client.ts` ahora reexporta `RatingRole`
desde acá en vez de mantener el literal propio — de las 3 copias quedan 2 (esta y el
enum Prisma del backend, que sigue siendo la fuente de verdad del lado de Postgres).
`PendingRatingShipment` también suma `ratingDeadline` (deadline absoluto, no solo
`deliveredAt`) — el cliente no puede recomputar la ventana de 72hs a mano porque un
freeze de disputa la extiende de forma variable, mismo criterio que
`ActiveShipmentSummary.receiverConfirmationDeadline`.

### MOVO-208 — `ShipmentStatus` extendido a 11 valores

`src/types/shipment.ts` suma `ASSIGNED_UNFUNDED = "assigned_unfunded"` (entre
`ASSIGNMENT_PENDING` y `ASSIGNED`, refleja el flujo: ruta alternativa cuando el retiro
es lejano y el hold de fondos de MOVO-12 todavía no se creó) y
`COMPLETED = "completed"` (después de `DELIVERED`, entregado Y pago liberado —
MOVO-212). Set canónico de MOVO-79/MOVO-105 pasa de 9 a 11 — actualizado en el mismo PR
que el enum de Postgres (`movo-svc-shipments/prisma/schema.prisma`) y la máquina de
estados, conforme obliga el AC6 de MOVO-79. Ver `services/movo-svc-shipments/CLAUDE.md`
(entrada de MOVO-208) para el detalle completo y ADR-021 (`CLAUDE.md` raíz) para el
razonamiento.

### MOVO-221 — `TripStatus` gana `declared`; `TRIP_NOT_DECLARED`/`TRIP_ALREADY_HAS_ACTIVE_TRIP`/`TRIP_NOT_AVAILABLE`

`src/types/trip.ts` — `TripStatus.DECLARED` insertado antes de `ACTIVE`: pasa a ser el
estado inicial real de un viaje declarado (`declared -> active -> completed`, un viaje
ya no nace directo en `active`). Tres códigos nuevos en `ApiErrorCode`
(`errors/api-error.ts`) para el endpoint `POST /trips/:id/start` y el chequeo ampliado
de `tripId` en `POST /shipments/:id/offers` — `TRIP_NOT_ACTIVE` (MOVO-162) queda sin
uso pero nunca se elimina (contrato de wire). Detalle completo en
`services/movo-svc-shipments/CLAUDE.md` (entrada de MOVO-221).

### MOVO-245 — Catálogo de notificaciones: categorías, copy centralizado, horario de silencio

Sub-issue de backend de MOVO-239/MOVO-240. Tres archivos nuevos en `src/config/`:

- **`notification-categories.ts`**: catálogo de 11 categorías, 5 implementadas
  (`custody`/`offers`/`ratings`/`trips`/`shipments`) y 6 marcadas `implemented: false`
  ("Pronto" — `proximity`/`payments`/`kyc`/`account_security`/`chat`/`disputes`, del
  catálogo de MOVO-240 sin trigger real todavía). El `id` es un string libre validado
  en código vía `isImplementedNotificationCategory`, no un enum de Prisma — sumar una
  categoría nueva no pide migración. `IMPLEMENTED_NOTIFICATION_CATEGORY_IDS` es la
  lista que
  `movo-svc-users` usa para validar `PUT /users/me/notification-preferences` (una key
  desconocida o "Pronto" es 400) y para resolver el default (`true`) de cualquier
  categoría sin fila explícita (AC5, tabla sparse).
- **`notification-templates.ts`**: copy (título/cuerpo) centralizado por trigger
  (`NOTIFICATION_TRIGGERS`, un literal tipado por `NotificationTriggerKey`) con
  interpolación (`renderNotificationTrigger`) y su categoría asociada
  (`notificationTriggerCategory`) — reemplaza el copy que antes vivía a mano repetido
  en cada call site de `sendPush` de `movo-svc-shipments` (~13 sites, ver su
  `CLAUDE.md`, entrada de MOVO-245).
- **`quiet-hours.ts`** (`isValidTimeOfDay` + el cálculo del horario de silencio en hora
  Argentina) y `formatEtaDuration` (min u horas) reusado por los triggers que llevan
  ETA (retiro/inicio de viaje).

`SendPushNotificationInput.category` (`movo-svc-shipments/src/adapters/
notifications-client.ts`) pasa a ser un campo **obligatorio**, no un cambio de tipo
compartido acá — `movo-svc-users` (`sendPushToUser`, único choke point) lo necesita
para poder respetar el toggle maestro/de categoría/horario de silencio antes de
enviar. Todo caller existente que no lo mande rompe en tiempo de compilación.

### MOVO-138 — Contrato `demand_fuel_routes_v1` de `POST /quote`

`src/types/pricing.ts`: `PriceCalculationMethod.DEMAND_FUEL_ROUTES_V1` (sin borrar
`EUCLIDEAN_LINEAR_V1`, sigue persistido en envíos viejos), `QuoteRequest.demandContext?`
(`DemandContext`, nuevo export) y `QuoteResponse.highDemand`. `breakdown` y
`PriceBreakdownItem` salen del contrato: ningún consumidor los leía y el desglose pasa al
log `pricing_quote_computed` del servicio (ADR-025). El enum de Python
(`movo-svc-pricing-logistics/app/models/quote.py`) se actualizó en el mismo commit.
### MOVO-173 — `config/rating-categories.ts`

`CARRIER_RATING_CATEGORIES` (puntualidad/cuidado del paquete/comunicación) y
`SENDER_RATING_CATEGORIES`/`RECEIVER_RATING_CATEGORIES` (`{ key, label, scoreField }`;
puntualidad/comunicación, el mismo set a propósito para las dos contrapartes del
transportista) son la fuente única de las sub-categorías de una calificación: `svc-shipments` las usa para
validar y agregar, `movo-mobile` para dibujar los inputs de `RatingSheet` (import por
subpath `dist/config/rating-categories`, no por el barrel). `scoreField`
(`RatingCategoryScoreField`) es el nombre del campo en el wire contract. Exportados
también desde el barrel, junto con `ReputationCategoryScore` (que ya existía pero no se
exportaba). `ReputationBreakdown.categories` deja de ser "todavía sin backend".

### MOVO-175 — Reportar y bloquear usuarios

`ReportReason`/`ReportStatus` (ya existían sin backend) pasan a exportarse desde el barrel;
nuevos `BlockedUserSummary` (`types/user.ts`), `PublicProfile.isBlockedByMe?` (opcional, solo
en `GET /users/:id` mirando a otro) y los códigos `USER_BLOCKED`/`CANNOT_MODERATE_SELF`. El
límite diario de reportes reusa `RATE_LIMIT_EXCEEDED` en vez de un código propio. Review de
PR #193: `UserReportSummary`/`UserReportEntry` (reporte propio en revisión con la información
sumada después) y los códigos `REPORT_ALREADY_PENDING`/`REPORT_NOT_FOUND`.

### MOVO-174 — `MutualConnections`

`src/types/user-profile.ts` — wire contract de `GET /users/:id/mutual-connections`
(`{ totalCount, sampleFirstNames }`), migrado desde un tipo local de `movo-mobile` (mismo criterio que
`PublicProfile`). `sampleFirstNames` viaja siempre vacío por la decisión de privacidad de esa US (solo
el conteo); se mantiene en el tipo para poder mostrar nombres más adelante sin romper clientes.

### MOVO-255 — Contrato de la cotización congelada

`ShipmentQuoteRequest`/`ShipmentQuoteResponse` (`types/pricing.ts`) para
`POST /shipments/quote`; la respuesta es una unión: con precio trae `quoteId`/`expiresAt`,
sin precio todo `null`. Códigos nuevos `QUOTE_EXPIRED`/`QUOTE_MISMATCH` (ADR-028).

### MOVO-252 — `TRIP_START_TOO_EARLY` en `ApiErrorCode`

`src/errors/api-error.ts` — código nuevo en `ApiErrorCode` para el endpoint `POST /trips/:id/start` (MOVO-221), retornado cuando el transportista intenta iniciar un viaje antes de la fecha programada. Consumido por el cliente móvil (`movo-mobile`, MOVO-252) para mapear el error a un mensaje legible con la fecha de salida.


### Juego de precios de la feria — `QuoteBreakdown` y códigos nuevos

`types/pricing.ts`: `QuoteRequest.includeBreakdown?` y `QuoteResponse.breakdown?`
(`QuoteBreakdown`, espejo del modelo Python). `ApiErrorCode` suma `AUTH_API_KEY_INVALID`
(gateway, prefijo `/demo`) y `PRICING_UNAVAILABLE` (503 del juego cuando pricing no cotiza).

### MOVO-237 — código `ROUTE_MODE_NOT_IMPLEMENTED`

`ApiErrorCode` suma `ROUTE_MODE_NOT_IMPLEMENTED` (501), que responde `RoutesProvider` de
`svc-shipments` si se pide el modo `live`, reservado y sin implementar (ADR-033).

### MOVO-258 — `OfferStatus.SHIPMENT_CANCELLED`, `TRIP_NO_PACKAGES` y triggers de notificación (ADR-032)

`types/offer.ts`: 7° valor de `OfferStatus` (oferta cerrada porque su envío se canceló).
`errors/api-error.ts`: código `TRIP_NO_PACKAGES` (iniciar un viaje sin paquetes). `config/notification-templates.ts`: triggers
`shipmentCancelledPickupMissed{Sender,Receiver,Carrier}`, `offersNeedReview` y `transitAnomalyCheck`.

### MOVO-274 — Triggers de KYC, cuenta y seguridad y calificación pendiente

`config/notification-templates.ts` suma 12 triggers: `kyc{Identity,License}{Approved,Rejected,ManualReview}`
(6), `accountPasswordChanged`/`accountEmailChanged`/`accountPhoneChanged` (categoría `account_security`) y
`ratingPending{Sender,Receiver,Carrier}` (categoría `ratings`, que ya estaba implementada).
`config/notification-categories.ts`: `kyc` y `account_security` pasan a `implemented: true` (la pantalla de
MOVO-246 las muestra con toggle real, sin cambios en mobile); `account_security` es la primera categoría
con `quietHoursExempt: true` en uso.

- **Seis triggers de KYC y no uno parametrizado**: el copy tiene que dejar claro de cuál de las dos
  verificaciones se trata, y `displayCopy` de la pantalla de Configuración muestra cada aviso tal cual.
- **Ningún copy lleva datos sensibles** (motivo del rechazo, email o número nuevos): un push se ve en la
  pantalla bloqueada.
- Sin test propio en `shared` que los referencie: se cubren desde los tests de `svc-users` y
  `svc-shipments`. Recordatorio habitual: tras tocar este paquete, `npm run build` antes de tipar desde
  otro workspace (los servicios leen `dist/`).

### MOVO-277 — `config/trip-start.ts` y códigos `TRIP_START_TOO_EARLY`/`TRIP_PACKAGES_NOT_READY` (ADR-034)

`canStartTripOn(departureAt, now)` y `tripStartAvailableOn(departureAt)`: la regla de "¿ya se puede
iniciar este viaje?" por fecha, comparando días calendario argentinos con `toArgentinaCalendarDateString`.
La usan `svc-shipments` (`POST /trips/:id/start`) y `movo-mobile` (si muestra "Iniciar viaje"), así no
se desalinean. Mobile la importa por subpath (`dist/config/trip-start`). `ApiErrorCode` vuelve a tener
`TRIP_START_TOO_EARLY` (MOVO-252 lo había agregado y sacado sin que el backend lo emitiera nunca) y suma
`TRIP_PACKAGES_NOT_READY` (paquetes aceptados, ninguno ejecutable todavía).

### MOVO-112 — Contrato de la vinculación de Mercado Pago (`types/mp-connect.ts`)

Wire contract de `/payments/mp-connect/*` (MOVO-111, `svc-payments`), propuesto desde mobile y
publicado como comentario en MOVO-111 antes de que exista el backend. `MpConnectStatusResponse`
distingue `unlinked` de `invalid` (revocada o vencida) y devuelve `account` (email de MP vía
`/users/me`) también en `invalid`. `MP_CONNECT_RETURN_URL` (`movo://mp-connect`) es el deep link al
que redirige el callback público. Cinco `ApiErrorCode` nuevos (`MP_CONNECT_*`,
`MP_ACCOUNT_ALREADY_LINKED`): cuatro de ellos viajan en ese deep link, no como respuesta HTTP.

### MOVO-116 — `ApiError.details`, requisitos del transportista y códigos nuevos (ADR-036)

`ApiError` gana un 4.º parámetro opcional `details` (`ApiErrorDetails`), que `toJSON()` incluye
solo si viene: primer error con datos extra para el cliente, compatible hacia atrás.
`types/carrier-eligibility.ts`: `CarrierRequirement` (`"license" | "mp_account"`),
`CarrierRequirementsErrorDetails` y las respuestas de los dos endpoints internos nuevos.
Códigos nuevos: `CARRIER_LICENSE_NOT_APPROVED`, `PAYMENTS_SERVICE_UNAVAILABLE`,
`OFFER_CARRIER_NOT_ELIGIBLE`; `CARRIER_MP_ACCOUNT_NOT_LINKED` (MOVO-209) se reusa, ahora también
como 403 de `svc-shipments`. Mobile todavía no lee `details` (`parseErrorBody` lo descarta): es
parte de MOVO-117.
