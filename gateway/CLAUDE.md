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
