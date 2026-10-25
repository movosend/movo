# CLAUDE.md — services/movo-svc-admin

Estado de implementación de `movo-svc-admin`. Ver el `CLAUDE.md` de la raíz del repo para
contexto general del proyecto (stack, ADRs, convenciones, git/PR). Entrada corta por US: qué se
hizo, en qué archivos, decisiones no obvias, qué queda pendiente.

## Estado actual de la implementación

### MOVO-288 — Base del servicio: `/admin`, `x-user-*`, Prisma, bitácora y conflicto de interés

Deja la infraestructura común de todas las US de admin (MOVO-32/33/34/35/36/292/294), sin
endpoints de negocio salvo `GET /admin/audit-log`. El panel solo habla con `/admin/*`; este
servicio aplica la regla de conflicto, escribe la bitácora y llama a los endpoints internos del
servicio dueño (decisión 6 de MOVO-286).

- **Identidad por `x-user-*` (ADR-010)**: sin `@fastify/jwt` ni `JWT_SECRET`. El gateway exige
  el rol `admin` en todo `/admin` (que solo entra al JWT en una sesión de panel, MOVO-287);
  `utils/require-admin.ts` lo vuelve a chequear como defensa en profundidad.
- **Prisma con el schema `admin` (ADR-011)**, mismo molde que `svc-payments`. Primera migración
  escrita a mano (`prisma migrate diff --from-empty`): la tabla `admin.audit_log` y un trigger que
  rechaza `UPDATE`/`DELETE`/`TRUNCATE`, así la bitácora es de solo agregar filas en la base y no
  solo por convención. `adminId`/`targetId` sin FK (viven en otros schemas). Los tests no pueden
  limpiar la tabla: se aíslan con un `adminId` aleatorio. Con esto ningún servicio usa ya
  `scripts/run-migrations.sh`, que se borró. **Misma versión de Prisma que el resto de los
  servicios**: si npm la instala anidada en `services/movo-svc-admin/node_modules`, el binario no
  queda en `/app/node_modules/.bin/prisma`, que es la ruta que corre el deploy.
- **`app.audit.runAdminAction(input, action)`** (`modules/audit/audit.service.ts`) es el único
  camino de una escritura del panel: regla de conflicto → acción → **una** fila con el resultado.
  Si la regla o la acción fallan, la fila es `failed` con el código del error y el error se
  relanza: nunca queda `succeeded` algo que no ocurrió (AC5). Un rechazo por conflicto también se
  registra (rastro del intento). **Tercer resultado `unknown`**: si la acción falla con
  `*_SERVICE_UNAVAILABLE` (red, timeout o 5xx del servicio dueño) pudo haberse aplicado igual, así
  que la fila no dice `failed` sino `unknown` (con el `errorCode`) y hay que verificarlo en el
  servicio dueño antes de usarla como evidencia. Un `failed` es siempre un rechazo seguro. Los
  errores de la regla de conflicto son lecturas, así que siguen siendo `failed`. Brecha inversa aceptada: si la acción salió bien y el insert
  falla, se responde el resultado y queda un `error` en el log (`admin_audit_insert_failed`) con
  todo el contexto, porque no hay transacción entre servicios (ADR-001). `action` es texto libre:
  cada US define las suyas (`user.suspend`, `admin_role.revoke`...). `createdAt` lo fija la app en
  ms para que el cursor no saltee filas (gotcha del chat, MOVO-26). **Al cargar a mano una fila
  perdida** (`admin_audit_insert_failed`) hay que fijar `created_at` truncado a ms
  (`date_trunc('milliseconds', ...)`): el `DEFAULT CURRENT_TIMESTAMP` trae microsegundos y el
  cursor de `GET /admin/audit-log` viaja en ms, así que esa fila podría saltearse o duplicarse en
  el borde de una página.
- **Regla de conflicto** (`modules/audit/conflict-of-interest.ts`): `user`/`admin_role` comparan
  ids; `shipment` y `chat_report` consultan a `svc-shipments` y `user_report` a `svc-users` (los
  tres endpoints `/internal/.../parties` nacieron en esta US). Un receptor anterior (transferencia
  o rechazo) cuenta como parte. Falla cerrado: servicio caído → 502; objetivo inexistente → 404 `NOT_FOUND` (mismo código para los cuatro tipos de objetivo).
  Solo aplica a escrituras: leer sí puede.
- **Clientes internos** (`adapters/`): `createInternalClient` es la base (timeout de 5 s,
  `x-request-id` propagado por primera vez en el repo, 404 → `null` solo si el body trae uno de
  los `notFoundCodes` del método (`NOT_FOUND`/`REPORT_NOT_FOUND`); cualquier otro 404, p. ej. la
  ruta que el servicio todavía no tiene en un deploy en serie, es 502 como una caída. Red/5xx/forma
  inválida → 502 `<SERVICIO>_SERVICE_UNAVAILABLE`, otro 4xx se relanza con su código). Cada US suma sus
  métodos en `users-client.ts`/`shipments-client.ts`/`payments-client.ts` (este último todavía
  sin ninguno). Se inyectan con `buildApp({ usersClient, ... })`; fakes en `test/fake-clients.ts`.
- **`GET /admin/audit-log`**: filtros `adminId`, `action`, `targetType`, `targetId`; cursor
  keyset `(createdAt, id)` con `{ items, nextCursor }` (`AuditLogPage` de `@movo/shared`), límite
  1-50. Sin UI todavía.
- Env: `USERS_/SHIPMENTS_/PAYMENTS_SERVICE_URL` con default al hostname de Compose (no hizo falta
  tocar `infra/docker-compose.yml`, solo sacar `JWT_SECRET`). `@fastify/env` y el error handler
  (formato `ApiError` + `requestId`) se registran por primera vez en este servicio. Cobertura con
  umbral de 70% de líneas.

Pendiente / fuera de alcance: endpoints de negocio (cada US de admin), UI de la bitácora,
`movo-admin` consumiendo `/admin/*` (MOVO-291), y la primera corrida de `prisma migrate deploy`
de este servicio en dev/prod (su fila vieja en `public.schema_migrations` queda como histórico).

### MOVO-291 — Comprobación de acceso al panel

`GET /admin/session` exige identidad y rol admin (además del gateway) y responde
únicamente `{ authenticated: true }`, sin caché. El BFF lo combina con el perfil actual
para comprobar una sesión de panel válida junto a cada operación protegida.

### MOVO-292 — Gestión de admins: `GET`/`POST /admin/admins`, `DELETE /admin/admins/:userId`

`modules/admins/` sobre los endpoints internos de MOVO-290 (`users-client.ts`: `listAdmins`,
`grantAdmin`, `revokeAdmin`). Otorgar y revocar pasan por `runAdminAction` (`admin_role.grant` /
`admin_role.revoke`, objetivo `admin_role`), así revocarse a uno mismo es 403
`ADMIN_CONFLICT_OF_INTEREST` y queda como `failed`. Revocar exige `reason` (3-500 caracteres) en el body.
Los rechazos de `svc-users` (`USER_NOT_FOUND`, `ADMIN_GRANT_EMAIL_NOT_VERIFIED`, `ADMIN_LAST_ADMIN`...) se
relanzan con su código para que el panel muestre el motivo concreto.

- **Objetivo de la bitácora en `grant`**: el usuario se resuelve recién dentro de `svc-users` y
  `runAdminAction` pide el objetivo de antemano, así que la fila arranca con el email. `resolveTarget`
  (opcional en `AdminActionInput`) lo reemplaza por el id si la acción sale bien, igual que el revoke, y
  el email queda siempre en `context`. Una fila `failed` conserva el email como `target_id`, por eso el
  filtro `targetId` de `GET /admin/audit-log` admite 254 caracteres. Otorgarse el rol a uno mismo es un
  no-op idempotente, no un conflicto.
- Las rutas usan `request.requestId` (el `x-request-id` del gateway), no `request.id` (el contador de Fastify).
- `internal-client.ts` acepta un 204 sin cuerpo: `isValid(undefined)` decide si es una respuesta válida
  (antes cualquier 204 era "respuesta inválida" → 502).
- Pendiente: verificar a mano contra dev que el admin revocado pierde el acceso en su próxima acción
  (necesita `svc-users`/`svc-admin` desplegados); pantalla de la bitácora (fuera de alcance).

### Autocompletado de candidatos a admin

`GET /admin/admins/candidates?q=` (mín. 2 letras, solo rol admin) → `GET /internal/admins/candidates` de
`svc-users` (`searchCandidates` en `admin-roles.service.ts`): nombre o email, sin cuentas dadas de baja,
máx. 8, con `emailVerified`/`isAdmin`/`status` para que el panel deshabilite a quien no se puede elegir.
Tipo `AdminCandidate` en `@movo/shared`. Sin bitácora: es una lectura.

### MOVO-294 — Búsqueda de usuarios, ficha y acciones de soporte

`modules/users/`: `GET /admin/users` y una ruta por sección de la ficha (`/:id`, `kyc`, `vehicle`, `shipments`,
`trips`, `ratings`, `moderation`, `suspensions` —vacía hasta MOVO-36—, `ledger`, `devices`, `audit-log`, `notes`),
cada una contra su servicio dueño. `/kyc` suma `svc-payments` para la tarjeta de MP, pero si pagos cae solo esa
tarjeta queda en `null` (review de PR #279): el KYC de identidad no depende de pagos. Acciones por `runAdminAction`:
`user.sessions_revoke`, `user.contact_update`, `user.ledger_adjust` (un reintento con la misma key queda con
`repeated: true`, no como un segundo ajuste) y `user.note_add`. Clientes nuevos en los tres `adapters/`.

- **Nombres best-effort**: los servicios dueños solo tienen ids; `svc-admin` los resuelve con `POST
  /internal/admin/users/names` y, si `svc-users` no responde, usa `"Nombre no disponible"` en vez de romper la sección.
- **`runAdminAction` suma `precheck`** (lectura previa tras la regla de conflicto; si falla, la fila es `failed`, no
  `unknown`): el ajuste de saldo y las notas verifican ahí que el usuario exista (`USER_DELETED` para el ajuste),
  porque `svc-payments` no lo sabe. **`resolveContext`** agrega datos que solo se conocen al terminar (`noticeFailed`, `noteId`).
- **Tabla `admin.admin_user_notes`**, de solo agregar (trigger contra `UPDATE`/`DELETE`; sin el de `TRUNCATE`, para
  que los tests puedan limpiarla). Cursor `(createdAt, id)` en ms, el mismo de la bitácora.
- **Datos personales en tablas de solo agregar** (review de PR #279): la bitácora y las notas sobreviven a la baja de
  la cuenta (`anonymizeAndDelete` solo limpia `users`). Por eso `user.contact_update` guarda el valor anterior y el
  nuevo enmascarados (`utils/mask-contact.ts`), nunca completos. Las notas son texto libre que escribe un admin:
  **limitación aceptada**, no se pueden anonimizar sin perder que sean de solo agregar. La convención es no copiar
  datos personales en ellas (el dato vigente se mira en la ficha).
- La bitácora del usuario solo mira `targetType=user` (las filas `admin_role.*` sobre la misma persona no aparecen).

Pendiente: primera corrida de la migración de notas en dev/prod (`prisma migrate deploy` del deploy).

### MOVO-325 — Envíos para el panel: `GET /admin/shipments`, `/admin/shipments/:id`, `/admin/shipments/:id/chat/messages`

`modules/shipments/` (backend de MOVO-33; la pantalla es MOVO-326). Exige rol admin y es **lectura pura: sin bitácora ni regla de conflicto**. El listado y el chat se pasan tal cual de `svc-shipments` (`/internal/admin/shipments*`, ver su `HISTORIAL.md`); la query se valida acá y se reenvía.

- **Detalle por bloques** (`AdminShipmentDetailResponse`): `shipment` es obligatorio (404 si no existe, 502 si `svc-shipments` cae); `events` y `photos` (`svc-shipments`), `payment` (`svc-payments`, hold) y `parties` (`svc-users`, `GET /internal/users/party-cards`, una ficha por rol) son `AdminBlock`: `{ data, error: null }` o `{ data: null, error: { code, message } }`, así un servicio caído no tumba el resto. `payment.data` en `null` **sin error** = nunca se intentó el pago. El schema de `payment` es una lista cerrada de campos de `HoldDetailResponse` (no un objeto libre): un campo sensible nuevo en svc-payments no llega al panel sin sumarlo acá. Los bloques se piden en paralelo.
- Clientes: `shipments-client.ts` (5 métodos nuevos), `users-client.ts#getPartyCards`, `payments-client.ts#findHoldByShipment` (primer método de ese cliente). Fakes en `test/fake-clients.ts`.
- Los esquemas de respuesta tienen `data` nullable en los bloques: sin eso Fastify serializaba `null` como `[]`.

Pendiente: el detalle del pago solo trae el hold (captura/reembolso viven en liquidaciones de `svc-payments`); `disputeId` es siempre `null` hasta MOVO-34.

MOVO-326 suma a `GET /admin/shipments` el filtro `alert` (booleano) y, en la respuesta, `statusCounts` y `alertCounts`; se
validan en `shipments.schema.ts` y se reenvían tal cual (ver `svc-shipments/HISTORIAL.md`).

### Ofertas del envío en el detalle

`GET /admin/shipments/:id` suma el bloque `offers` (`AdminBlock<AdminShipmentOffer[]>`), pedido en paralelo a
`GET /internal/admin/shipments/:id/offers` de `svc-shipments` (`shipments-client.ts#getAdminShipmentOffers`). Va como bloque y no
como ruta propia, así no hace falta tocar el gateway; si `svc-shipments` todavía no tiene la ruta (deploy en serie), el 404 sin
`NOT_FOUND` es 502 y solo ese bloque viene con error. Schema de respuesta con la lista cerrada de campos de la oferta.

### MOVO-327 — Seguimiento del envío: `GET /admin/shipments/:id/tracking`

Pasa tal cual el `AdminShipmentTracking` de `svc-shipments` (`shipments-client.ts#getAdminShipmentTracking`; el cálculo está en su
`HISTORIAL.md`) con rol admin, sin bitácora ni regla de conflicto y con `Cache-Control: no-store`, porque el panel (MOVO-328) lo pide
por polling. Es ruta propia y no un bloque del detalle, así el polling no vuelve a pedir el detalle entero; el gateway no se toca porque
rutea `/admin/*` por prefijo. El schema declara nullable cada campo que puede venir en `null`. Deploy en serie: hasta que `svc-shipments`
tenga la ruta, es 502.

### MOVO-332 — Cambio de estado de un envío desde el panel (DD-055)

`modules/shipments/shipments.routes.ts` suma cuatro rutas: `GET /admin/shipments/:id/status-options`, `POST /admin/step-up`,
`POST /admin/step-up/verify` y `POST /admin/shipments/:id/status`. La lógica de transición es de `svc-shipments`
(`POST /internal/admin/shipments/:id/force-status`, MOVO-331); acá van la regla de conflicto, la bitácora, el segundo factor y los límites.

- **`status-options`** sale solo de la matriz de `@movo/shared` (`getForcedTransitionDetails`, `forcedTransitionFriction`,
  `blockedTransitionReason`): el panel no calcula nada. Devuelve también el código del envío que hay que tipear. Lectura, sin bitácora.
- **`POST .../status`** es `runAdminAction` (`shipment.status_change`). Las validaciones (motivo ≥ 20, `expectedStatus`, par permitido,
  `typedCode`, falta de `stepUpToken`, **validación sin gastar** del token, identificar al admin) van en el `precheck`: corren después de la regla de
  conflicto y, como son lecturas, la fila es `failed` aunque otro servicio no responda. `forceShipmentStatus` va en la acción y **el token se gasta
  después**, solo si el cambio se aplicó o no se sabe (un rechazo de negocio no lo quema, review de PR #305). El nombre del admin falla cerrado (502).
- **Idempotencia** (`status-change-records.ts`, Redis, 24 h, por admin + envío + clave): `done` devuelve la respuesta con `replayed: true` antes del rate
  limit y sin fila nueva; `unknown` (svc-shipments no respondió) hace que el reintento no pida el token ni compare `expectedStatus` y vuelva a
  `svc-shipments`, que resuelve el replay. Otra clave de destino distinto: 409 `IDEMPOTENCY_KEY_REUSED`. Guardar el registro es best-effort.
- **`POST /admin/step-up`** exige que el envío exista y que el par esté en la matriz y pida segundo factor (404/422/400); no manda un email por cualquier par.
- **Un 429 del rate limit deja una fila por admin y envío por ventana** (flag `NX` de 60 s en Redis), no una por rechazo.
- **Bitácora: una fila por intento** (salvo los 429, ver abajo), rechazos incluidos. El "antes y después" del ticket (AC5) lo cubre `unknown`: la tabla es de solo agregar
  filas (trigger), así que no hay una fila previa. Detalle en el DD-055.
- **`internal-client.ts` ahora propaga `details`** de un 4xx (antes se descartaban), y tiene `relayServerErrorCodes`: `FORCE_STATUS_EFFECT_FAILED` es
  un 502 de negocio que no debe leerse como "servicio caído" (la fila sería `unknown`, y es un `failed`). Los schemas de error de
  `shipments.schema.ts` declaran `details`: sin eso Fastify los recortaba y el panel no podía explicar `STATUS_CHANGED`/`TRANSITION_NOT_ALLOWED`.
- **Rate limit** (`utils/rate-limit.ts`, ventana fija en Redis): 10 cambios/min por admin y 5/min por envío; cuenta también los intentos
  rechazados y se aplica antes de la bitácora (un 429 no deja fila). El `forceShipmentStatus` espera hasta 30 s (el servicio llama a payments).
- Pendiente: el modal del panel (MOVO-333); probar contra dev real que el email del step-up llega (Resend).
