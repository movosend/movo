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

### MOVO-82 — `QuoteRequest`/`QuoteResponse`/`PriceCalculationMethod`

`src/types/pricing.ts` — wire contract de `POST /quote`
(`movo-svc-pricing-logistics`, primer endpoint de negocio de ese servicio), consumido
por `movo-svc-shipments/src/adapters/pricing-client.ts` y a futuro por el wizard de
creación de envío del mobile (MOVO-83). `PriceCalculationMethod` (hoy solo
`EUCLIDEAN_LINEAR_V1`) identifica la versión del algoritmo que calculó el precio —
reemplazar la implementación provisoria por el motor real no requiere migrar este
contrato, solo agregar un valor nuevo al enum.
