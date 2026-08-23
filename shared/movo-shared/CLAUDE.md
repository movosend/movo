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

### MOVO-82 — `QuoteRequest`/`QuoteResponse`/`PriceCalculationMethod`

`src/types/pricing.ts` — wire contract de `POST /quote`
(`movo-svc-pricing-logistics`, primer endpoint de negocio de ese servicio), consumido
por `movo-svc-shipments/src/adapters/pricing-client.ts` y a futuro por el wizard de
creación de envío del mobile (MOVO-83). `PriceCalculationMethod` (hoy solo
`EUCLIDEAN_LINEAR_V1`) identifica la versión del algoritmo que calculó el precio —
reemplazar la implementación provisoria por el motor real no requiere migrar este
contrato, solo agregar un valor nuevo al enum.
