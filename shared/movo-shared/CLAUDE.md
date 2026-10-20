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
número en vez de duplicarlo (`svc-payments` ya lo usa para el `application_fee` del
hold, MOVO-209). `mpTransactionFeeRate` no se descuenta en el backend: MP cobra su
comisión real y la informa en `fee_details`. `MOVO_COMMISSION_RATE` confirmado en 15%;
`MP_TRANSACTION_FEE_RATE` es un estimado para mostrar, no un valor contractual
(MOVO-225: MP cobra según la cuenta de cada transportista, ver `CLAUDE.md` raíz).
MOVO-225 suma `estimateMpFeeArs`/`estimateReceivedArs` (lo que mobile muestra como
"Recibís aprox.") y `parseRate`, que cae al default si una tasa no es numérica, así
un typo en la env var no termina en `$NaN`.

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
(cancelado/completado). Ver `services/movo-svc-shipments/HISTORIAL.md` (entrada de
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
`services/movo-svc-shipments/HISTORIAL.md`, MOVO-192, sección de pendientes). El mobile
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
`services/movo-svc-shipments/HISTORIAL.md` para la decisión completa). `RatingRole`
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
estados, conforme obliga el AC6 de MOVO-79. Ver `services/movo-svc-shipments/HISTORIAL.md`
(entrada de MOVO-208) para el detalle completo y ADR-021 (`CLAUDE.md` raíz) para el
razonamiento.

### MOVO-221 — `TripStatus` gana `declared`; `TRIP_NOT_DECLARED`/`TRIP_ALREADY_HAS_ACTIVE_TRIP`/`TRIP_NOT_AVAILABLE`

`src/types/trip.ts` — `TripStatus.DECLARED` insertado antes de `ACTIVE`: pasa a ser el
estado inicial real de un viaje declarado (`declared -> active -> completed`, un viaje
ya no nace directo en `active`). Tres códigos nuevos en `ApiErrorCode`
(`errors/api-error.ts`) para el endpoint `POST /trips/:id/start` y el chequeo ampliado
de `tripId` en `POST /shipments/:id/offers` — `TRIP_NOT_ACTIVE` (MOVO-162) queda sin
uso pero nunca se elimina (contrato de wire). Detalle completo en
`services/movo-svc-shipments/HISTORIAL.md` (entrada de MOVO-221).

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

### MOVO-212 — Contrato de la liquidación (`types/settlement.ts`)

`SettlementStatus`/`SettlementFailureReason`/`SettlementResponse`/`CaptureHoldResponse` para los endpoints
internos de captura de `svc-payments`, y los códigos `HOLD_NOT_CAPTURABLE`/`SETTLEMENT_NOT_FOUND`.
`mpFeeArs` y `netAmountArs` son `null` hasta que MP confirma la captura. `escalated` está reservado para
MOVO-213 (212 nunca lo escribe). Recordatorio: `npm run build` acá antes de tipar desde otro workspace.
### MOVO-116 — `ApiError.details`, requisitos del transportista y códigos nuevos (ADR-036)

`ApiError` gana un 4.º parámetro opcional `details` (`ApiErrorDetails`), que `toJSON()` incluye
solo si viene: primer error con datos extra para el cliente, compatible hacia atrás.
`types/carrier-eligibility.ts`: `CarrierRequirement` (`"license" | "mp_account"`),
`CarrierRequirementsErrorDetails` y las respuestas de los dos endpoints internos nuevos.
Códigos nuevos: `CARRIER_LICENSE_NOT_APPROVED`, `PAYMENTS_SERVICE_UNAVAILABLE`,
`OFFER_CARRIER_NOT_ELIGIBLE`; `CARRIER_MP_ACCOUNT_NOT_LINKED` (MOVO-209) se reusa, ahora también
como 403 de `svc-shipments`. Mobile ya lee `details` (`parseErrorBody`, MOVO-117).

### MOVO-210 — Contrato de la saga de asignación y `OfferStatus.ASSIGNMENT_LAPSED`

`types/funding.ts` (`FundingRoute`, `ShipmentFundingResponse`/`Request`/`Result`, `HoldProviderEventRequest`:
`GET`/`POST /shipments/:id/funding` y el aviso interno de holds). `OfferStatus.ASSIGNMENT_LAPSED`: la oferta fue
aceptada pero la asignación no prosperó (no es un rechazo). `ApiErrorCode` suma `SHIPMENT_FUNDING_NOT_AVAILABLE`
(`PAYMENTS_SERVICE_UNAVAILABLE` ya lo había agregado MOVO-116). `config/notification-templates.ts` suma los triggers `funding*` (emisor en
`payments`, que pasa a `implemented: true`; transportista en `offers`), incluido el copy de reconfirmación
("La reserva de tu pago expiró"). Recordatorio habitual: `npm run build` acá antes de tipar desde otro workspace.

### MOVO-275 — Transferencia de receptor (ADR-038)

`types/receiver-transfer.ts`: `ReceiverTransferStatus`/`RECEIVER_TRANSFER_STATUSES`,
`RECEIVER_TRANSFER_ALLOWED_SHIPMENT_STATUSES` (published → in_transit, la usan backend y
mobile), `ReceiverTransferRequest`, `ReceiverTransferInvitation` y
`ShipmentReceiverTransferSummary`. Siete códigos nuevos (`SHIPMENT_RECEIVER_TRANSFER_*`,
`RECEIVER_TRANSFER_NOT_FOUND`/`_NOT_PENDING`) y diez triggers `receiverTransfer*` en la
categoría `shipments`, con copy propio por destinatario.

### MOVO-26 — Contrato del chat (ADR-040)

`types/chat.ts`: `ChatMessage` (con `authorName`, `moderated`, `hidden` por bloqueo y `deliveryStatus` en los
propios), `ChatMessagesPage` (`access`, `archived`, `reportedByMe`), `ChatParticipant(s)`, `ChatListItem`/
`ChatListResponse`, `ChatRealtimeEvent` (`chat_message` y `chat_receipt`), `ChatAccess` y las constantes
`CHAT_MESSAGE_MAX_LENGTH` (1000), `CHAT_POST_DELIVERY_WINDOW_HOURS` (24, pasado ese plazo se archiva) y
`CHAT_PAGE_MAX_LIMIT`, más `CHAT_MODERATION_WARNING` (el aviso de respeto que muestran los clientes cuando el filtro
de lenguaje tapó palabras de un mensaje propio). `ApiErrorCode` suma `CHAT_CLOSED` y `CHAT_READ_ONLY`; el trigger
`chatMessageReceived` va en la categoría `chat`, que pasa a `implemented: true`.
### MOVO-240 — Triggers de recordatorio de viaje y proximidad

`config/notification-templates.ts` suma `tripDepartureReminder` (categoría `trips`), con un copy
que cambia según `packagesCount` (con paquetes invita a sumar uno más, sin paquetes a buscar),
y `carrierNearPickup`/`carrierNearDelivery` (categoría `proximity`). En
`notification-categories.ts`, `proximity` pasa a `implemented: true` y `quietHoursExempt: true`:
el aviso de "está por llegar" sirve justo cuando llega, sea la hora que sea. Tests en
`test/notification-templates.test.ts`.
### MOVO-268 — Códigos del webhook de Mercado Pago

`ApiErrorCode` suma `PAYMENT_WEBHOOK_INVALID_SIGNATURE` (401, `x-signature` ausente o
inválida) y `PAYMENT_WEBHOOK_NOT_CONFIGURED` (503, falta `MP_WEBHOOK_SECRET`). Los consume
solo MP, no la app. `HoldProviderEventRequest` (MOVO-210) no cambia: "vencido" sigue siendo
`event: expired`.

### MOVO-282 — Hold con tarjeta guardada: `payerUserId` y `savedCardId`

`CreateHoldRequest` (`types/hold.ts`) suma `payerUserId` (requerido: el emisor, dueño de la tarjeta) y
`savedCardId?` (id interno de `payments.saved_cards`); `ShipmentFundingRequest` (`types/funding.ts`) suma
`savedCardId?`. `HoldResponse` no cambia: no expone ids de MP ni de la tarjeta. Cambio compatible hacia atrás
salvo por `payerUserId`, que `svc-shipments` siempre manda. `npm run build` acá antes de tipar desde otro
workspace.

### MOVO-100 — Contrato de las tarjetas guardadas (`types/saved-card.ts`)

`SavedCard` (con `mpCardId` y `alias`), `CreateSavedCardRequest`, `UpdateSavedCardRequest`,
`CardsCheckoutDataResponse` y las constantes `MAX_SAVED_CARDS_PER_USER` (10) y
`SAVED_CARD_ALIAS_MAX_LENGTH` (40). Wire contract de `/payments/cards` (`svc-payments`), para
MOVO-101/269 en mobile. `ApiErrorCode` suma `CARD_IN_USE`, `CARD_LIMIT_REACHED`, `CARD_SAVE_REJECTED`
(422, `details.providerCode`), `CARD_CUSTOMER_CONFLICT` (409, el customer de MP del email ya es
de otra cuenta) y `CARDS_NOT_CONFIGURED`. Recordatorio habitual: `npm run build` acá antes
de tipar desde otro workspace.

### MOVO-287 — TTL configurable del access token y constantes de la sesión de panel

`signAccessToken(payload, { expiresInSeconds })` (default de 60 min sin cambios) y
`PANEL_ACCESS_TOKEN_TTL_SECONDS` (15 min) / `PANEL_SESSION_TTL_SECONDS` (8 h), compartidas
entre `svc-users`, que emite la sesión de panel, y el TTL de su marca de revocación.
Review de PR #244: también se exporta `ACCESS_TOKEN_TTL_SECONDS` (60 min, la app), así el TTL no
vive en tres lugares, y el payload/claims suman `session?: "panel"`. El gateway solo respeta el
rol `admin` en un token con ese claim (antes lo deducía del rol).

### MOVO-276 — `package_tapered_v2` y `PACKAGE_LIMITS_EXCEEDED` (ADR-041)

`PriceCalculationMethod.PACKAGE_TAPERED_V2` (`DEMAND_FUEL_ROUTES_V1` queda, ya no se emite
pero persiste en envíos viejos), `QuoteBreakdown.volumetricWeightKg?`/`billableWeightKg?`
(ausentes en respuestas de v1) y el código `PACKAGE_LIMITS_EXCEEDED` (422, con
`details.violations`).

### MOVO-265 — `config/trip-recurrence.ts` (ADR-042)

`RECURRENCE_WEEKDAY` (0 = domingo … 6 = sábado), `MAX_ACTIVE_RECURRING_SERIES` (3),
`argentinaWeekday`, `formatArgentinaShortDay` ("vie 10/10") y `nextRecurrenceOccurrence` (próximo
día elegido estrictamente posterior a `max(departureAt, now)`, a la misma hora de pared en huso
argentino, `null` si se pasa de `recurrenceUntil`). Va en shared para que el preview de MOVO-266
use la misma cuenta que el barrido. Suma los códigos `RECURRING_SERIES_LIMIT`/`TRIP_NOT_SERIES_HEAD`,
los triggers `tripRecurrence{Generated,StoppedPhantom,StoppedUnavailable}` (categoría `trips`, que
ya existía, en vez de una nueva) y `accountStatus?`/`bannedUntil?` en `CarrierKycStatusResponse`.

### MOVO-290 — `AdminSummary` y códigos de alta y baja del rol admin

`AdminSummary` (`types/user.ts`): fila de `GET /internal/admins` de `svc-users`, que va a consumir
`svc-admin` (MOVO-292), con `status` de la cuenta para distinguir admins suspendidos. `ApiErrorCode` suma `ADMIN_GRANT_EMAIL_NOT_VERIFIED` y
`ADMIN_GRANT_ACCOUNT_NOT_ACTIVE` (422), `ADMIN_NOT_FOUND` (404), `ADMIN_LAST_ADMIN` (409) y `ADMIN_GRANT_CONFLICT` (409).

### MOVO-288 — Bitácora de admin y conflicto de interés

`types/admin.ts`: `AuditLogEntry`/`AuditLogPage` (`GET /admin/audit-log` de `svc-admin`),
`AuditOutcome`, `AdminTargetType` y las partes de un objetivo que exponen los servicios dueños
para la regla de conflicto (`ShipmentParties`, `ChatReportParties` de `svc-shipments`,
`UserReportParties` de `svc-users`). `ApiErrorCode` suma `ADMIN_CONFLICT_OF_INTEREST` (403).

### MOVO-278 — `transitAnomalyFlaggedAt`, requisito `no_open_dispute` y pushes de la disputa automática (ADR-045)

`ActiveShipmentSummary` suma `transitAnomalyFlaggedAt: string | null`. `CarrierRequirement` suma
`"no_open_dispute"` (primero en el orden) y `ApiErrorCode` suma `CARRIER_DISPUTE_OPEN`. Triggers
nuevos en `notification-templates.ts` (categoría `shipments`): `transitAnomalyDisputeWarning` (aviso
previo al transportista) y `transitAnomalyDisputeOpened{Sender,Receiver,Carrier}`.

### MOVO-303 — Contrato del historial de transacciones (`types/transaction.ts`)

`TransactionStatus` (`reserved`/`completed`/`refunded`/`disputed`/`released`), `TransactionRole`,
`TransactionListItem`/`TransactionListResponse`, `TransactionDetail` (con `movements` y `breakdown?`),
`TransactionMovement`, `TransactionBreakdown`, `TransactionCard` y las constantes `TRANSACTIONS_DEFAULT_LIMIT`
(20) / `TRANSACTIONS_MAX_LIMIT` (50). Wire contract de `GET /payments/transactions[/:id]` (`svc-payments`),
para la sub-issue mobile de MOVO-28. `card` y `breakdown` son opcionales: ausentes según el rol, no `null`.
Recordatorio habitual: `npm run build` acá antes de tipar desde otro workspace.

### MOVO-309 — Contrato de la cuenta corriente (`types/user-ledger.ts`, ADR-044)

`USER_LEDGER_ENTRY_TYPES`/`_STATUSES`/`_ROLES`, `UserLedgerEntry`, `UserLedgerBalanceResponse`,
`UserLedgerPageResponse`, `CreateUserLedgerEntryRequest`/`Response` y `CreateManualAdjustmentRequest`. Montos
`number` con 2 decimales y con signo (positivo = debe). `ApiErrorCode` suma `LEDGER_IDEMPOTENCY_CONFLICT`,
`LEDGER_ENTRY_NOT_FOUND` y `LEDGER_ENTRY_STATE_CONFLICT`. Recordatorio habitual: `npm run build` acá antes de
tipar desde otro workspace.

### MOVO-312 — "Pagar mi saldo" (`types/user-ledger.ts`)

`BalancePayDataResponse` (`{ publicKey, balanceArs }`), `BalancePayRequest` (`{ amountArs, cardToken, savedCardId, paymentMethodId? }`) y
`BalancePayResponse` (`{ attemptId, status, failureReason, balanceArs }`). `ApiErrorCode` suma `BALANCE_AMOUNT_EXCEEDS_DEBT` (422),
`BALANCE_PAYMENT_IN_PROGRESS` (409) y `BALANCE_COLLECTOR_NOT_CONFIGURED` (503). Recordatorio habitual: `npm run build` acá antes de tipar
desde otro workspace.

### MOVO-313 — `no_overdue_debt` y `USER_DEBT_OVERDUE`

`CarrierRequirement` (`types/carrier-eligibility.ts`) suma `"no_overdue_debt"` y `ApiErrorCode` suma
`USER_DEBT_OVERDUE` (403 de `svc-shipments` al declarar viaje, ofertar, editar oferta o iniciar viaje con una deuda de la
cuenta corriente sin saldar hace más de `USER_DEBT_OVERDUE_DAYS`). Viaja con `details.missingRequirements` y va al
final del orden. También el trigger `tripRecurrenceBlockedByDebt` (categoría `trips`) para el aviso de una ocurrencia
recurrente frenada por la deuda. Cambio aditivo: un cliente anterior que no conozca el valor lo ignora al filtrar por la checklist.
Recordatorio habitual: `npm run build` acá antes de tipar desde otro workspace.


### MOVO-311 — Deuda cobrada en el hold (`types/hold.ts`, `funding.ts`, `settlement.ts`, `user-ledger.ts`, `transaction.ts`)

`HoldDebtBreakdown` (`baseAmountArs`, `debtOffsetArs`, `debtSurchargeArs`) en `HoldCheckoutDataResponse` y `HoldResponse`
(que además suma `commissionArs`); `HoldCheckoutDataRequest.payerUserId?`. `ShipmentFundingResponse` suma `priceArs`,
`pendingBalanceArs` y `totalArs`; `SettlementResponse` suma `debtOffsetArs`/`debtSurchargeArs` y
`ShipmentSettlementResponse` suma `debtCollectedArs`; `TransactionBreakdown` suma `debtOffsetArs`. Nuevos:
`DebtCollectionPreviewRequest`/`Response`, `CarrierDebtDiscount`, `SettlementResponse.carrierGrossAmountArs`/`carrierMpFeeArs` (el cobro del
transportista sin el recargo del emisor, fijado al acreditar con `carrierPaymentView` de `config/commission.ts`, que solo llama el
`capture.service` de payments) y `expectedTotalArs?` en `CreateHoldRequest`/`ShipmentFundingRequest` + código `HOLD_AMOUNT_CHANGED` (409,
`details.totalArs`). `amountArs` del hold y del funding pasa a ser lo que paga el emisor (precio + recargo). Recordatorio habitual: `npm run build` acá antes de tipar desde otro workspace.

### MOVO-306 — `SettlementKind` y body de la captura

`types/settlement.ts` suma `SETTLEMENT_KINDS`/`SettlementKind` (`delivery` | `cancellation_penalty`),
`SettlementResponse.kind` y `CaptureHoldRequest` (`kind?`, `amountArs?`: la penalidad lo exige, la entrega no
lo acepta). `grossAmountArs` es lo capturado (el hold entero en una entrega). Errores nuevos:
`SETTLEMENT_CONFLICT`, `CAPTURE_AMOUNT_EXCEEDS_HOLD` y `CAPTURE_BELOW_APPLICATION_FEE` (la penalidad no supera
la comisión: MP la rechazaría, spike MOVO-305, y `svc-shipments` aplica el plan B de MOVO-307).

### MOVO-307 — `config/cancellation-penalty.ts` y triggers de la penalidad (ADR-047)

`CANCELLATION_PENALTY_FREE_HOURS` (12), `CANCELLATION_PENALTY_RATE` (0,25) y `computeCancellationPenalty` (pura:
sin cargo con 12 h o más o con la ventana cerrada, 25 % del precio acordado si no; solo `assigned`), más
`CancellationQuoteResponse` de `GET /shipments/:id/cancellation-quote`. Mobile la importa por subpath
(`dist/config/cancellation-penalty`) para mostrar el mismo monto (MOVO-308). `ShipmentSettlementResponse` suma `kind`,
`ApiErrorCode` suma `CANCELLATION_PENALTY_MISMATCH` (con `details.penaltyArs`) y la categoría `payments` suma
`cancellationPenalty{ChargedSender,DebtSender,CompensationCarrier}`.

### MOVO-310 — `OfferStatus.CARRIER_WITHDRAWN` y pushes de la baja del transportista

`types/offer.ts` suma `carrier_withdrawn` (el transportista asignado se bajó; distinto de `withdrawn` y de
`assignment_lapsed`). Triggers nuevos: `carrierWithdrewSender` (`shipments`, con el nombre del snapshot de la oferta) y
`carrierWithdrawalPenaltyDebtCarrier` (`payments`). MOVO-314: el copy de `carrierWithdrewSender` pasa a "Tu envío vuelve a estar publicado" (título del prototipo), manteniendo el aviso de que puede cancelarlo sin cargo. `computeCarrierWithdrawalPenalty`: los mismos tramos que
`computeCancellationPenalty` pero desde cualquier estado con transportista (su penalidad es deuda, no depende del hold)
y cobrando también con la ventana ya cerrada; `penaltyArs > 0` siempre viaja con `late_cancellation`.

### MOVO-303 (ampliación) — `TransactionKind` y `debtAmountArs`

`types/transaction.ts` suma `TRANSACTION_KINDS`/`TransactionKind` (`shipment` | `balance_payment`); `TransactionListItem` gana `kind`,
`debtAmountArs` y `shipmentId` pasa a ser `string | null` (nulo en un pago de saldo). Rompe literales `TransactionListItem` armados a mano
(fixtures de `movo-mobile`). Recordatorio habitual: `npm run build` acá antes de tipar desde otro workspace.

### MOVO-303 (ampliación) — `TransactionCard` extendida y `releasedAt`/`releaseReason`

`TransactionCard` gana `alias`/`issuerName`/`paymentType` (opcionales) y `TransactionDetail` gana `releasedAt`/`releaseReason`
(obligatorios, `null` si no se liberó; `TRANSACTION_RELEASE_REASONS`). Rompe literales `TransactionDetail` armados a mano.

### MOVO-294/295 — Acciones de soporte sobre la cuenta (`types/admin-users.ts`)

`AdminSessionsRevokeBody/Result`, `AdminContactUpdateBody/Result` (`expectedCurrent` + `field`), `AdminLedgerAdjustmentBody/Result`,
`AdminUserNote`/`AdminUserNotePage`/`AdminUserNoteBody` y las constantes `ADMIN_NOTE_MAX_LENGTH` (1000) y
`ADMIN_ACTION_REASON_MAX_LENGTH` (500). `ApiErrorCode` suma `CONTACT_CHANGED` (409), `CONTACT_UNCHANGED` (400), `USER_DELETED` (409) y
`AMOUNT_OUT_OF_RANGE` (422); el panel reusa `EMAIL_ALREADY_IN_USE`/`PHONE_ALREADY_IN_USE` y `LEDGER_IDEMPOTENCY_CONFLICT`.
Recordatorio habitual: `npm run build` acá antes de tipar desde otro workspace.

