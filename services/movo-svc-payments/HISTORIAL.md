# Historial de implementación — services/movo-svc-payments

Entrada corta por US: qué se hizo, en qué archivos, decisiones no obvias, qué queda pendiente. Reglas para mantenerlo en el `CLAUDE.md` de la raíz.

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
La liberación admite `expectedCarrierId` y `expectedHoldId` como query opcional: si el último hold no coincide,
responde 409 sin cancelar el intento de una asignación posterior.
Contrato en `@movo/shared` (`types/hold.ts`). Código en `src/modules/holds/`,
`src/repositories/hold-repository.ts` y `src/plugins/holds.ts`. Arquitectura de cobro:
ADR-022.

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
  conoce envíos ni usuarios (ADR-003/017), así que `svc-shipments` los manda; el valor que
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

MOVO-215 cerró `MP_HOLD_VALIDITY_DAYS` en 5, el default (DD-050);
`svc-shipments` ya los llama desde la saga de asignación (MOVO-210, ver
`services/movo-svc-shipments/HISTORIAL.md`). El aviso a `POST /internal/shipments/:id/hold-events`
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
  El update a `failed` es condicional sobre `processing` (`updateIfStatus`): una captura en línea que ya
  acreditó no la pisa un fallo tardío del reintento, y `capture()` relee y devuelve la acreditada.
  **Fallos permanentes no se reintentan** (review de PR #235): `hold_expired` corta sin llamar a MP, y
  `carrier_account_unavailable` solo se reintenta si la vinculación cambió después del fallo (re-vinculación
  o un refresh de MOVO-243); un token vencido falla sin llamar a MP. **Pendiente (MOVO-243)**: refrescar el
  `access_token` con el `refresh_token` antes de capturar; hoy no hay flujo de refresh en este servicio.
- **Comisión de MP = solo lo que descuenta al vendedor** (`fee_payer: collector`): un cargo que paga el
  comprador (`financing_fee` en cuotas) queda afuera, así `mpFee + comisión + neto == bruto` sigue cerrando.
- **Decisión no obvia** (superada por MOVO-213: ahora `expires_at` se mira antes de cada intento): no se rechaza de entrada por `expiresAt` vencido. `MP_HOLD_VALIDITY_DAYS` es una
  estimación provisoria (MOVO-215), así que se intenta igual y se clasifica el fallo como `hold_expired` solo
  si MP rechaza y el hold ya pasó su fecha o MP lo tiene `cancelled`. Un hold cancelado por MP NO se sincroniza
  acá: lo refleja el webhook (MOVO-268) o `?sync=true`, y la captura solo lo clasifica.
- **`captured` es un UPDATE condicional sobre `authorized`** (`holdRepository.markCaptured`): si el webhook movió el hold
  en el medio no se pisa, se loguea y la liquidación se acredita igual porque MP ya cobró.
- **Visibilidad por rol (AC10)**: payments devuelve la liquidación completa; el filtro (transportista ve todo,
  emisor total y fecha, receptor nada) lo aplica `svc-shipments`, que es quien sabe quién es quién.

El lado de `svc-shipments` (notifier real, `completed`, push, barrido y endpoint por rol) está en
`services/movo-svc-shipments/HISTORIAL.md` (MOVO-212).

Los tests que truncan `holds` (también los del webhook) incluyen `settlements` y usan `CASCADE`:
`settlements.hold_id` es FK a `holds`.

Verificado contra el sandbox real (13/10): `test/captures.sandbox.test.ts` crea un hold de $1150 con fee 150, lo captura
(neto 952,85 = 1150 − 47,15 de MP − 150 de Movo, igual que un `GET` directo a MP) y una segunda captura devuelve la misma
liquidación sin cobrar de nuevo. Se saltea sin credenciales (no corre en CI), mismas variables que `holds.sandbox.test.ts`.
Entre el 11 y el 13/10 `POST /v1/payments` respondió `500 internal_error` (`cause: []`) para cualquier pago, incluso sin
fee ni hold: era de MP y se resolvió solo.

### MOVO-116 — `GET /internal/payments/mp-connect/:userId/status`

Endpoint interno (`src/modules/mp-connect/mp-connect-internal.routes.ts`, sin ruta en el gateway
ni hook de `x-user-id`) que devuelve `{ linked }` para el bloqueo del transportista de
`svc-shipments` (DD-036). `linked` usa el mismo criterio que el hold
(`hasActiveCredentials`, nuevo en el repositorio, comparte `activeAccountWhere` con
`findActiveCredentials` y no descifra tokens): es más estricto que el `linked` de
`GET /payments/mp-connect/status` porque también exige `public_key`, así nadie pasa el bloqueo
y después cae en el 409 del hold. Tests en `test/mp-connect.integration.test.ts`.

### MOVO-243 — Renovación automática de tokens OAuth y marcado de vinculación revocada

Barrido periódico (`src/plugins/mp-token-refresh-sweep.ts`, esqueleto `register-sweep.ts`
copiado de `svc-shipments`: `setInterval` + lock Redis) que llama a
`mpConnect.refreshDueTokens()` (`mp-connect.service.ts`). Nunca refresca al cobrar (AC1).
Cliente: `refreshTokens` en `mercadopago-oauth-client.ts`; repositorio: `findDueForRefresh`,
`saveRefreshedTokens`, `markRevoked`, `touchRefreshAttempt`; conteo de rechazos en
`mp-refresh-strike-store.ts` (Redis). El barrido hace además una corrida inicial a los 30 s
de arrancar (`register-sweep.ts`): con deploys frecuentes sobre `develop` el primer
intervalo de 60 min no llegaría nunca. El lock de Redis evita que las réplicas la dupliquen.

- **Barrido cada hora, ventana de 30 días** (`MP_TOKEN_REFRESH_SWEEP_INTERVAL_MINUTES`,
  `MP_TOKEN_REFRESH_WINDOW_DAYS`), en vez de un cron diario: con `setInterval` un deploy
  diario reiniciaría el timer antes de que dispare nunca, y la ventana larga hace que un
  MP caído se reintente muchas veces antes de que un token venza. La consulta es barata
  (nada que renovar casi siempre). Un token ya vencido y no revocado también se intenta.
- **Revocación = 400 `invalid_grant` visto en DOS corridas seguidas sobre el mismo token**
  (`MercadoPagoOAuthError.isRevocation()`; el error conserva el código corto `error` de
  OAuth, no el resto del body). `invalid_grant` también aparece si otra corrida o réplica ya
  canjeó el token, así que el primer rechazo solo se registra (`failed`) en Redis
  (`mp_refresh_invalid_grant:<userId>`, hash del token cifrado, TTL 7 días, sin migración);
  si en el medio el token cambió (otra corrida lo rotó, el transportista re-vinculó) o hubo
  un refresh exitoso, el conteo arranca de cero. Todo lo demás (5xx, 429, red,
  `invalid_client` = nuestra app mal configurada) es transitorio: no toca la fila y se
  reintenta (AC4). Revocada, la fila sale de `findDueForRefresh` y no se reintenta (AC3); el
  status pasa a `invalid/revoked` y el hold y el webhook (`findCredentials`) dejan de usar
  el token.
- **Una fila problemática no frena ni acapara el lote**: `findDueForRefresh` ordena por
  `updated_at` (el intento más viejo primero) y cada fallo anota el intento con
  `touchRefreshAttempt`, así las que fallan siempre (`invalid_client`, 5xx persistente)
  rotan al final en vez de ocupar los 100 lugares. Una fila que no se descifra (otra key,
  corrupta) se loguea en `error` y se omite sin abortar la corrida.
- **Sin configuración, el barrido avisa en `error`** (no `warn`): en prod las credenciales de
  MP siguen sin cargar y, sin una alerta visible, los tokens de 180 días vencerían sin que
  nadie se entere.
- **Guardado con compare-and-swap** sobre el `refresh_token` cifrado leído: si el
  transportista re-vincula o desvincula mientras se espera a MP, el resultado (renovación o
  revocación) se descarta en vez de pisar la vinculación nueva.
- **Se guardan los dos tokens** aunque el sandbox devolvió el mismo `access_token`.
  Si MP rotó el `refresh_token` y la escritura falla, se reintenta el guardado 3 veces (0,5 s
  y 2 s de pausa, `SAVE_RETRY_DELAYS_MS`) y, si la base sigue caída, los tokens nuevos se
  dejan cifrados (misma key que la base) en Redis (`mp_refresh_pending:<userId>`, TTL 24 h,
  `mp-pending-tokens-store.ts`). La corrida siguiente los persiste ANTES de llamar a MP; un
  respaldo cuyo token ya no es el de la base (re-vinculó) se descarta. Riesgo residual
  aceptado: base y Redis caídos a la vez, o la base sin volver en 24 h; ahí el token viejo
  queda inservible y la cuenta se revoca tras dos `invalid_grant` (hay que re-vincular).
- Env vars en `.env.example`, `envSchema` y `docker-compose.yml` (con `:-` por default).

Verificado contra el sandbox (11/10, cuenta Vendedor del equipo, `FetchMercadoPagoOAuthClient`
real): el refresh sobre el `refresh_token` guardado devolvió 200 con `access_token` `TEST-`
nuevo (esta vez distinto del anterior, así que no se puede asumir que se mantiene), un
`refresh_token` rotado y `expires_in` de 180 días. Un segundo refresh con el
`refresh_token` ya canjeado **también respondió 200**: el sandbox no hace el refresh de un
solo uso, así que ahí no se observó ningún rechazo. El disparador por vencimiento próximo
se probó con `token_expires_at` forzado en la base (tests de integración), no esperando el
plazo real.

Pendiente: observar un `invalid_grant` real (con la confirmación en dos corridas, la
revocación recién se ve en la segunda). El código asume 400 `invalid_grant` (lo que
documenta MP) y falla seguro si es otra cosa (no revoca, reintenta); falta revocar el
acceso desde la cuenta de prueba de MP y correr una corrida del barrido.

### MOVO-268 — Webhook de MP: holds cancelados o vencidos por MP y contracargos

`POST /payments/webhooks/mercadopago` (pública en el gateway, plugin aparte como el callback
de OAuth), registrado en el panel de la app para el tópico `payment`. Código en
`src/modules/webhooks/`, `src/repositories/mp-webhook-repository.ts`,
`src/utils/mp-webhook-signature.ts`, `src/adapters/{shipments-client,alert-notifier}.ts` y
`src/plugins/mp-webhooks.ts`.

- **Se deduplica por lo firmado, no por el `id` del body** (review de PR #235): la clave es
  `data.id:x-request-id:ts` (`notificationDedupeKey`), así reenviar una notificación válida con otro `id` no crea
  filas nuevas. El `user_id` del body no está firmado: solo orienta qué credenciales probar para un pago
  desconocido, y si el pago no es de ese vendedor (`collector_id`) se ignora. Un `status` heredado de `Object`
  (`constructor`) ya no se cuela como `kind` (`hasOwnProperty`). Si la reconciliación de un intento en
  `creating` (`?sync=true`) lo lleva a cancelado/vencido/rechazado, igual se avisa a `svc-shipments` (antes se veía
  como "ya cerrado" y no avisaba).
- **Inbox en la base (AC7)**: la ruta valida `x-signature` (HMAC del manifest
  `id;request-id;ts`, sin ventana sobre `ts`: un reintento legítimo de MP conserva el `ts`), guarda la
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

### MOVO-100 — Tarjetas guardadas del emisor en la cuenta de Movo (DD-039 propuesto)

`GET /payments/cards/checkout-data`, `POST /payments/cards`, `GET /payments/cards`,
`PATCH /payments/cards/:id/default`, `PATCH /payments/cards/:id` (alias) y `DELETE /payments/cards/:id`
(heredan el hook `x-user-id`; el gateway ya proxeaba `/payments`), más el interno
`DELETE /internal/payments/users/:userId/cards` para la baja de cuenta (MOVO-39, nadie lo llama
todavía). Código en `src/modules/cards/`, `src/repositories/saved-card-repository.ts`,
`src/adapters/mercadopago-customers-client.ts` y `src/adapters/users-client.ts`; contrato en
`@movo/shared` (`types/saved-card.ts`). Tablas `payer_customers` y `saved_cards` + `holds.saved_card_id`
(migraciones `20261013230000_create_saved_cards` y `20261014120000_payer_customers_unique_mp_customer`).

- **La tarjeta vive en un customer de la cuenta de Movo S.A.** (uno por emisor, `payer_customers`); se
  persiste `mp_customer_id` + `mp_card_id` + marca/últimos 4/vencimiento/alias. Nunca el `card_token`,
  número ni CVV. El token de Movo sale de `POST /oauth/token` (`client_credentials`, `test_token` según
  `MP_TEST_MODE`) con `MovoTokenProvider`, cacheado en Redis (key `mp:movo-token:test|live`) hasta 5 min
  antes de vencer; en modo test un token que no es `TEST-` se rechaza (daría `401 300`). Si MP responde
  401/403 (token revocado o secret rotado) se saca del cache y se reintenta una vez con uno nuevo.
- **Email del customer**: lo pide a `svc-users` (`GET /users/me`, falla cerrado con 502). **Sandbox**: MP
  exige el email de una cuenta de prueba Comprador (si no, `225`), así que `MP_TEST_PAYER_EMAILS` (JSON
  `userId -> email`) lo reemplaza, solo con `MP_TEST_MODE=true`; un usuario fuera del mapa usa su email
  real y deja un warning. Un `101` (el email ya tiene customer en MP) busca y reusa el existente **solo si
  no es de otra cuenta**: `mp_customer_id` es único y, si ya pertenece a otro usuario (alguien se cambió el
  email y otro se registró con el viejo, o testers que comparten email en `MP_TEST_PAYER_EMAILS`), responde
  `409 CARD_CUSTOMER_CONFLICT` y se resuelve a mano. Compartirlo haría que los holds de uno se cobren como
  el otro y que la baja de cuenta de uno le borre las tarjetas al otro.
- **Customer borrado en MP**: si guardar la tarjeta da 404 y un `GET` del customer confirma que no existe,
  se borra la fila, se dan de baja las tarjetas vivas (se fueron con él) y se reintenta una vez con un
  customer nuevo. Un 404 con el customer vivo sigue siendo `422 CARD_SAVE_REJECTED`.
- **Duplicado por marca + últimos 4 + vencimiento**, no por `mp_card_id`: como el `cardToken` es opaco,
  esos datos solo se conocen después de guardar en MP, así que se guarda primero, se compara contra las
  vivas y, si coincide, se borra la copia nueva de MP (salvo que MP haya devuelto el mismo id) y se
  responde 200 con la existente. Si falla la base después de guardar en MP, la copia solo se borra si no
  es el `mp_card_id` de una tarjeta que el usuario ya tenía. Riesgo aceptado: dos tarjetas distintas con la misma marca/últimos
  4/vencimiento.
- **Índices únicos parciales a mano** (`WHERE deleted_at IS NULL`): `(user_id, mp_card_id)` (parcial y no
  total como pedía el AC1, para poder volver a guardar una tarjeta dada de baja) y una sola `is_default`
  viva por usuario. Alta, predeterminada y baja de un mismo usuario se serializan con
  `pg_advisory_xact_lock` (con `$executeRaw`: `$queryRaw` no deserializa el `void` de la función).
- **Predeterminada**: la primera viva queda marcada; al borrar la predeterminada se promueve la más
  reciente. Tope de 10 vivas (`409 CARD_LIMIT_REACHED`). `DELETE`: `409 CARD_IN_USE` si hay un hold vivo
  con `saved_card_id`; borra en MP primero (un 404 cuenta como borrada) y recién después la fila.
- **`holds.saved_card_id`** nace acá, nullable y sin FK; lo escribe MOVO-282 (ver su entrada abajo).
  El `409 CARD_IN_USE` se probó con holds insertados a mano y, desde MOVO-282, también con un hold real.
- **Alias** (AC11): trim, 1-40, sin caracteres de control, y `400` si trae 12+ dígitos (se ignoran
  espacios y guiones al contar, así "4111 1111 1111 1111" también se rechaza). Es de Movo, no va a MP.
- **Baja de cuenta**: best-effort; si MP falla se loguea el `mpCustomerId` huérfano y las filas locales se
  borran igual.
- **Logger**: `cardToken`/`card_token`, `mpCardId`/`mp_card_id`, `cardId`/`card_id` redactados.
- **Env vars** (`.env.example` + `envSchema` + compose): `MP_PUBLIC_KEY` (sin ella `checkout-data` responde
  `503 CARDS_NOT_CONFIGURED`), `MP_TEST_PAYER_EMAILS`. **`MP_PUBLIC_KEY` solo sirve para tokenizar** en el
  dispositivo: la tarjeta queda siempre en el customer de Movo S.A., sea de quien sea esa key. En dev está
  cargada la `TEST-` de un Vendedor de prueba (atajo de sandbox); en prod se espera la de Movo. `USERS_SERVICE_URL` tiene
  default de código (como en `svc-shipments`), no se lista en compose.

**MOVO-101**: `saved_cards` suma `issuer_name` y `payment_type` (nullable, migración
`20261014180000`), tomados de `issuer.name` y `payment_method.payment_type_id` de la respuesta de MP al
guardar, para que la lista del mobile muestre "Galicia · Crédito". Solo display: no entran en el criterio
de duplicado.

Verificado contra el sandbox real (13/10): `test/cards.sandbox.test.ts` guarda, lista, detecta el duplicado
y borra. **Gotchas del sandbox**: guardar la tarjeta da `500` con la Visa 4509…, la Mastercard 5031… y la
del spike; con la Visa `4075 5957 1648 3764` da 201. La `public_key` con que se tokeniza puede ser la `TEST-`
de cualquier Vendedor de prueba vinculado (la consola de `movosend` solo muestra `APP_USR-`); la de Movo S.A.
sigue sin identificarse (punto 2 de MOVO-283).

Pendiente: `MP_PUBLIC_KEY` ya está cargada en el secret de dev (`TEST-` de un Vendedor de prueba, atajo
de sandbox); producción y segundo
transportista (spike MOVO-283, DD-039 sigue "propuesto"); MOVO-282 ya está (ver abajo) y falta MOVO-39
(llamar al endpoint interno de baja).

### MOVO-282 — Hold con tarjeta guardada: el pagador pasa a ser el customer de la tarjeta (DD-039 propuesto)

`POST /internal/payments/holds` (MOVO-209) suma `payerUserId` (requerido, el emisor; `svc-shipments` siempre
lo manda) y `savedCardId?` (id interno de `payments.saved_cards`). Compatible hacia atrás: sin `savedCardId` el
camino es el de siempre (`payer: { email }`, tarjeta completa). Código en `src/modules/holds/hold.service.ts`
(`resolvePayer`), `holds.schema.ts`, `hold-repository.ts` y `plugins/holds.ts`; contrato en `@movo/shared`
(`types/hold.ts`). **Sin migración**: `holds.saved_card_id` ya existía (MOVO-100).

- **Solo cambia el pagador.** Con `savedCardId` el pago se crea con `payer: { type: "customer", id }` (el
  `mp_customer_id` del emisor en la cuenta de Movo S.A.); con `payer: { email }` y el mismo token MP responde
  `2002 "Customer not found"`. El token (`card_id` + CVV, generado por el mobile con la `public_key` del
  transportista) entra por el mismo campo `cardToken`. El `saved_card_id` se guarda en el hold: es lo que
  habilita el `409 CARD_IN_USE` de MOVO-100 (se compara contra `LIVE_HOLD_STATUSES`).
- **Pertenencia validada ANTES de abrir el intento** (`resolvePayer`): la tarjeta tiene que ser de
  `payerUserId` (`findLive`) y el emisor tener customer; si no, `404 NOT_FOUND "Tarjeta no encontrada."`, el
  mismo código y mensaje de `cards.service.ts`, sin revelar si la tarjeta existe ni de quién es. Una tarjeta
  ajena no crea fila ni llama a MP. Un replay de un hold vivo también la valida (son dos lecturas baratas).
- **`customer_id` y `card_id` de MP no salen**: ni en `HoldResponse` (tampoco se agregó `savedCardId`) ni en
  los logs (la validación y el armado del pago no los loguean; el logger ya redacta `cardToken`/`cardId`).
- **`request_fingerprint` incluye `savedCardId` solo cuando viene**: un reintento con otra tarjeta guardada
  sobre un intento sin respuesta no reusa la key (cierra el viejo como `superseded` y abre el intento 2), y la
  huella de un intento sin tarjeta guardada es idéntica a la de antes, así que un `creating` en vuelo durante el
  deploy no se reinterpreta como "cuerpo cambiado". Sigue siendo un hash: nunca el token, el CVV ni el id.
- **Mapeo de rechazos reusado, con un matiz** (`failureReasonFromStatusDetail(detail, { savedCard })`): un CVV
  incorrecto (`cc_rejected_bad_filled_security_code`) ya era `invalid_data`, y fondos insuficientes
  `insufficient_funds`; **con tarjeta guardada, `cc_rejected_bad_filled_date` pasa a `card_rejected`** (el emisor
  no tipeó el vencimiento, así que "revisá el dato" no tiene sentido: la tarjeta guardada venció y tiene que
  probar con otra). Sin tarjeta guardada sigue `invalid_data`. `holdUpdateFromPayment` lo deriva de
  `current.savedCardId`, así que el webhook (MOVO-268) clasifica igual. Un token vencido o ya usado
  (2006/3001/3003) sigue cerrando el intento como `rejected`/`invalid_data` sin pasar por el 502, y se suman
  **3031 (CVV ausente o vacío) y 3032 (CVV de largo inválido)**: MP los responde con 400 al crear el pago, antes
  de crearlo, y repetirlos falla igual. Sin esto quedaban como transitorios (502 y el intento colgado en `creating`).
- **Bug de MOVO-209 corregido acá**: `readMpError` leía `error.cause`, pero el SDK `mercadopago` 3.x tira una
  instancia de `Error` con las causas de la API en **`causes`** (plural, copia del `cause` del body). Con el SDK
  real **ninguna** causa se reconocía (ni 2006/3001/3003 ni 2034/2059): todo 400 terminaba como transitorio. Ahora
  lee `causes` y también `cause` (cuerpo crudo). Los tests de MOVO-209 usaban objetos con `cause` y no lo veían;
  hay un test con la forma real del SDK.
- **Liberar es igual que antes**: cancela con el token del transportista y no toca la tarjeta guardada.

Tests: `test/hold.service.test.ts` (payer customer vs. email, 404 sin fila ni llamada a MP, indistinguible
ajena/inexistente, fingerprint y reuso de key, mapeo de rechazos, logs y respuesta sin ids de MP, liberación) y
`test/holds.integration.test.ts` (Postgres/Redis reales con MP mockeado: `saved_card_id` persistido, 404, `409
CARD_IN_USE` con un hold real, otra tarjeta no reusa la key). `test/holds.sandbox.test.ts` suma el flujo
completo contra el sandbox real (tarjeta guardada → token con `card_id` + CVV y la `public_key` del Vendedor →
hold con `payer: customer` → `authorized` → `409 CARD_IN_USE` con el hold vivo → liberar → la tarjeta sigue
guardada y se puede dar de baja); se saltea sin credenciales.

**Verificado contra el sandbox real (14/10/2026)** con el Transportista de prueba y la Visa 4075 5957 1648 3764.
`test/holds.sandbox.test.ts` pasa con 7 escenarios sobre una tarjeta guardada: camino feliz (`authorized`,
`CARD_IN_USE` con el hold vivo, liberar), titular `SECU` (`cc_rejected_bad_filled_security_code` → `invalid_data`),
`FUND` (`insufficient_funds`), `EXPI` (`cc_rejected_bad_filled_date` → `card_rejected`, la decisión de arriba
confirmada con el código real de MP), CVV ausente (400 `3031`) y de largo inválido (400 `3032`) → `rejected`/
`invalid_data`, y `CONT` (`in_process`/`pending_contingency`, un hold vivo). Matriz completa de titulares:
`CALL` → `bad_filled_card_number`, `OTHE` → `bad_filled_other`, `FORM` → autoriza.

**Gotchas del sandbox** (descubiertos en esta prueba): (1) **guardar la tarjeta con cualquier titular distinto de
APRO da `500` si el token no lleva `cardholder.identification`** (DNI): con la identificación guardan todos y el
titular decide el resultado del pago. Es lo que hay que mandar al tokenizar para guardar (el formulario de MP del
mobile, MOVO-101, tiene que incluirla). (2) **El valor del CVV no se valida**: un `999` se autoriza igual; solo
falla uno ausente, vacío o de largo inválido. Un CVV equivocado de verdad solo se verá en producción (spike
MOVO-283). (3) Al borrar un customer, MP tarda ~1-2 minutos en dejar de devolverlo en la búsqueda por email (da
`404 customer not found` por id): una segunda corrida inmediata del test de sandbox puede fallar por eso.

### MOVO-302 — Historial: guardar el pagador y la tarjeta en el hold (sub-issue de MOVO-28)

`payments.holds` suma `payer_id` (el `payerUserId` de MOVO-282; los holds anteriores quedan en null y no
aparecen en el historial) y `card_last4`/`card_brand`, tomados de la respuesta de MP sin pisar un dato ya
guardado: `src/utils/payment-card.ts` es la única puerta y la usan crear, `?sync=true`, adopción, webhook
(aunque el estado no cambie) y captura. Un reintento con otro `payerUserId` sobre un hold vigente responde
`409 HOLD_CONFLICT`. Sin cambio de contrato: `HoldResponse` no los expone, los lee MOVO-303.

### MOVO-305 — Spike: captura parcial y `application_fee` variable en el sandbox

Resultado en `docs/payments/spike-movo-305-captura-parcial.md` (test: `test/partial-capture.sandbox.test.ts`,
pega directo a MP). Limitaciones de MP que tiene que respetar la penalidad (MOVO-306/307): en una captura
parcial el `application_fee` se cobra **entero** (el MP fee sí va sobre lo capturado); capturar un monto
≤ al fee responde `400 4201` y deja el hold `authorized`; un segundo capture no cobra de nuevo; al crear el
hold, el fee tiene que ser `< transaction_amount` (si no, `400 4038`). Para "Pagar mi saldo" (MOVO-312) el
pago directo a Movo S.A. no se puede (ver esa entrada): se cobra a una cuenta cobradora vinculada por OAuth.
### MOVO-303 — Historial: listado y detalle por rol (sub-issue de MOVO-28)

`GET /payments/transactions?role=sender|carrier&status=&from=&to=&cursor=&limit=` y
`GET /payments/transactions/:id?role=` (heredan el hook `x-user-id`; el gateway ya proxeaba
`/payments`, sin tocar `routes-map.ts`). Código en `src/modules/transactions/`,
`src/repositories/transaction-repository.ts` y `src/plugins/transactions.ts`; contrato en
`@movo/shared` (`types/transaction.ts`). Sin tabla nueva: una fila por hold, con liquidación y
reembolsos/contracargos (`payment_provider_events`) resueltos en la misma consulta.

- **El estado derivado vive dos veces, a propósito**: `deriveTransactionStatus` (función pura, la
  que arma cada ítem y el detalle) y su espejo `STATUS_CASE` en SQL, que filtra por estado ANTES de
  paginar. Un cambio en la regla se replica en las dos; la integración verifica que el filtro y el
  estado de cada ítem coincidan. Visibles: `in_process`/`authorized`/`captured` y `cancelled` con
  `mp_payment_id` (los `creating`, `rejected` y cancelados sin pago no aparecen).
- **Cursor `(created_at, id)` con precisión de µs**: Postgres guarda µs y el `Date` de JS solo ms,
  así que el cursor sale de un `to_char(... US)` de la base; con ms se saltearían filas que
  comparten el milisegundo. Comparación por tupla `(created_at, id) < (...)`.
- **`from`/`to` en hora argentina** (`argentinaDayStart`): 00:00 UTC del día + `ARGENTINA_UTC_OFFSET_HOURS`
  (exportado de `@movo/shared`, sin repetir el UTC-3); `to` inclusivo = inicio del día siguiente
  exclusivo. La fecha es la de creación del intento de hold, no la de captura. Se rechazan fechas inexistentes (`2026-02-30`) y `from > to`.
- **`status` acepta repetido (`status=a&status=b`) o con comas**; el service valida cada valor (400).
- **Forma del ítem**: `refundedAmountArs` es el último monto informado (no la suma); `card` solo
  viaja con `role=sender` y es `{brand, last4: string | null}` (un hold recuperado por
  `external_reference` puede tener marca y no últimos 4, gap conocido de MOVO-302; el contrato de
  `last4` nullable se aparta del `{brand, last4}` del ticket por eso). `breakdown` solo con
  `role=carrier` y liquidación `credited`; con `role=sender` la clave no existe.
- **Cursor estricto**: regex del ISO con µs más ida y vuelta por `Date` (V8 acepta `2026-02-30` y
  Postgres no, review de PR #256). `status` tiene tope de 20 valores.
- **Los movimientos del detalle usan el mismo `mp_payment_id` que el estado** (`has_dispute`,
  `has_refund`): un evento de otro pago del mismo hold ni cuenta ni se lista.
- **Limitaciones aceptadas** (review de PR #256): (1) una fila por hold, así un envío reasignado o con
  un pago reintentado puede aparecer varias veces (los cancelados con pago salen como `released`);
  (2) `captured` sin liquidación `credited` se ve `reserved` aunque la liquidación esté `failed` o
  `processing`, un estado propio queda para MOVO-213; (3) el webhook (MOVO-268) solo registra
  `refunded`, `charged_back` e `in_mediation`, así que un reembolso parcial (MP lo deja `approved`)
  no llega a `payment_provider_events` y no se ve en el historial; (4) sin índices nuevos: los
  listados usan los de MOVO-302 y los `EXISTS` el único `(mp_payment_id, mp_status)`.
- **404 único** para transacción ajena, de otro rol, inexistente o no visible: el filtro por usuario
  y rol va dentro de la consulta, así no hay forma de distinguirlos.

Tests: `test/transaction-status.test.ts` (cada estado y la precedencia) y
`test/transactions.integration.test.ts` (Postgres real: rol, visibilidad, filtros, borde de las
23:30, cursor sin duplicados ni saltos con la misma fecha, 404, desglose por rol).

### MOVO-309 — Cuenta corriente del usuario (DD-044)

`GET /internal/payments/users/:userId/balance`, `POST /internal/payments/users/:userId/ledger-entries` y
`POST .../manual-adjustments` (internos, mismo prefijo que la baja de tarjetas, sin gateway ni `x-user-id`), más
`GET /payments/balance` (saldo + movimientos paginados por cursor; hereda el hook de `paymentsRoutes`, el gateway
ya proxeaba `/payments`). Código en `src/modules/user-ledger/`, `src/repositories/user-ledger-repository.ts` y
`src/plugins/user-ledger.ts`; contrato en `@movo/shared` (`types/user-ledger.ts`). Tabla
`payments.user_ledger_entries` (migración `20261015220000`). Los consumidores son MOVO-307, 310, 311, 312 y 313; el
primero en leerla es MOVO-313 (`svc-shipments` consulta `GET .../balance` para el bloqueo por deuda vencida, sin
cambios acá: `oldestUnpaidAt` ya es la edad que mide).

- **Solo inserción impuesta por la base**: triggers `BEFORE DELETE`/`BEFORE UPDATE` (a mano en la migración); de un
  `UPDATE` solo pasa `status`. Un `TRUNCATE` sí funciona, por eso los tests lo usan para limpiar. El `reason` de un
  `manual_adjustment` también es un `CHECK`.
- **Saldo** = suma de lo que no está `voided` (un `settled` sigue contando; lo cancela un movimiento negativo aparte).
  `oldestUnpaidAt` = el cargo más viejo que compone la deuda actual (cargos `pending`/`reserved` del más nuevo al más viejo hasta cubrir el saldo), `null` si el saldo no es positivo; saldo, esa fecha y la página se leen en una transacción `REPEATABLE READ`.
- **Idempotencia**: `idempotency_key` única + `request_fingerprint` (hash). Mismo cuerpo → 200 con el original; otro
  cuerpo → 409 `LEDGER_IDEMPOTENCY_CONFLICT`. La carrera la resuelve el P2002 de la base. Si se manda un `holdId` inexistente, el error P2003 de FK se mapea a 404 `HOLD_NOT_FOUND`.
- **El signo no se valida contra el tipo**: lo manda quien registra (decisión del ADR). Monto distinto de cero, hasta
  2 decimales y tope de ±$10.000.000 (los decimales los mira el service, no Ajv). Pagos/cobros (307/312) insertan en `settled`.
- **`reason` de ajustes manuales resguardado**: en `GET /payments/balance` se expone como `null` para resguardar evidencia interna del admin de la app móvil; solo se expone en endpoints internos.
- **`created_at` lo pone la app y la columna es `TIMESTAMPTZ(3)`** (migración `20261016120000`), así el cursor `(created_at, id)` no pierde precisión ni con una fila insertada por fuera de la app.
- `service.transition()` mueve el `status` con un UPDATE condicional; sin endpoint HTTP todavía (lo abren 311/312). Solo permite `pending→reserved|settled|voided`, `reserved→pending|settled|voided` y `settled→voided` (409 `LEDGER_INVALID_TRANSITION`); `voided` es terminal, y el trigger de la base lo impone también.
- **Replay idempotente**: con `created: false` el movimiento se devuelve como está hoy, así que su `status` puede haber cambiado desde el alta; el llamador mira `entry.status`.
- **Sin validar `:userId` ni `adminId`** (ADR-010, perímetro): `svc-payments` no conoce usuarios; el llamador (otro servicio) es quien responde por ellos.

Pendiente: que `svc-admin` llame a `manual-adjustments` (sin UI de admin todavía); sin env vars nuevas.

### MOVO-312 — Pagar mi saldo con tarjeta guardada + CVV (Checkout API)

`GET /payments/balance/pay-data` → `{ publicKey, balanceArs }` y `POST /payments/balance/pay` `{ amountArs, cardToken, savedCardId,
paymentMethodId? }` → `{ attemptId, status: approved|rejected|pending, failureReason, balanceArs }` (heredan el hook `x-user-id`; el gateway
ya proxeaba `/payments`). El usuario no sale de la app: mismo flujo que pagar un envío (DD-039). Código en `src/modules/balance-payment/`,
`src/repositories/balance-payment-attempt-repository.ts` y `src/plugins/balance-payment.ts`; tabla `payments.balance_payment_attempts`
(migración `20261016130000`); contrato en `@movo/shared` (`types/user-ledger.ts`). Diagrama: `flujo-de-pagos.md` 5.7.

**Cuenta cobradora: la reemplazó DD-048 (ver la entrada de MOVO-315 abajo).** Lo que sigue es el diseño original de MOVO-312.
**Cuenta cobradora vinculada por OAuth, no la app de Movo S.A.** Verificado en el sandbox (16/10/2026): con el token `client_credentials`
de la app, `POST /v1/payments` responde `403 At least one policy returned UNAUTHORIZED` (aun con `card_token` inválido, o sea que ni llega a
validarlo), con el token `APP_USR-` de la app `401 Unauthorized use of live credentials`, y `card_tokens` con la `public_key` `APP_USR-` da 201 pero
no sirve. El token de la app no puede crear pagos. Por eso Movo cobra con una cuenta de MP **vinculada como la de un transportista**:
`MOVO_COLLECTOR_USER_ID` es un usuario interno que vincula su cuenta en Pagos y cobros; se leen sus credenciales con
`findActiveCredentials` (token vigente + `public_key`) y las renueva el barrido de MOVO-243. Sin la var, sin cuenta vinculada o con el token
vencido: 503 `BALANCE_COLLECTOR_NOT_CONFIGURED`. En el sandbox esa cuenta es un Vendedor de prueba; en producción, la cuenta real de Movo.

- **Pago directo**: `payer: {type: customer}` con la tarjeta guardada del usuario (`resolvePayer`, igual que `hold.service.ts`: tarjeta ajena o
  dada de baja → 404 `SAVED_CARD_NOT_FOUND`), captura inmediata, sin `capture:false` ni `application_fee`, `external_reference` = id del intento,
  key de MP `movo-balance-<intento>`. El token lo hace el mobile con la `public_key` de `pay-data`.
- **Idempotencia en la base**: índice único parcial `(user_id) WHERE status IN ('creating','pending')` (un solo intento abierto por usuario), a mano en la migración: con
  varios abiertos, aunque de distinto monto, lo que está en vuelo podía sumar más que la deuda y dejar saldo a favor (review de PR #262). Con un
  intento abierto: del mismo monto y `pending` → devuelve su resultado; `creating` con el mismo token/tarjeta (huella) → reintenta con la MISMA key;
  en otro caso (otro monto, otro token) 409 `BALANCE_PAYMENT_IN_PROGRESS`. Un aprobado tardío sobre un intento ya cerrado igual se acredita (es plata
  recibida), así que un saldo a favor puntual por esa vía es aceptable: el ledger lo soporta (saldo negativo).
- **Errores de MP como en los holds** (`classifyCreateError`/`readMpError`/`failureReasonFromStatusDetail`, exportados de `hold.service.ts`): un
  rechazo de la tarjeta o un token inválido (2006/3001/3003/3031/3032) es un 200 con `status: rejected` y `failureReason`; 401/403 de la cobradora →
  intento `failed`, alerta `mp_balance_collector_auth` y 503; sin respuesta (timeout/5xx) → 502 y el intento queda `creating`.
- **Monto**: mayor que cero, hasta 2 decimales y como mucho el saldo deudor (`ledger.balance`); sin deuda o con saldo a favor → 422
  `BALANCE_AMOUNT_EXCEEDS_DEBT`.
- **La plata se acredita una sola vez por el ledger, no por el estado del intento**: `voluntary_payment` negativo `settled` con
  `idempotencyKey: balance-payment:<intento>`, al aprobarse en la respuesta o por el webhook. Un aprobado tardío sobre un intento ya `rejected`
  igual se acredita (es plata recibida); un `mp_payment_id` es único por intento (un pago no puede asentar dos).
- **Webhook**: `mp-webhook.service.ts#resolveBalancePayment` corre ANTES del camino de holds, solo si el `user_id` de la notificación es el de la
  cuenta cobradora (`collectorForWebhook`). Consulta `Payment.get` con su token, exige `external_reference` de un intento y monto igual (si no, no acredita y
  avisa). Contracargo/reembolso/mediación no tocan el ledger: alertan. Los holds se procesan igual.
- **Conciliación** (`reconcileOpen`, al pedir `pay-data` o `pay`): por cada intento abierto busca en MP por `external_reference` con el token de la cobradora;
  un aprobado se acredita antes de validar el monto, y un `creating` de más de 10 min sin pago en MP pasa a `failed`. Una falla de MP no bloquea. En el
  sandbox esa búsqueda llegó a devolver 0 con el pago ya aprobado (la de `id` sí lo veía): por eso el resultado inmediato y el webhook son el camino principal.
  No hay barrido periódico.
- **Env var nueva**: `MOVO_COLLECTOR_USER_ID` (`.env.example`, `envSchema`, `docker-compose.yml`).

**Reemplaza a una primera versión con Checkout Pro** (preferencia + redirect) que se descartó: el usuario sale de la app, y no es el flujo de pagar un envío.

**Verificado contra el sandbox real (16/10/2026)** con `test/balance-payment.sandbox.test.ts` (no corre en CI; variables en su cabecera): cuenta
cobradora = el Vendedor de prueba vinculado por OAuth, tarjeta guardada en el customer de Movo S.A., token con `card_id` + CVV y la `public_key` de la
cobradora. El `payer: customer` de Movo S.A. **sí funciona cuando cobra otra cuenta**. APRO aprueba y se acredita una vez (el pago existe en MP con el monto y el
`external_reference` del intento); FUND → `insufficient_funds`; SECU → `invalid_data`; OTHE vuelve como `cc_rejected_bad_filled_other` (→ `invalid_data`, no
`card_rejected`); la misma idempotency key devuelve el mismo pago; dos pedidos iguales a la vez cobran una vez (MP responde 423 `2001` a la segunda y el
servicio lo trata como sin respuesta, 502). Para vincular la cobradora en sandbox hace falta un `redirect_uri` https cargado en la app (MP rechaza
`movo://` con `strict_redirect_uri_mismatch`).

**Webhook real verificado (16/10/2026)**, con el servicio local detrás de un túnel y el webhook cargado en el panel de la app: llega `payment.created`
firmado, se valida, se consulta el pago con el token de la cobradora y se resuelve `balance_payment_already_settled` (el pago aprobado en la respuesta no se
acredita dos veces); con titular CONT el pago queda `pending` (`pending_contingency`), el webhook lo deja en `balance_payment_waiting` y el saldo no cambia.
El sandbox no permite aprobar después un pago pendiente, así que esa transición queda cubierta solo por integración.

Pendiente: vincular la cuenta de Movo en dev/prod y cargar `MOVO_COLLECTOR_USER_ID` en los secrets; la pantalla mobile (MOVO-315).

### MOVO-306 — Captura parcial del hold por penalidad de cancelación

`POST /internal/payments/holds/by-shipment/:shipmentId/capture` acepta un body opcional
`{ kind?: "delivery" | "cancellation_penalty", amountArs? }`; sin body es la captura de entrega de MOVO-212
(un `preValidation` lo valida como `{}`: así llama hoy `svc-shipments`). La penalidad exige `amountArs` y la
entrega lo rechaza (400): la entrega siempre cobra lo autorizado. `payments.settlements` suma `kind`
(enum `settlement_kind`, default `delivery`); sigue siendo una fila por envío, y un pedido de otro tipo o por
otro monto que la existente es `409 SETTLEMENT_CONFLICT`, también si la primera falló. La penalidad se
captura con `amount` y su propia key (`movo-hold-penalty-<holdId>`); estados, reintentos y `hold_expired`
permanente son los de la entrega. Antes de crear la fila y de llamar a MP: `422 CAPTURE_AMOUNT_EXCEEDS_HOLD`
si supera el hold y `422 CAPTURE_BELOW_APPLICATION_FEE` si no supera el `application_fee` más el fee de MP
estimado con la tasa de `@movo/shared` (MP solo acepta si al transportista le queda neto: `4201` o `2072`, spike
MOVO-305 escenario H); si igual MP la rechaza, se responde el mismo 422. El hold queda `authorized` para el
plan B de MOVO-307 (liberar con `/release`). Las claves desconocidas del body son 400 (Ajv las borraría en
silencio y un `{ amount }` mal escrito capturaba el hold entero como entrega). La
comisión liquidada es la entera que informa `fee_details`. Pendiente: que `svc-shipments` mande la
penalidad (MOVO-307) y que el historial de transacciones (MOVO-303) distinga una penalidad de un cobro.

### Tarjetas guardadas del emisor con CVV (MOVO-65, DD-039 propuesto)

El 13/10/2026 se validó contra el sandbox que el emisor puede guardar tarjetas y pagar con solo el
CVV en el modelo marketplace, y se reescribieron las historias en Linear. Revierte la decisión del
29/09 (MOVO-12, ADR-022 punto 5: "el emisor ingresa la tarjeta completa cada vez"). Detalle de la
prueba y alternativas en `docs/payments/dd-039-tarjetas-guardadas-con-cvv.md`.

- **Diseño**: la tarjeta se guarda en un customer de la cuenta de **Movo S.A.** (un customer por
  emisor, `svc-payments`), no en la del transportista. Al pagar, el mobile pide a MP un token con
  `card_id` + CVV y la `public_key` del transportista del envío (`POST /v1/card_tokens`), y el hold
  usa `payer: {type: "customer", id}`. El `svc-shipments` (`POST /shipments/:id/funding`) y el hold
  (`POST /internal/payments/holds`) se reutilizan: ya reciben un `cardToken`; solo suman `savedCardId`.
- **Hallazgo no obvio**: el `401 300 "Unauthorized use of live credentials"` del spike (`SOLUCION-FINAL.md`
  §7) venía de usar el token `APP_USR-` de la app. Con `POST /oauth/token` (`client_credentials`,
  `test_token=true`) Movo S.A. obtiene un token `TEST-` y puede crear customers. En sandbox el token de la
  tarjeta tiene que generarse con una `public_key` `TEST-` (la `APP_USR-` da `404 card not found`; el
  `Bearer` da `403 G001`), y la de Movo todavía no está identificada.
- **Nombre de referencia**: la tarjeta guarda un `alias` opcional (1-40 caracteres, lo edita el usuario, se
  rechaza si parece un número de tarjeta) para distinguirla en la lista y al pagar. Es de Movo, no va a MP.
- **Dependencias en Linear**: MOVO-100 → MOVO-101, MOVO-282 y MOVO-269; MOVO-282 → MOVO-269;
  MOVO-101 → MOVO-269 (el alta es el componente que usa el pago); MOVO-283 → MOVO-37. El spike
  MOVO-283 no bloquea el desarrollo en sandbox, sí la salida a producción.
- **Tickets**: MOVO-65 (US padre, vuelve a Todo), MOVO-100 (backend `svc-payments`: alta/listado/
  predeterminada/baja y `checkout-data`; antes `svc-users` con `mp_card_token`), MOVO-282 (hold con
  `payer: customer`), MOVO-101 (mobile, Pagos y cobros: gestión de tarjetas, para emisor y
  transportista), MOVO-269 (mobile: pagar con tarjeta guardada + CVV), MOVO-283 (spike).
- **Estado**: MOVO-100 (backend `svc-payments`) implementado, ver `services/movo-svc-payments/HISTORIAL.md`.
  MOVO-101 (mobile, alta/lista/predeterminada/nombre/baja en "Pagos y cobros") implementado en el
  PR #239, ver `movo-mobile/HISTORIAL.md`; falta probarlo en un development build con tarjetas de test.
  **`MP_PUBLIC_KEY`** solo tokeniza en el dispositivo (la tarjeta queda siempre en el customer de Movo S.A.);
  en dev es una `TEST-` de un Vendedor de prueba (ya cargada en el secret), en prod se espera la de Movo.
  MOVO-282 (backend: hold con `payer: customer` + `saved_card_id`, `svc-payments`/`svc-shipments`) implementado,
  ver `services/movo-svc-payments/HISTORIAL.md`; verificado contra el sandbox real el 14/10 con 7 escenarios (camino
  feliz y rechazos por titular). Sacó a la luz un bug de MOVO-209: `readMpError` no leía `causes` del SDK real.
  Para guardar una tarjeta en sandbox con un titular distinto de APRO hay que tokenizar con `identification`.
  MOVO-269 (mobile, pago con tarjeta guardada + CVV) implementado, ver `movo-mobile/HISTORIAL.md`; falta probarlo en un development build.
  **Pendiente**: confirmar con MOVO-283 cuál es la key de producción; el spike MOVO-283 (segundo transportista, producción con cuenta real y bajo
  monto, `application_fee` real, débito de la comisión sin CVV para MOVO-37); pasar el ADR a
  "aceptado" y pegar su desarrollo completo en Drive.

### MOVO-311 — Cobrar la deuda en el `application_fee` del próximo hold (DD-044)

Al crear un hold se cobra la deuda de la cuenta corriente de las dos partes, cada una con tope `DEBT_COLLECTION_MAX_RATE`
(0.3 del precio): la del transportista sube el fee, la del emisor sube el monto y el fee (este último menos el estimado de la
comisión de MP sobre el recargo, que absorbe Movo). Cálculo puro en `src/modules/holds/debt-collection.ts`; flujo y ejemplo en
`flujo-de-pagos.md` §6.1. Migración `20261016200000_hold_debt_collection`.

- **Montos fijados una vez por intento** en `holds` (`base_amount_ars`, `commission_ars`, `debt_offset_ars`, `debt_surcharge_ars`):
  `amount_ars` pasa a ser lo cobrado. `sameTerms` compara contra `base_amount_ars` (shipments siempre manda el precio) y un
  `creating` reintentado reusa los montos guardados, así la misma key siempre lleva el mismo cuerpo.
- **Reserva en la transacción del alta** (`hold-repository#createAttempt` recibe un `plan`): advisory lock por usuario (en orden),
  lectura del saldo cobrable, insert del hold y de los movimientos `reserved` negativos (`<tipo>:<holdId>`). Dos holds en paralelo del mismo
  usuario no descuentan la misma deuda.
- **Tres lecturas del saldo** (`user-ledger-repository.ts`, revisión de la PR #266): `readLedgerBalance` (el que se informa y mide el bloqueo
  de MOVO-313) NO descuenta las reservas negativas, así un hold en curso no destraba a nadie; `readBalanceNetOfReservations` las descuenta
  (máximo de "Pagar mi saldo") y `readCollectableBalance` descuenta además los pagos de saldo abiertos (lo que usa el hold). El pago de saldo
  abre su intento con el mismo lock (`attempts.insertOpen`, que ahora valida el monto bajo el lock y devuelve el intento abierto si ya hay uno).
- **`expectedTotalArs`**: `CreateHoldRequest` lo acepta; si el total que corresponde al abrir el intento (leído bajo el lock) difiere, 409
  `HOLD_AMOUNT_CHANGED` con `details.totalArs` y no se crea fila ni reserva (`HoldAmountChangedError`). También se compara al reintentar un
  `creating` con los montos ya fijados.
- **Anulación por trigger** (`holds_void_debt_reservations`): todo paso a `rejected`/`cancelled` anula las reservas del hold, por
  cualquier camino (creación, liberación, `?sync`, webhook). **Captura**: `splitRetainedFee` reparte lo que retuvo MP y
  `user-ledger-repository#settleHoldDebt` asienta antes de acreditar la liquidación (`commission_ars` queda solo la comisión).
  Si la reserva ya estaba anulada (el hold pasó por `cancelled` y MP igual capturó) o MP retuvo otro monto, inserta
  `<tipo>:settle:<holdId>` con `createMany({ skipDuplicates })`: dentro de la transacción un P2002 la abortaría.
- **El transportista no ve el recargo del emisor**: al acreditar, `capture.service` calcula UNA vez la vista del transportista
  (`carrierPaymentView` de `@movo/shared`: bruto = precio, fee de MP sin la parte del recargo) y la guarda en
  `settlements.carrier_gross_amount_ars`/`carrier_mp_fee_ars` (migración `20261016220000`, con backfill). El historial y
  `GET /shipments/:id/settlement` las leen, nadie reconstruye. Si la comisión real de MP sobre el recargo difiere del 4,99% estimado,
  la diferencia cae en el fee de MP que ve el transportista. El reintegro y los movimientos que ve el transportista se topan en el precio.
- **Límite conocido**: un reintegro o contracargo del pago que cobró deuda no repone la deuda (DD-044).
- `MP_TRANSACTION_FEE_RATE` está en el `envSchema` (0 a 1): `@movo/shared` la lee de `process.env`, y un `4.99` en vez de `0.0499` corta el arranque.
- Si cobrador y pagador fueran la misma persona (shipments no lo permite), el saldo se cobra una sola vez, como cobrador.
- `checkout-data` acepta `payerUserId` y devuelve la vista previa; `POST /internal/payments/users/:userId/debt-collection/preview`
  da el descuento del transportista por precio (para el "Recibís aprox."). El historial suma `debtOffsetArs` al desglose.

Pendiente: correr `test/debt-collection.sandbox.test.ts` (escrito, sin correr por falta de las credenciales
`MP_SANDBOX_CARRIER_*`), y la captura parcial de MOVO-307, que con deuda en el fee tiene menos margen antes del `4201`.

### MOVO-315 — Datos para la cuenta corriente mobile

**Cuenta cobradora por credenciales (DD-048)**: `balance-payment.service.ts` deja de leer la cobradora de
`carrier_mp_accounts` (usuario interno + `MOVO_COLLECTOR_USER_ID`) y la toma de `MP_COLLECTOR_ACCESS_TOKEN`/`_PUBLIC_KEY`/
`_MP_USER_ID` (`plugins/balance-payment.ts#collectorFromConfig`, las tres o ninguna). Verificado contra el sandbox el 17/10:
los tokens de la app sin login no pueden crear pagos (403/401), el `TEST-` del OAuth de la cuenta de prueba Movo S.A. sobre su
propia app sí, con tarjeta completa y con tarjeta guardada + CVV; `test/balance-payment.sandbox.test.ts` pasa con esas
credenciales. El token de dev se obtiene y renueva con `scripts/collector-oauth.mjs`.

`GET /payments/balance` agrega `originLabel` a los movimientos: resuelve el destino del envío en lote por la ruta interna de shipments y la tarjeta usada en pagos voluntarios. Si shipments no responde, el saldo sigue disponible sin esa etiqueta. `POST /payments/balance/debt-preview` expone al usuario autenticado la misma estimación de descuento que ya usaba el backend. La presentación y el pago desde la app están en la rama mobile de MOVO-315.

### MOVO-211 — Marca y últimos 4 de la tarjeta en `HoldDetailResponse`

Las columnas (`card_brand`/`card_last4`) y su lectura de la respuesta de MP las trajo MOVO-302 (historial de pagos);
MOVO-211 expone `cardBrand`/`cardLast4` en `HoldDetailResponse`/`toHoldDetailResponse`, solo para
`GET /by-shipment`. Crear y liberar siguen devolviendo `HoldResponse` sin datos de tarjeta. `svc-shipments`
le muestra al emisor la tarjeta del intento; nunca el BIN ni el token.

### MOVO-303 (ampliación) — Pagos de saldo y deuda en el historial de transacciones

`GET /payments/transactions[/:id]` con `role=sender` suma, además de los holds, los **pagos de saldo aprobados**
(`balance_payment_attempts`, MOVO-312) con `UNION ALL` en `transaction-repository.ts` (`approvedBalancePayments`), de modo que
paginación por cursor, filtros de fecha y de estado siguen siendo una sola consulta. Contrato en `@movo/shared` (`TransactionKind`):
`kind` (`shipment` | `balance_payment`), `shipmentId` nullable y `debtAmountArs` (recargo por la deuda del emisor dentro de lo que pagó,
salvo hold liberado; descuento al transportista, solo con la liquidación acreditada, igual que el `breakdown`).

- Un pago de saldo solo aparece **aprobado** y siempre es `completed`: `creating`/`pending`/`rejected`/`failed` no movieron plata, y no
  se agregó un estado nuevo al contrato. Sin reembolsos ni disputas (los eventos de MP se registran por hold). El transportista no los ve.
- Índice nuevo `(user_id, created_at DESC, id DESC)` en `balance_payment_attempts`. `deriveTransactionStatus` y `STATUS_CASE` (espejo SQL)
  reciben `kind`; la integración verifica que coincidan.
- Fuera de alcance: el resumen "Cobrado en el mes / Por acreditar" y la penalidad del emisor como fila propia (MOVO-308).

### MOVO-303 (ampliación) — Tarjeta guardada y liberación en el detalle

`TransactionCard` suma `alias`, `issuerName` y `paymentType`, que salen de la tarjeta guardada del hold (`LEFT JOIN saved_cards` por
`holds.saved_card_id`; marca y últimos 4 también caen a los de la tarjeta si MP todavía no los informó). `TransactionDetail` suma
`releasedAt` y `releaseReason` (`expired` cuando MP lo confirma, `null` si no se conoce el motivo), solo con el estado `released`.

- **`holds.released_at` la fija un trigger** (`holds_set_released_at`) al insertar un hold ya cancelado o la primera vez que `status` pasa a `cancelled`, y no el código:
  un hold se cierra desde varios lugares (liberación explícita, webhook de MP, vencimiento) y `updated_at` no sirve porque cambia
  con cualquier update posterior. Los ya cancelados se rellenaron con su `updated_at`, que es aproximado.

### MOVO-308 — Filtro por envío en el historial de transacciones

`GET /payments/transactions` acepta `shipmentId` (uuid, opcional): las reservas de un envío, más de una si hubo reintentos del hold, con la misma visibilidad por rol que el listado. Lo usa la card "Tu pago" de un envío cancelado en el mobile para mostrar cuánto se reservó y con qué tarjeta (la tarjeta solo viaja con `role=sender`). Archivos: `transactions.schema.ts`/`.routes.ts`/`.service.ts` y `transaction-repository.ts`.

### MOVO-294 — Cuenta corriente y Mercado Pago en la ficha del panel

- `GET /internal/payments/users/:userId/admin-ledger`: la página de la cuenta corriente sin enmascarar `reason` y con
  `adminId` (la de la app los oculta). `GET /internal/payments/mp-connect/:userId/admin-summary`: el `{ linked }` de
  DD-036 no alcanzaba. Distingue `revoked` (el transportista revocó el acceso: tiene que volver a vincular) de
  `expired` (el token venció sin renovarse: falla del refresh de Movo, MOVO-243), porque soporte actúa distinto.
- El ajuste manual (`.../manual-adjustments`) devuelve también `balanceArs` y responde 422 `AMOUNT_OUT_OF_RANGE` con
  cero o por encima de `ADMIN_LEDGER_ADJUSTMENT_MAX_ARS` (env nueva, default 500000, en los tres lugares).
  `svc-admin` prefija la key del panel (`admin-adjustment:<uuid>`) porque la `idempotencyKey` es única entre todos los movimientos.

### MOVO-213 — Reintentos de la captura y escalado a proceso manual

Una entrega cuya captura falla ya no queda a la deriva: `settlements` guarda `attempts`, `next_attempt_at`, `last_error`, `escalated_at` y
`escalation_reason` (migración `20261022120000_settlement_retries`; el valor `escalated` del enum ya existía).

- **Política** (`capture-failure.ts`, `SETTLEMENT_RETRY_DELAYS_MINUTES`, default `5,30,120`): intento inicial + 3 reintentos; el largo de la lista es el máximo.
  **Reintentable**: red/timeout, 408/429/5xx, estado de pago inesperado, fallo de `getPayment`. **No reintentable** (escala sin gastar intentos): hold
  vencido o cancelado, cuenta del transportista desvinculada o credenciales rechazadas (401/403) y cualquier otro 4xx de MP. Agotados los reintentos → `escalated`.
- **Quién reintenta**: el barrido propio `capture-retry-sweep` (`registerSweep`, lock `locks:capture-retry-sweep`, cada minuto) toma las entregas `failed` con
  `next_attempt_at` vencido, las reserva con un lease (UPDATE condicional) y llama a `capture(..., { retryJob: true })`. Otro pedido de captura (el barrido de
  `svc-shipments`, que sigue de red de seguridad) NO adelanta un reintento programado: responde `409 SETTLEMENT_RETRY_PENDING`, y una escalada responde
  `409 SETTLEMENT_ESCALATED` (permanente para el barrido de shipments). La penalidad (`cancellation_penalty`) no entra en nada de esto: la sigue manejando shipments.
- **AC3 (idempotencia)**: desde el segundo intento, antes de capturar se consulta el pago (`Payment.get` con el token del transportista). `approved` → se adopta y se
  completa la liquidación sin volver a capturar (un timeout no significa que no capturó); `cancelled` → `hold_expired`; si no se puede consultar, el intento falla y se
  reprograma (no se captura a ciegas). La key `movo-hold-capture-<holdId>` se mantiene. Un fallo al leer el desglose tras capturar ahora es un fallo reintentable
  (`failed`), ya no queda `processing` esperando que alguien vuelva a llamar.
- **AC8 (decisión que cambia MOVO-212)**: `hold.expires_at` se compara contra `now` antes de cada intento y un hold vencido escala. En el primer intento
  (la liquidación no existía) sin llamar a MP; si ya hubo un intento anterior, primero se consulta el pago, porque ese intento pudo haber capturado y perder la
  respuesta (review de PR #290): `approved` se acredita aunque `expires_at` haya pasado, y solo un pago aún sin capturar se escala como vencido. Es el piso
  conservador de DD-050 (5 días; la doc de MP también dice 7): se puede escalar un hold que en MP seguía vivo, y por eso la alerta y el listado traen `holdExpiresAt`
  para probar la captura a mano. Un hold ya `captured` no se descarta por la fecha. El sandbox no vence holds (DD-050), así que el test es sintético; la detección
  posterior (MP rechaza o el pago está `cancelled`) se apoya en `status`, no en `status_detail` (sin confirmar).
- **Escalado** (`settlement-escalation.ts`): alerta `settlement_escalated` por el `AlertNotifier` de MOVO-268 (`app.alerts` se resuelve recién al escalar, porque lo decora un
  plugin posterior) y aviso a `svc-shipments` (`POST /internal/shipments/:id/settlement-events {event:"delayed"}`) para el push "Tu cobro está demorado" con el plazo
  `SETTLEMENT_REVIEW_SLA_HOURS` (shipments, default 48). Los dos son best-effort e independientes. Si un reintento acredita, avisa `{event:"credited"}` y shipments pasa el
  envío a `completed`. Un aviso perdido no se reintenta: la alerta y el listado cubren el caso, y el barrido de shipments igual completa los acreditados.
- **Consulta (AC6)**: `GET /internal/payments/settlements?status=failed|escalated&limit&cursor` (interno, keyset por `updated_at,id`, solo entregas: la penalidad `failed` es de shipments); el proxy en `svc-admin` queda para MOVO-33.
  Re-vincular la cuenta de MP reabre una escalada por `carrier_account_unavailable` en el próximo pedido de captura; el resto lo resuelve una persona.
- **Pendiente / fuera de alcance**: refresco del token antes de capturar (MOVO-243), una acción manual de reintento o cierre desde el panel (MOVO-33) y reembolsos.

### MOVO-285 — Fee real de Mercado Pago en el hold

- `payments.holds.mp_fee_ars` (migración `20261024120000_hold_mp_fee`): el `mercadopago_fee` que MP informa al crear el hold
  (`charges_details`, `amounts.original`: verificado contra el sandbox, el pago de $1.150 trae $47,15) y, tras capturar, el de
  `fee_details` (la captura lo reemplaza vía `markCaptured`). `utils/payment-fee.ts` es la única definición de la regla de
  `fee_details` (`splitCollectorFees`, en `Decimal`): la usan el hold y `readFeeBreakdown` de la liquidación, así la columna no
  tiene dos significados. Crear, consultar y webhook completan el fee; el webhook y la consulta con `sync` lo hacen aunque el estado
  no cambie (`missingFeeField`, igual que la tarjeta) y sin pisar uno ya guardado.
- `HoldResponse.carrierMpFeeArs`: ese fee sin la parte que cae sobre el recargo del emisor (`carrierPaymentView`, ahora acotado en
  0, y `splitRetainedFee`, movido a `holds/retained-fee.ts`: la misma regla que la liquidación). `null` si MP no lo informó. Los
  schemas de respuesta de Fastify tienen que declararlo o lo descartan en silencio (los tests unitarios no lo ven: las pruebas
  de sandbox sí). La captura (`net_received_amount` + `fee_details`) ya se guardaba en `Settlement` desde MOVO-212.
- Pendiente: la calibración de `MP_TRANSACTION_FEE_RATE` (el sandbox cobra 4,1 % sin variar con las cuotas, la estimación usa 4,99 %).

### MOVO-336 — Reembolso de un pago ya capturado

`POST /internal/payments/settlements/by-shipment/:shipmentId/refund` (+ `GET .../refunds`), interno como la captura. Solo sobre una liquidación `credited`
(`409 SETTLEMENT_NOT_REFUNDABLE`); el tope es lo capturado menos los intentos `processing`/`succeeded`/`fallback_to_ledger` (`422 REFUND_AMOUNT_EXCEEDS_REFUNDABLE`
con `details.refundableArs`). Tabla `payments.refunds`, una fila por **intento** (`refund-repository.ts`, `modules/settlements/refund.service.ts`): la reserva toma un
`FOR UPDATE` sobre la liquidación, así dos pedidos a la vez no reservan de más. El `<n>` de `movo-refund-<settlementId>-<n>` es el intento: reintentar uno `processing`
reusa su key de MP (no devuelve dos veces) y uno `failed` abre un intento nuevo, porque MP cachea el rechazo de la key anterior.
- **`idempotencyKey` obligatoria del llamador y `adminId` en el body** (decididos con el equipo; el ticket solo pedía `amountArs?` y `reason`): la key distingue un reintento de un
  segundo parcial del mismo monto (MOVO-337 manda `dispute-<id>`; misma key con otro monto o motivo es `409 REFUND_IDEMPOTENCY_CONFLICT`), y el `adminId` es el autor del
  `manual_adjustment` del fallback, porque `user_ledger_entries` exige `admin_id` en ese tipo (CHECK de MOVO-309).
- **Saldo insuficiente (AC4)**: no se reintenta contra MP; el monto queda como deuda del transportista (`manual_adjustment` positivo, idempotente), el intento en
  `fallback_to_ledger` y alerta `refund_fallback_to_ledger`. **El emisor no cobró**: devolverle la plata es un caso manual, no hay forma automática. Sigue contando contra el tope.
  Un error de red, 5xx, 408/409/429 deja el intento `processing` (nunca `failed`: MP pudo haberlo hecho y reintentar duplicaría) con alerta `refund_unconfirmed`;
  un rechazo o credenciales inutilizables, `failed` con alerta `refund_failed`. Un 2xx sin estado se toma por hecho, por la misma razón.
- El body rechaza claves desconocidas (`preValidation`, como la captura): Ajv las borra y un `amount` mal escrito reembolsaría el total.
- **Historial (AC6)**: `has_refund`, `refundedAmountArs` y los movimientos suman los intentos `succeeded` de `payments.refunds` (un `fallback_to_ledger` no cuenta). **Webhook (AC7)**:
  un reembolso de MP que explican los intentos propios `processing`/`succeeded` no se registra como evento ni alerta (`refund_initiated_by_movo`); si MP informa más, el resto sigue siendo externo.

- **Review de PR #314**: (1) un intento que ya pudo haber llegado a MP (el reintento de un `processing`) no se cierra como `failed` por credenciales vencidas ni por un 401: sigue
  `processing`, se alerta y el siguiente reintento reusa su key de MP; abrir el intento siguiente lo habría repetido. (2) Un 4xx que no se reconoce como falta de saldo queda `failed` con
  `provider_rejected` y alerta propia `refund_rejected_unrecognized` (con el mensaje y las causas de MP): mientras el Paso 0 no confirme el código, puede ser saldo insuficiente sin la deuda asentada.
  (3) El webhook promueve a `succeeded` los `processing` que MP informa devueltos (`promoteConfirmed`, con cualquier estado del pago: un parcial lo deja `approved`). (4) Un reintento toma el intento
  con `claim` (atómico; `409 REFUND_IN_PROGRESS` al otro, sin llamar a MP) y no reintenta uno de más de 12 h (`409 REFUND_NEEDS_REVIEW` + alerta): la doc de MP no dice cuánto recuerda la key
  (se cree ~24 h), 12 h es un margen. (5) TODO del Paso 0 sobre el monto bruto del fallback. (6) El historial toma `GREATEST(propio, evento de MP)` y la fecha del movimiento es `completed_at`
  (migración `20261025140000_refund_completed_at`).

Pendiente: **el Paso 0 no se corrió** (necesita las credenciales del sandbox): `test/refund.sandbox.test.ts` lo cubre y hay que transcribir sus resultados al ticket. De ahí tiene que
salir el código de causa de "saldo insuficiente" que falta en `INSUFFICIENT_BALANCE_CAUSES` (`refund-failure.ts`; hoy se reconoce por el mensaje), si MP devuelve el `application_fee`
de Movo y cómo prorratea el parcial (el fallback asienta el monto entero; ajustarlo si MP no devuelve la comisión). Fuera de alcance: el cliente en `svc-shipments`/`svc-admin`
(MOVO-337) y un barrido que retome un intento `processing` sin reintento del llamador (hoy lo cierra el webhook si MP lo informa; si no, queda la alerta y, pasadas 12 h, `REFUND_NEEDS_REVIEW`).

### MOVO-37 — Envíos pagados en efectivo (parte P)

Módulo `cash-payments` con dos endpoints internos bajo `/internal/payments/cash-shipments/:shipmentId`: `commission` (comisión
como `cash_commission` del transportista, calculada con `decomposeOfferGrossPrice`, la misma que el `application_fee`) y
`cancellation-penalty` (penalidad del emisor + `cancellation_compensation` negativo y `settled` al transportista,
`cashPenaltyCompensationArs` de `@movo/shared`: lo mismo que deja la captura parcial con tarjeta). Migración
`20261027200000_cash_shipment_payments`: valor nuevo del enum y la tabla `cash_shipment_payments`, que el historial une como
`kind: cash_shipment` (siempre `completed`, sin tarjeta, desglose con fee de MP en 0).
- Idempotentes por envío con lock advisory + lectura previa en la transacción, en vez de capturar el `P2002`: un error de
  unicidad aborta la transacción de Postgres. Un reintento devuelve lo registrado sin recalcular; con otras partes o monto, 409.
- La penalidad usa la key `penalty:<shipmentId>`, la misma que el camino con tarjeta: un envío es de una sola modalidad.
- P4 no hizo falta: `GET .../balance` ya da la deuda total que mira el tope.

### MOVO-337 — Reemplazo de una liquidación `failed` (disputas)

`capture.service`: un pedido de otro `kind` o monto sobre una liquidación `failed` la reemplaza (`settlements.replaceFailed`) solo si MP confirma que el pago sigue `authorized`/`pending`; si no se puede consultar o está `approved`, sigue siendo `409 SETTLEMENT_CONFLICT`. Así una disputa cuya captura parcial rechazó MP se puede reintentar con otro porcentaje o resultado. La key de idempotencia de la penalidad ahora lleva el monto (`movo-hold-penalty-<holdId>-<monto>`). `svc-shipments` trata `SETTLEMENT_CONFLICT` como incierto (la disputa queda `resolving` con alerta).
- `SettlementKind` suma `dispute_partial` (migración `20261026120000_settlement_kind_dispute_partial`): misma mecánica que `cancellation_penalty` (monto parcial, piso del `application_fee`), key `movo-hold-dispute-<holdId>-<monto>`, pero sin pasar por la lógica de penalidad de MOVO-306. `@movo/shared` suma `PARTIAL_CAPTURE_KINDS`/`isPartialCaptureKind`. El mobile ya no muestra la card de compensación en un envío con disputa parcial (solo la arma para `cancellation_penalty`).
