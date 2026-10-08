# CLAUDE.md — services/movo-svc-payments

Estado de implementación de `movo-svc-payments`. Ver el `CLAUDE.md` de la raíz del
repo para contexto general del proyecto (stack, ADRs, convenciones, git/PR). Entrada
corta por US: qué se hizo, en qué archivos, decisiones no obvias, qué queda pendiente.

Diseño del flujo de pagos y orden de los tickets: `docs/payments/flujo-de-pagos.md`.
Evidencia del sandbox de Mercado Pago (requests reales, cuentas, SDK vs REST):
`docs/payments/mercadopago-spike/SOLUCION-FINAL.md`.

## Estado actual de la implementación

### MOVO-267 — Setup base del servicio (Prisma, cliente de MP, env vars, gateway)

Base sobre la que construyen MOVO-111 (OAuth), MOVO-209 (hold), MOVO-212 (captura) y
MOVO-268 (webhook), sin endpoints de dominio.

- **Prisma (ADR-011)** con schema `payments` y sin modelos todavía: la única migración
  (`20261008120000_create_payments_schema`) crea el schema. `migrations/0001_init.sql`
  (un `SELECT 1`) se borró sin baselinear: no había nada que conservar. El deploy y
  `pr-checks.yml` migran este servicio con `prisma migrate deploy`, ya no con
  `run-migrations.sh`; la fila vieja de `public.schema_migrations` en dev/prod queda
  inerte. Plugin de DB y Dockerfile copiados de `svc-shipments`.
- **`src/adapters/mercadopago-client.ts`**: interfaz `MercadoPagoClient` (inyectable con
  `buildApp({ mercadoPagoClient })`) sobre el SDK `mercadopago` 3.4.0, la versión con la
  que se verificó el spike. Cada método recibe el access_token del transportista, y las
  escrituras exigen `idempotencyKey` (si falta, el SDK inventa una por llamada y un
  reintento duplicaría el hold o la captura). Arma un `Payment` nuevo por llamada porque
  el SDK guarda los `requestOptions` en `config.options`, y reusarlo arrastraría la key
  a la llamada siguiente. Timeout de 10s (el default real del SDK es 60s). El canje y el
  refresh de OAuth quedan fuera: van con `fetch` propio en MOVO-111/243.
- **Env vars**: `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_REDIRECT_URI`,
  `MP_WEBHOOK_SECRET` (opcionales, el servicio levanta sin ellas) y `MP_TEST_MODE`
  (`:-false` en compose). No hay access token de la app: el canje de OAuth no lo usa
  y los pagos van con el token de cada transportista. Reemplazan a
  `MERCADOPAGO_ACCESS_TOKEN`, que se sacó de compose.
- **Logger con redacción** (`src/config/logger.ts`, pino `redact`): tokens OAuth,
  `client_secret`, `code_verifier` y datos de tarjeta, en el nivel raíz y hasta 3
  niveles de anidamiento, más `req.headers.authorization`.
- **`.env` local**: `@fastify/env` lo lee solo hacia `app.config`, pero los plugins de
  auth, DB y Redis leen `process.env`, así que `npm run dev` corre con
  `--env-file-if-exists=.env` (sin eso, `missing secret` al arrancar). Solo afecta a
  desarrollo: en dev/prod compose inyecta las variables. Las variables `MP_APP_*` del
  spike no son las del servicio y no van en este `.env`.
- **Gateway**: `/payments` proxeado para `sender`/`carrier`. El callback de OAuth y el
  webhook se suman a `getPublicRoutes()` en MOVO-111/268.

Pendiente: cargar las 5 `MP_*` en Secrets Manager de dev (app sandbox `movosend`) y
prod, borrar `MERCADOPAGO_ACCESS_TOKEN` de esos secrets, y verificar en la EC2 que el
contenedor arranca con los valores reales (DoD del ticket).

### MOVO-111 — OAuth Connect: vincular, consultar y desvincular la cuenta de MP

`GET /payments/mp-connect/status`, `GET /payments/mp-connect/authorization-url`,
`DELETE /payments/mp-connect` (protegidas, heredan el hook `x-user-id`) y
`GET /payments/mp-connect/callback` (pública, plugin aparte en `app.ts`). Contrato en
`@movo/shared` (`types/mp-connect.ts`), acordado con mobile (MOVO-112). Código en
`src/modules/mp-connect/`, `src/adapters/mercadopago-oauth-client.ts` y
`src/repositories/carrier-mp-account-repository.ts`.

- **Callback `https` + 302 a `movo://mp-connect` (AC3)**, en vez de un `redirect_uri` con
  esquema custom: el canje necesita el `client_secret`. El callback nunca tira: siempre
  redirige, con `result=success` o con `result=error&code=` (`MP_CONNECT_STATE_INVALID`,
  `_ACCESS_DENIED`, `_EXCHANGE_FAILED`, `MP_ACCOUNT_ALREADY_LINKED`). La app no confía en
  `success` y vuelve a pedir el status. El `state` (con el `code_verifier` de PKCE) vive 10
  min en Redis y se consume con `GETDEL`. El query del callback no se loguea (serializer
  de `req` en `config/logger.ts`).
- **Canje con `fetch` propio** (SOLUCION-FINAL §4), sin `Authorization`, con
  `test_token` según `MP_TEST_MODE`. En modo test, un token sin prefijo `TEST-` se toma
  como canje fallido. Después del canje se llama a `GET /users/me` para el email y el
  nickname que muestra la app.
- **`carrier_mp_accounts`**: una fila por usuario. Desvincular es soft (`unlinked_at`,
  tokens en null) y el status vuelve a `unlinked`, no a `invalid`. Re-vincular hace
  upsert y limpia `unlinked_at`/`revoked_at`. `invalid` = `revoked_at` (lo marca
  MOVO-243) o `token_expires_at` pasado.
- **Una cuenta de MP por usuario de Movo**: índice único parcial sobre `mp_user_id`
  (`WHERE revoked_at IS NULL AND unlinked_at IS NULL`), a mano en la migración. Ante un
  P2002 se mira la base para distinguirlo de una carrera sobre `user_id`, porque la forma
  del error cambia con el driver adapter. Caso aceptado: una fila vencida y no revocada
  sigue bloqueando hasta que MOVO-243 la marque.
- Sin chequeo de rol `carrier`: el gateway exige sender o carrier, y toda cuenta nace con
  los dos roles.

Pendiente: la DoD contra el sandbox real (vincular con la cuenta Vendedor, rechazar,
desvincular) y confirmar que MP acepta `scope=offline_access` en la URL y devuelve el
`refresh_token` (el spike no mandaba `scope`). Registrar
`https://api-dev.movosend.app/api/v1/payments/mp-connect/callback` como `MP_REDIRECT_URI`
en el secret de dev y en el panel de la app `movosend`. El gateway sigue logueando la URL
completa del callback (logger default): el `code` no sirve sin el `code_verifier`, que
nunca sale de Redis.
