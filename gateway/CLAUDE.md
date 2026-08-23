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
