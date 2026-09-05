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
