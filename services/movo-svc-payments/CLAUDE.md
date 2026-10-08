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
