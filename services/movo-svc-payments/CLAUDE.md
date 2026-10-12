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
  de `req` en `config/logger.ts`, y el mismo en el gateway). Ni un Redis caído ni un query
  que no matchea el schema (`?state=a&state=b`) pueden responder JSON: todo termina en el
  deep link (`attachValidation` en la ruta, todo `handleCallback` dentro del `try`).
- **Canje con `fetch` propio** (SOLUCION-FINAL §4), sin `Authorization`, con
  `test_token` según `MP_TEST_MODE`. En modo test, un token sin prefijo `TEST-` se toma
  como canje fallido. Después del canje se llama a `GET /users/me` para el email y el
  nickname que muestra la app, best-effort: si falla, se vincula igual con `null`
  (el code ya se gastó y son datos de display).
- **Tokens cifrados en reposo** (`src/utils/token-cipher.ts`): `access_token` y
  `refresh_token` con AES-256-GCM, formato `v1:<iv>:<tag>:<ciphertext>` (el prefijo deja
  lugar a rotar la key). La key es `MP_TOKEN_ENCRYPTION_KEY` (base64 de 32 bytes, una por
  ambiente, en Secrets Manager); sin ella, `/authorization-url` responde 503. La
  `public_key` va en claro: es pública por diseño. Quien opere con MP (MOVO-209/212/243)
  lee los tokens con `repository.findCredentials()`, nunca de la fila directo. Si la key
  se pierde, los tokens no se recuperan y hay que re-vincular.
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

Verificado contra el sandbox (08/10, túnel local, cuenta Vendedor `2991764998`): la
vinculación llega a `linked` con token `TEST-`, `refresh_token`, `public_key` y email
de `/users/me`. MP acepta `scope=offline_access` en la URL (vuelve en el `scope`).
Refresh manual (`grant_type=refresh_token` + `test_token`) sobre el token recién emitido:
200, `refresh_token` nuevo (rota) pero el **mismo `access_token`**, con otros 180 días.
MOVO-243 tiene que guardar los dos igual. Rechazar en MP y desvincular también se
probaron contra el sandbox.

Pendiente: registrar
`https://api-dev.movosend.app/api/v1/payments/mp-connect/callback` como `MP_REDIRECT_URI`
en el secret de dev y en el panel de la app `movosend`, y cargar
`MP_TOKEN_ENCRYPTION_KEY` en los secrets de dev y prod.

### MOVO-209 — Hold (Auth & Capture): crear, consultar y liberar la reserva de un envío

Endpoints **internos** que consume `svc-shipments` (dueño de la saga, MOVO-210), bajo
`/internal/payments/holds/*`: sin ruta en el gateway y sin el hook de `x-user-id` (el
caller es un servicio, ADR-010). `POST /checkout-data` (AC1), `POST /` (crear),
`GET /by-shipment/:shipmentId[?sync=true]` y `POST /by-shipment/:shipmentId/release`.
Contrato en `@movo/shared` (`types/hold.ts`). Código en `src/modules/holds/`,
`src/repositories/hold-repository.ts` y `src/plugins/holds.ts`. Arquitectura de cobro:
ADR-035.

- **`payments.holds`: una fila por intento** (`shipment_id` + `attempt`). La key de MP es
  `movo-hold-<shipmentId>-<attempt>`. Un hold vivo se devuelve tal cual (200, sin llamar a
  MP **ni exigir la cuenta vinculada**: el transportista pudo desvincularse después). Un
  intento en `creating` (MP no respondió) se reintenta con la MISMA key solo si el cuerpo
  coincide (`request_fingerprint`, un hash: nunca el token); si cambió la tarjeta, el
  pagador, el monto o el transportista, primero se busca el pago en MP por
  `external_reference` (el id del envío): si existe se lo adopta, si no se cierra el
  intento viejo (`superseded`) y se abre otro con otra key. Índice único **parcial** `ON
  (shipment_id) WHERE status IN ('creating','in_process','authorized','captured')`, a mano
  en la migración: un solo hold vivo por envío aunque el código falle. La partición
  vivo/cerrado vive en `@movo/shared` (`LIVE_HOLD_STATUSES`/`CLOSED_HOLD_STATUSES`) y un
  test de integración verifica que el predicado del índice liste exactamente esos estados.
- **Un rechazo de la tarjeta no es un error HTTP**: `POST /` responde 201 con
  `status: rejected` + `failureReason` (`insufficient_funds`, `card_rejected`,
  `invalid_data`, `platform_error`, AC5) y el emisor reintenta con otra tarjeta. **Solo un
  400/422 con una causa que reconocemos** (token inválido 2006/3001/3003, cuentas
  2034/2059) cierra el intento como `rejected`: prueba que MP no creó el pago. Un 401/403
  es del token del transportista (409 `CARRIER_MP_ACCOUNT_NOT_LINKED`, el intento sigue en
  `creating`); 408/409/429/5xx/red/4xx desconocido son 502 `PAYMENT_PROVIDER_ERROR` y
  también dejan `creating`, porque MP pudo haber creado el pago.
- **Un estado de pago de MP que no conocemos** (`refunded`, `charged_back`, `in_mediation`)
  se loguea y deja el hold sin cambios: convertirlo en `rejected` lo sacaría del índice de
  vivos y habilitaría una segunda reserva sobre fondos que siguen retenidos. Liberar solo
  responde 200 si MP confirma `cancelled`.
- **`application_fee`** = `decomposeOfferGrossPrice(monto).commissionAmountArs`: el monto
  es el bruto del emisor y Movo cobra su % sobre el neto del transportista (no el 15% del
  bruto). `expires_at` = creación + `MP_HOLD_VALIDITY_DAYS` (config, default 5
  **provisorio**: mínimo de lo que documenta MP hasta que cierre MOVO-215).
- **`checkout-data` recibe monto y email del emisor y los devuelve**: `svc-payments` no
  conoce envíos ni usuarios (ADR-003/019), así que `svc-shipments` los manda; el valor que
  agrega es la `public_key`, la comisión y el 409 `CARRIER_MP_ACCOUNT_NOT_LINKED` si la
  cuenta no está `linked` (desvinculada, revocada o token vencido).
- **Liberar es idempotente**: ya cancelado o `rejected` devuelve el hold; `captured` →
  409 `HOLD_NOT_RELEASABLE` (eso es un reembolso). Un `creating` se reconcilia primero
  contra MP: si el pago existe se adopta y se cancela; si no existe y el intento tiene más
  de 10 minutos se da por abandonado (`rejected`/`abandoned`); si es reciente, 409. Si la
  cancelación falla pero MP ya lo tenía cancelado, se da por liberado.
- **Limitación conocida de la liberación:** MP solo deja cancelar al cobrador, así que
  hace falta el access_token del transportista. Si desvinculó (se borran los tokens, MOVO-111)
  o MP los revocó, `release` responde 409 `CARRIER_MP_ACCOUNT_NOT_LINKED`, lo deja
  logueado con el `holdId` y el hold vence solo en MP (~5-7 días), con los fondos del
  emisor retenidos y sin poder abrir otro hold para el envío en el medio. Decisión
  pendiente (no implementada): impedir la desvinculación mientras haya holds vivos del
  transportista, o ampliar MOVO-243/268.
- **`?sync=true`** consulta el pago a MP y actualiza la fila. Desde MOVO-268 el webhook
  refleja solo lo que MP cambia por su cuenta; `sync` sigue sirviendo para el barrido de
  la saga de shipments y para resolver un `creating`.
- **Logs (AC9)**: se loguean ids, estado y montos; nunca el `card_token`, el email del
  pagador ni los tokens OAuth (el test lo verifica además del `redact` del logger).
- **`payment_method_id` es opcional** en el request: se reenvía a MP si el mobile lo manda
  (lo devuelve el formulario de MP junto al token). Contrato a confirmar con MOVO-210/269.
- **Tests**: `fileParallelism: false` en `vitest.config.ts`, porque los tests de
  integración de mp-connect y holds truncan `carrier_mp_accounts` sobre la misma base.

**Sandbox (AC10):** el pagador tiene que ser una cuenta de prueba **Comprador** y
`payerEmail` su email real (con uno inventado MP crea un invitado y responde 2034); el
vendedor y el dueño de la app también de prueba. Documentado en `.env.example`.

Verificado contra el sandbox real (10/10, cuenta Vendedor y comprador de prueba del
equipo; los ids no se versionan, ver el archivo de credenciales fuera del repo):
`test/holds.sandbox.test.ts` crea un hold de $1150 con `application_fee` 150 (`authorized`
/ `pending_capture`), un reintento devuelve el mismo pago sin crear otro, la búsqueda por
`external_reference` lo encuentra, `?sync=true` lo confirma y la liberación lo deja
`cancelled` (confirmado con un `GET` directo a MP). Se saltea solo sin credenciales (no
corre en CI): necesita `MP_SANDBOX_CARRIER_ACCESS_TOKEN` y `MP_SANDBOX_CARRIER_PUBLIC_KEY`
del Vendedor (el token del OAuth del spike no se persiste, ver el encabezado del test) y las
`MP_TEST_*` del `.env` del spike.

Pendiente: cargar `MP_HOLD_VALIDITY_DAYS` en el secret si MOVO-215 define otro valor;
`svc-shipments` ya los llama desde la saga de asignación (MOVO-210, ver
`services/movo-svc-shipments/CLAUDE.md`). El aviso a `POST /internal/shipments/:id/hold-events`
cuando MP cancela o vence un hold lo hace el webhook (MOVO-268, abajo).

### MOVO-212 — Captura del hold y liquidación (lado `svc-payments`)

Endpoints **internos** (sin gateway, como los holds): `POST /internal/payments/holds/by-shipment/:shipmentId/capture`
y `GET /internal/payments/holds/by-shipment/:shipmentId/settlement` (bajo el mismo prefijo que los
holds, para que el `PaymentsClient` de MOVO-210 los alcance con su misma base). Código en `src/modules/settlements/`,
`src/repositories/settlement-repository.ts` y `src/plugins/captures.ts`; contrato en `@movo/shared`
(`types/settlement.ts`). Tabla `payments.settlements` (migración `20261011120000`).

- **Idempotencia en tres capas (AC7)**: una liquidación `credited` se devuelve sin tocar a MP; hay UNA
  fila por envío (`shipment_id` único) que se crea en `processing` ANTES de llamar a MP; la captura va con
  la key `movo-hold-capture-<holdId>`. Si MP falla pero el pago ya está `approved` (respuesta perdida cuya
  key venció) se adopta en vez de capturar de nuevo.
- **Sin `amount` en la captura (AC3)**: MP cobra exactamente lo autorizado. El bruto de la liquidación es
  el monto del hold.
- **El desglose sale de MP, no de una tasa**: tras capturar se hace `getPayment` y se lee `fee_details`
  (`application_fee` = comisión de Movo, el resto = fee de MP) y `net_received_amount`. Antes de capturar
  ese desglose no existe (SOLUCION-FINAL §3). Aritmética en `Decimal`; si bruto ≠ fee MP + comisión + neto
  se loguea el error pero se registra lo que dice MP. `MP_TRANSACTION_FEE_RATE` (placeholder) no interviene.
- **Fallos (AC8)**: este servicio no conoce el estado del envío, así que no puede revertir la entrega. Un
  fallo deja la liquidación `failed` (con `failureReason`) o `processing` (cobrado pero sin desglose todavía)
  y el hold como estaba; llamar de nuevo reintenta desde donde quedó. El backoff y el escalado son MOVO-213.
- **Decisión no obvia**: no se rechaza de entrada por `expiresAt` vencido. `MP_HOLD_VALIDITY_DAYS` es una
  estimación provisoria (MOVO-215), así que se intenta igual y se clasifica el fallo como `hold_expired` solo
  si MP rechaza y el hold ya pasó su fecha o MP lo tiene `cancelled`. Un hold cancelado por MP NO se sincroniza
  acá: lo refleja el webhook (MOVO-268) o `?sync=true`, y la captura solo lo clasifica.
- **Visibilidad por rol (AC10)**: payments devuelve la liquidación completa; el filtro (transportista ve todo,
  emisor total y fecha, receptor nada) lo aplica `svc-shipments`, que es quien sabe quién es quién.

El lado de `svc-shipments` (notifier real, `completed`, push, barrido y endpoint por rol) está en
`services/movo-svc-shipments/CLAUDE.md` (MOVO-212).

Los tests que truncan `holds` (también los del webhook) incluyen `settlements` y usan `CASCADE`:
`settlements.hold_id` es FK a `holds`.

Pendiente: `test/captures.sandbox.test.ts` (captura real y contraste de la liquidación contra un `GET` directo a MP) está escrito pero nunca corrió: se saltea sin credenciales, mismas variables que `holds.sandbox.test.ts`.

### MOVO-116 — `GET /internal/payments/mp-connect/:userId/status`

Endpoint interno (`src/modules/mp-connect/mp-connect-internal.routes.ts`, sin ruta en el gateway
ni hook de `x-user-id`) que devuelve `{ linked }` para el bloqueo del transportista de
`svc-shipments` (ADR-036). `linked` usa el mismo criterio que el hold
(`hasActiveCredentials`, nuevo en el repositorio, comparte `activeAccountWhere` con
`findActiveCredentials` y no descifra tokens): es más estricto que el `linked` de
`GET /payments/mp-connect/status` porque también exige `public_key`, así nadie pasa el bloqueo
y después cae en el 409 del hold. Tests en `test/mp-connect.integration.test.ts`.

### MOVO-268 — Webhook de MP: holds cancelados o vencidos por MP y contracargos

`POST /payments/webhooks/mercadopago` (pública en el gateway, plugin aparte como el callback
de OAuth), registrado en el panel de la app para el tópico `payment`. Código en
`src/modules/webhooks/`, `src/repositories/mp-webhook-repository.ts`,
`src/utils/mp-webhook-signature.ts`, `src/adapters/{shipments-client,alert-notifier}.ts` y
`src/plugins/mp-webhooks.ts`.

- **Inbox en la base (AC7)**: la ruta valida `x-signature` (HMAC del manifest
  `id;request-id;ts`, sin ventana sobre `ts`: un reenvío viejo es inofensivo), guarda la
  notificación en `mp_webhook_notifications` y responde 200; el procesamiento corre en
  segundo plano. Un error propio (MP o shipments caídos) la deja `pending` con backoff
  (1, 2, 4... min, tope 6 h) y un barrido (`setInterval`, sin lock de Redis: cada
  notificación se toma con un UPDATE condicional) la reintenta hasta
  `MP_WEBHOOK_MAX_ATTEMPTS`; después queda `failed` y se alerta.
- **Nunca se actúa sobre el body (AC3)**: `Payment.get` con el token del transportista
  dueño del hold. Un pago sin hold se busca por el `user_id` del vendedor y su
  `external_reference`, lo que además rescata un intento que quedó en `creating`. Sin
  credenciales (desvinculó o MP revocó) la notificación queda `unverifiable` con alerta.
- **Idempotencia (AC6)**: único por `id` de la notificación; el cambio del hold es un
  UPDATE condicional sobre el estado esperado, en la misma transacción que anota el aviso
  pendiente a shipments (`pending_hold_event`). Así un reintento vuelve a avisar sin
  volver a consultar a MP, y la liberación hecha por Movo que vuelve como webhook no avisa.
- **Vencido = `cancelled` + `status_detail: expired`** (sin estado nuevo en el enum ni en
  `@movo/shared`); a shipments se le manda `event: expired`. Falta confirmar en MOVO-215 que
  MP use ese detail. Un `in_process` que MP rechaza manda `rejected`; uno que autoriza solo
  actualiza la fila (el barrido de la saga ya hace `?sync=true`).
- **`approved` no toca el hold**: la transición a `captured` es de la captura (MOVO-212),
  que persiste la liquidación. El webhook solo loguea.
- **Contracargo, reembolso externo y mediación (AC5)**: se registran en
  `payment_provider_events` (único por pago + estado de MP, una sola alerta). El hold y la
  liquidación de MOVO-212 no cambian; se relacionan por `mp_payment_id`
  (`settlements.mp_payment_id`), sin FK ni columna nueva. Qué pasa con el cobro ya acreditado
  queda para disputas (MOVO-30/34).
- **Alertas** (`AlertNotifier`, consola o Telegram con `ALERT_PROVIDER`): contracargos,
  notificaciones `unverifiable`/`failed` y el `hold_lost_after_pickup` que responde shipments
  (hold perdido con el paquete en camino: la captura va a fallar). La reusa MOVO-213.

Pendiente: probar contra el sandbox con una notificación real por túnel (DoD), registrar
`https://api-dev.movosend.app/api/v1/payments/webhooks/mercadopago` en el panel de
`movosend` y cargar en el secret de dev `ALERT_PROVIDER=telegram`,
`ALERT_TELEGRAM_BOT_TOKEN`/`_CHAT_ID` y `ALERT_ENVIRONMENT_LABEL=dev`.
