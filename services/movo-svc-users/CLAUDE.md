# CLAUDE.md — services/movo-svc-users

Estado de implementación de `movo-svc-users`. Ver el `CLAUDE.md` de la raíz del repo
para contexto general del proyecto (stack, ADRs, convenciones, git/PR). Entrada corta
por US: qué se hizo, en qué archivos, decisiones no obvias, qué queda pendiente.

## Estado actual de la implementación

### MOVO-70 — `POST /auth/register` (`svc-users`)

`src/modules/auth/`. Hash con `@node-rs/argon2` (binarios prebuilt, portable entre SO
del equipo). Teléfono normalizado a E.164 AR. Duplicados (409) resueltos traduciendo
la violación de índice único de Postgres, no con un SELECT previo (evita carrera).
`dni`/`address` y verificación de teléfono se movieron a US posteriores (MOVO-71/73).

### MOVO-85 — Plugin `fastify.db` (Postgres)

`src/plugins/db.ts`. `search_path` fijado vía connection param (no `SET` en el evento
`connect`, evita carrera con la primera query del caller). `statement_timeout`/
`query_timeout` en el `Pool` — sin esto, un Postgres colgado (no caído) agota el pool
con healthchecks que nunca sueltan el cliente.

### MOVO-87 — `user-repository`

`create`/`find*`/`updateKycStatus*`, transacción única para usuario+roles.
`InvalidEnumValueError` (un valor de enum sin equivalente en `@movo/shared` es drift
de schema, no un error transitorio) y `PublicUser`/`toPublicUser()` (DTO explícito
campo por campo, nunca spread, para que agregar un campo a `User` obligue a decidir si
es público).

### MOVO-91 — Alinear enums de `users.users` con `@movo/shared`

Migración `ALTER TYPE ... RENAME VALUE` (preserva datos). Reemplaza la capa de mapeo
enum DB↔dominio de MOVO-87 por el mismo string en ambos lados. Se conservó la
validación (`parseUserRole`/`parseKycStatus`, tiran `InvalidEnumValueError`) en vez de
un cast directo — los roles gobiernan autorización (ADR-004), un valor de Postgres sin
equivalente en `@movo/shared` no debe colarse a los claims del JWT en silencio.

### MOVO-89 — `GET /health`

Compone `checkDbHealth`/`checkRedisHealth` con `Promise.all`. 200 ambas OK, 503 si
falla una, 502 si fallan las dos. El body nunca expone el mensaje crudo del error
(puede filtrar host/user/puerto de la conexión) — se loguea server-side, el schema de
respuesta solo declara `status`.

### MOVO-93 — Prisma como ORM en `movo-svc-users` (ADR-011)

Primer servicio en adoptarlo — los demás lo suman al tener dominio real.
`@prisma/adapter-pg` (Prisma 7 exige driver adapter para providers SQL). Prisma no
modela `search_path` ni expression indexes (`users_email_lower_idx` sigue en la DB sin
representación en `schema.prisma`; se usa `mode:"insensitive"` en su lugar). `prisma`
es dependency (no dev) — la CLI corre dentro del contenedor en deploy, Postgres no
expone puerto público (ADR-010). Gotcha: con el driver adapter, los campos de un
conflicto único (`P2002`) vienen anidados en
`error.meta.driverAdapterError.cause.constraint.fields`, no en `error.meta.target`.

### MOVO-92 — Actualización de la entidad User

`AccountStatus` (`@movo/shared`): `active`/`banned`/`deleted`. Se removieron columnas
KYC obsoletas e `is_banned`; se agregaron `status`/`birthdate`.

### MOVO-71 — Verificación de teléfono por OTP

El OTP se verifica **antes** de crear la cuenta (cambia el contrato original, que lo
pedía después). `otp-repository.ts` (Redis, genérico — reusable para reset de
password), un solo OTP activo por target, código siempre hasheado. Emite un
`phoneVerificationToken` (JWT de un solo uso, TTL 15min) que `register()` consume
(MOVO-72 agregó después `releasePhoneVerificationToken` para reintentos tras un
fallo). `SmsProvider`: `console` (dev/CI), `telegram` (develop), `twilio` (prod,
ADR-012).

### MOVO-74 — `POST /auth/login`

Respuesta plana (sin anidar en `user`). Verificación contra un hash sintético si el
usuario no existe (previene timing attack). Cuenta `banned`/`deleted` → 403. Access
token TTL 60min, refresh en Redis (TTL ver MOVO-75).

### MOVO-75 — Refresh token: rotación de un solo uso + logout/logout-all

Refresh token opaco compuesto `"{userId}.{tokenId}.{secret}"` (permite ubicar la key
en Redis a partir de lo que ve el cliente). Rotación de un solo uso: al refrescar la
sesión vieja queda como tombstone (`used:true`); un refresh reusado revoca todas las
sesiones del usuario (detección de robo). TTL extendido a 90 días (ADR-013). Logout
recibe el refresh token en el body (los claims del access token no incluyen
`tokenId`) y siempre responde 204, incluso con token ajeno/inválido (no filtra info).

### MOVO-72 — Integración con Didit.me (KYC de identidad)

`src/modules/kyc/`, `kyc-verification-repository.ts` (tabla `users.kyc_verification`,
alineada al DER). `POST /kyc/session`, `GET /kyc/status`, `POST /kyc/webhook` —
protegidas (JWT): `register()` pasó a emitir tokens de sesión igual que `login()`, lo
que habilita estas rutas sin necesitar un diseño público aparte. Webhook idempotente
vía `updateMany` condicionado al estado de origen (atómico a nivel DB). Redacción de
PII con whitelist explícita (nunca se persiste el payload crudo de Didit).
`DIDIT_MODE=mock` default (dev/test/CI); `live` valida credenciales al arrancar.
Validado end-to-end contra el sandbox real (firma HMAC, sesión y webhook reales).

### MOVO-15 — Verificación de licencia de conducir

Reutiliza el mecanismo de KYC de MOVO-72 con `verification_type:"license"` (mismo
pipeline, `workflow_id` distinto por tipo en Didit). Tabla nueva
`users.drivers_license` (registro del carnet, ciclo de vida propio — distinto del log
de intentos en `kyc_verification`). Insignia `license_verified` cableada. Pantalla
`license-kyc.tsx` en mobile, desacoplada del wizard de registro (usuario ya logueado,
usa la sesión real vía el interceptor de MOVO-76) — ver
`movo-mobile/CLAUDE.md`.

### MOVO-97 — Foto de perfil: S3 + presigned URLs (ADR-007, ADR-016)

`StorageProvider` (interfaz + `S3StorageProvider`/`MockStorageProvider`). La
presigned URL firma también `content-type`/`content-length` (el cliente tiene que
mandar esos headers exactos o S3 rechaza la firma). La key del objeto se deriva
parseando `photo_url` ya guardado — no hay columna nueva. Credenciales AWS vía IAM
role de la EC2. Bucket real (`movo-shipment-media-dev`) configurado con CORS + policy
de lectura pública acotada a `profile-photos/*` (sin `ListBucket` público) — portado a
Terraform (`movo-infra`), aplicado en dev; prod tiene el código listo pero sin
`terraform apply` corrido todavía.

### MOVO-120 — Proxy de Google Places Autocomplete (`svc-users`)

`POST /places/autocomplete`/`/places/details` sobre `PlacesProvider` (mock default,
`google` real vía `createGooglePlacesProvider`) — mismo criterio que
`GeocodingProvider`/`SmsProvider`. Público a propósito, igual que `/geocode`.

Fixes de review sobre la implementación inicial:
- `details()` distinguía mal los errores de Google: cualquier respuesta no-2xx caía en
  422 `PLACE_NOT_FOUND`, incluida una API key sin habilitar (403) o cuota excedida
  (429) — mostraba "no encontramos esa dirección" para un error de configuración. Ahora
  solo un 404 real mapea a `PLACE_NOT_FOUND` (consistente con el mock provider), el
  resto a 502 `PLACES_PROVIDER_ERROR` (mismo criterio que ya usaba `autocomplete()`).
- `input` de `/places/autocomplete` no tenía `maxLength` — endpoint público sin auth,
  cada request es una llamada facturable a Google; se agregó `maxLength: 200`.
- `sessionToken` opcional threadeado en `PlacesProvider`/rutas/schema: agrupa un
  autocomplete + su details bajo billing por sesión en Places API (New), más barato
  que facturar cada request suelto. El proxy ya lo reenvía si llega; el mobile todavía
  no lo genera (pendiente, ver `movo-mobile/CLAUDE.md`).

### MOVO-119 — CRUD de direcciones guardadas (`/addresses`, `svc-users`)

`users.address` (MOVO-73) pasó de write-only (una fila por registro, nunca marcada
`isDefault`) a libreta de direcciones completa: `GET/POST /addresses`,
`PATCH/DELETE /addresses/:id` en `src/modules/addresses/`.

Decisiones clave:
- **Prefijo propio `/addresses`, no anidado en `/users`**: el contrato del ticket
  define el path externo como `/api/v1/addresses`; mismo criterio que `/kyc`/`/geocode`
  (recurso con identidad propia aunque comparta el servicio de `svc-users`). Requirió
  sumar la entrada a `gateway/src/config/routes-map.ts#getServiceRoutes()` — protegido
  por defecto, sin tocar `getPublicRoutes()`.
- **`isDefault` atómico vía transacción, más índice único parcial de defensa en
  profundidad**: `address-repository.ts` desmarca la default anterior (`updateMany`)
  antes del `create`/`update` dentro de `db.$transaction`, mismo patrón que
  `offer-repository.ts#acceptOffer` (MOVO-102, ver
  `services/movo-svc-shipments/CLAUDE.md`) — sin `SELECT...FOR UPDATE`, confía en
  el row-lock del `UPDATE` bajo READ COMMITTED. Se sumó además
  `address_user_id_default_unique` (índice único parcial `WHERE is_default = true`),
  mismo criterio que AC7 de MOVO-102: la invariante "nunca dos defaults" no depende
  solo de la lógica de aplicación.
- **403 sobre dirección ajena, nunca 404 filtrado**: `addresses.service.ts` resuelve
  ownership antes de delegar a update/delete, mismo orden que
  `shipments.service.ts#getShipmentDetail` (MOVO-80, ver
  `services/movo-svc-shipments/CLAUDE.md`).
- **Migración de backfill sin diff de schema.prisma**: `UPDATE ... SET is_default =
  true` para las filas ya creadas por `POST /auth/register` (hoy 1 por usuario, sin
  conflicto con el índice nuevo) + el índice, escrita a mano, mismo patrón que el
  índice parcial de la migración de `offers` (MOVO-102).

Pendiente / fuera de alcance: consumo desde `movo-mobile` (ticket aparte, el wizard de
envío de MOVO-83 es quien lo necesita); exponer la dirección en `GET /users/me`
(`PrivateProfile`) — no se pidió, el wizard consume `/addresses` directamente.

Tests: `services/movo-svc-users/test/addresses.integration.test.ts` (19 casos, Postgres
real) + 2 casos nuevos en `gateway/test/routes-prefix.test.ts` (`describe("Rutas de
/addresses")`). 37/37 suites / 308/308 tests en `movo-svc-users`, 5/5 suites / 37/37
tests en `gateway`. `tsc --noEmit` limpio en ambos paquetes.

### MOVO-133 — `PATCH /users/me` y cambio verificado de teléfono/email por OTP

`src/modules/users/` pasa de ser solo lectura (+foto MOVO-97, +push token MOVO-106) a
tener su primera escritura sobre los datos propios del usuario: `PATCH /users/me`
(nombre/apellido) y dos flujos de dos pasos cada uno para cambiar teléfono y email.

Decisiones clave:
- **`PATCH /users/me` con `additionalProperties:false` no alcanza contra el
  `removeAdditional:true` default de AJV de Fastify**: mismo gotcha ya documentado en
  `services/movo-svc-shipments/CLAUDE.md` (MOVO-129) — un campo de más (`email`,
  `roles`, etc.) se descarta en silencio en vez de devolver 400. Se agregó un
  `preValidation` que corre antes de esa fase y rechaza explícitamente cualquier clave
  que no sea `firstName`/`lastName`, sin tocar la configuración global de AJV del
  resto del servicio (esa decisión de convención sigue pendiente, igual que en
  `svc-shipments`).
- **Nombre inmutable con KYC de identidad aprobado (AC3, decisión de refinamiento)**:
  `409 PROFILE_NAME_LOCKED_BY_KYC` si `kyc_status_identity=approved` y el `firstName`/
  `lastName` nuevo difiere del actual — el nombre ya quedó validado contra el
  documento por Didit (MOVO-72), permitir cambiarlo después rompería esa garantía.
  Reenviar el mismo nombre no cuenta como cambio (PATCH idempotente sigue permitido).
- **Cambio de teléfono reusa `otp-service.ts` directo, no
  `phone-verification.service.ts`**: ese servicio es específico del registro (emite un
  `phoneVerificationToken` intermedio de un solo uso, MOVO-71/72) porque en ese punto
  todavía no hay cuenta ni sesión. Acá el caller ya está autenticado, así que verificar
  el OTP persiste `phone`+`phoneVerified=true` directo, sin el token intermedio. El
  `target` del OTP **es** el teléfono nuevo (prueba de posesión).
- **Cambio de email verificado con OTP al teléfono ACTUAL, no al email nuevo
  (decisión de refinamiento, se aparta de la letra del AC original)**: el proyecto no
  tiene ningún `EmailProvider` (sin nodemailer/SES/Resend, sin columna
  `email_verified`) — construir uno es alcance de ADR nuevo, no de este ticket. Se
  verifica la identidad del dueño de la cuenta mandando el OTP a su teléfono ya
  verificado. El email candidato viaja en Redis atado al `otpId`
  (`pending-email-repository.ts`, mismo TTL que el OTP) hasta que el verify lo
  persiste. **Corregido por MOVO-139** (ADR-017): con `EmailProvider` en el proyecto, el
  OTP pasó a ir al email nuevo y el aviso al email anterior existe — ver la entrada de
  esa US más abajo. No revoca sesiones (el email no es credencial de sesión, a
  diferencia de la contraseña — ver ticket hermano MOVO-134).
- **Unicidad de email case-insensitive resuelta en el service, no en la DB**: el
  índice único real de `users.email` es case-sensitive (MOVO-93: `users_email_lower_idx`
  es funcional, no fuerza unicidad) — un `P2002` del `UPDATE` final solo cubre
  colisiones de mismo casing exacto. El chequeo case-insensitive real
  (`findByEmail`, ya usaba `mode:"insensitive"`) corre explícito tanto en el paso 1
  como de nuevo justo antes del `UPDATE` del paso 2, para cubrir la carrera de
  unicidad (AC5) sin depender de un constraint que no existe a nivel de DB.
- **`UserConflictError` (ya existía para el registro, MOVO-70) reusada tal cual** para
  las colisiones de `updatePhone`/`updateEmail` -- se traduce a los códigos nuevos
  `PHONE_ALREADY_IN_USE`/`EMAIL_ALREADY_IN_USE` (@movo/shared), distintos de
  `USER_PHONE_ALREADY_EXISTS`/`USER_EMAIL_ALREADY_EXISTS` del registro porque el
  mensaje/contexto es otro (cambiar un dato de una cuenta existente, no crearla).

Tests: `test/users.profile-edit.integration.test.ts` (28 casos, Postgres+Redis reales,
mismo patrón de `SmsProvider` captor que `auth.otp.integration.test.ts`) cubriendo las
8 AC del ticket, incluida la carrera de unicidad de teléfono/email simulada
adelantando el `UPDATE` de otro usuario entre el paso 1 y el verify.

Pendiente / fuera de alcance: consumo desde `movo-mobile` (ticket aparte); cambio de
contraseña y baja de cuenta (ticket hermano MOVO-134); `birthdate`/`dni` (existen en
el schema, no se editan por ningún endpoint todavía).

**Fixes de review sobre la implementación inicial (tmvergara, PR #91):**
- **`otp-repository.ts`/`otp-service.ts` ganaron el concepto de `flow`** (namespacea
  el índice `otp:target:{flow}:{target}`, antes solo `otp:target:{target}`) y de
  `meta` (bag arbitrario atado al mismo hash `otp:{otpId}`, mismo TTL/rotación/
  invalidación que el OTP). Cierra tres MEDIA juntos:
  - **Cruce entre flujos sobre el mismo target**: `verifyOtp(otpId, code, flow)`
    ahora exige el `flow` esperado y rechaza (401, sin tocar intentos ni invalidar)
    un otpId real pero de otro flujo -- antes `verifyPhoneChange` aceptaba
    ciegamente cualquier OTP válido, así que un otpId de cambio de email posteado
    por error contra `/me/phone/change/verify` "cambiaba" el teléfono al mismo que
    ya tenía la cuenta y consumía en el camino el OTP real del otro flujo.
  - **TTL desincronizado del email pendiente**: `pending-email-repository.ts`
    (key Redis paralela con TTL propio, nunca refrescado por
    `POST /auth/resend-otp`) se borró -- el email candidato ahora es
    `meta.pendingEmail` del propio OTP, comparte su lifetime por construcción. Cierra
    también el cleanup en ramas no felices (comentario de review aparte): no hay
    una segunda key que pueda quedar huérfana.
  - **Un tercero sin autenticar podía invalidar el OTP de otro usuario**:
    `POST /auth/send-otp` (pública, flujo `"register"`) y los flujos de cuenta ya no
    comparten índice sobre el mismo target.
  - `generateOtp()` devuelve `sent: boolean` (antes la rama de reuso-por-cooldown
    devolvía la misma forma que un envío real, sin que el cliente pudiera
    distinguir "mandé un SMS" de "reusá el que ya tenés").
- **`user-repository.ts#uniqueConstraintFieldsInclude`**: `users_email_lower_idx`
  (MOVO-93) es un UNIQUE INDEX de EXPRESIÓN sobre `LOWER(email)` -- verificado
  empíricamente que Postgres SÍ lo hace cumplir (el comentario viejo decía lo
  contrario). Para ese índice el driver adapter de Prisma 7 no devuelve
  `fields: ["email"]` limpio, devuelve el nombre de la expresión truncado
  (`["lower(email::text"]`) -- un `.includes("email")` exacto no matcheaba eso, así
  que una colisión de email que difiere solo en casing (AC5, la carrera entre el
  paso 1 y el verify) devolvía 500 en vez de 409. `.some(f => f.includes(column))`
  matchea las dos formas.
- **Rate limit del gateway para los dos endpoints de paso 1** (`/users/me/
  phone/change/otp`, `/users/me/email/change/otp`, 5/15min vía
  `getRateLimitOverrides()`, ver `gateway/CLAUDE.md`): mandan SMS reales por Twilio
  (ADR-012) y el cooldown de `generateOtp()` es por target, no por caller -- sin el
  override, una sola cuenta autenticada podía disparar ~200 SMS/min variando el
  teléfono en cada request (riesgo R10 del plan de proyecto).
- **`maxLength` agregado a `firstName`/`lastName` (`users.schema.ts`, 80) y a
  `fullName` de registro (`auth.schema.ts`, 160)**: ninguno tenía cota superior, y
  las columnas son `text` sin límite en Postgres -- un nombre de 1 MB se aceptaba y
  se devolvía en cada perfil/resultado de búsqueda.

### MOVO-134 — Cambio de contraseña y baja de cuenta (Cuenta y seguridad)

Backend del ítem "Cuenta y seguridad" del perfil: `POST /users/me/password` y
`DELETE /users/me`. Cierra MOVO-39 (derecho de supresión) junto con el ticket
hermano de mobile.

Decisiones clave:
- **Bloqueo por envíos/disputas activos, sin cascada de cancelación** (decisión de
  refinamiento con el equipo, se aparta del planteo inicial del ticket): `DELETE
  /users/me` consulta `GET /internal/account-deletion/users/:userId/active-shipments`
  en `svc-shipments` (primera llamada síncrona `svc-users` → `svc-shipments`, ver
  `services/movo-svc-shipments/CLAUDE.md`) y bloquea con `409
  ACCOUNT_HAS_ACTIVE_DISPUTES`/`ACCOUNT_HAS_ACTIVE_SHIPMENTS` si el usuario (como
  emisor, receptor o transportista) tiene algo en un estado no terminal —
  **sin importar cuál** (incluye `in_transit`, evaluado y descartado agregarle una
  transición de cancelación al grafo de MOVO-105). Es el usuario quien cancela por su
  cuenta y reintenta la baja; sin timeout/fallback seguro si `svc-shipments` no
  responde (la baja falla, a diferencia de la validación de receptor de MOVO-80).
- **`issueSession()` de `auth.service.ts` pasó de closure interno a función standalone
  exportada** (recibe `sessionRepository` explícito): `changePassword()` necesita
  emitir el mismo shape de tokens que login/register/refresh sin instanciar
  `phoneVerificationService` (dependencia de `createAuthService` que no le hace
  falta acá). `login()`/`register()`/`refresh()` se actualizaron para llamarla igual.
- **Rate limit del cambio de contraseña resuelto adentro de `svc-users`, no en el
  gateway**: el rate-limiting del gateway corre *antes* de decodificar el JWT (así
  están armados los 4 rate limits estrictos ya existentes en
  `gateway/src/config/routes-map.ts`, todos keyeados por IP) — no puede limitar "por
  usuario" sin reordenar ese hook para *todas* las rutas protegidas. Se resolvió con
  un contador en Redis por `userId` (5 intentos / 15 min), mismo patrón que
  `otp-repository.ts#incrementAttempts` pero con ventana fija.
- **Anonimización de PII derivada del propio `id`** (`deleted+{id}@movo.invalid` /
  `deleted-{id}`), no de un UUID nuevo random: ya es único (el `id` lo es), evita una
  generación extra, y dobla como "derivado del id" tal cual pedía el ticket. Sin
  `DELETE` físico — el `user_id` sigue referenciado desde envíos históricos en
  `svc-shipments`, la integridad referencial del historial tiene que sobrevivir
  (mismo motivo que ya documentaba `getPublicProfile`, MOVO-77, para tratar `deleted`
  como "no existe" hacia afuera).
- **`address-repository.ts#delete()` no se pudo reusar en la transacción de baja**:
  ese método abre su propia `$transaction` (para promover un nuevo default cuando se
  borra la default) — necesita un `PrismaClient` completo, no el `tx` que entrega
  `db.$transaction(async (tx) => ...)`. La baja usa un `deleteMany` crudo en su
  lugar (no hace falta preservar ningún default, no queda ningún usuario). Mismo
  problema no aplicó a `push-token-repository.ts`: sus métodos nunca abren su propia
  transacción, así que se pudo ensanchar su tipo a `Prisma.TransactionClient` sin
  riesgo (mismo criterio que `user-repository.ts` desde MOVO-72).
- **Anonimización inmediata, sin ventana de gracia** (recomendación original del
  ticket, no revisada en el refinamiento de MOVO-134): purga diferida necesitaría un
  job programado que hoy no existe en el proyecto.
- **Limitación aceptada**: no se manda ningún mail de "tu contraseña cambió" ni de
  confirmación de baja. MOVO-139 ya construyó el `EmailProvider` (ADR-017), así que hoy
  es solo cuestión de cablear esos dos avisos — no estaba en el alcance de esa US.

Tests: `test/users.account-settings.integration.test.ts` (19 casos) +
`services/movo-svc-shipments/test/account-deletion.integration.test.ts` (11 casos,
ver ese CLAUDE.md) — Postgres+Redis reales, `ShipmentsClient` fake inyectable vía
`buildApp({ shipmentsClient })` (mismo criterio que `storageProvider`/`smsProvider`).
Cubre el ciclo completo de registro→cambio de contraseña→refresh viejo invalidado,
bloqueo por disputa/envío activo sin efecto, idempotencia de la baja, y re-registro
post-baja con el mismo email/teléfono.

Pendiente / fuera de alcance: consumo desde `movo-mobile` (ticket aparte).

**Fixes de review sobre la implementación inicial (tmvergara, PR #92):**
- **El access token sobrevivía a la baja de cuenta y al cambio de contraseña**
  (Medium): `revokeAllForUser` solo invalida refresh tokens -- el access token, JWT
  stateless (ADR-004), seguía siendo válido hasta sus 60 minutos de TTL. Se agregó
  `sessionRepository.revokeAccessTokensIssuedBefore(userId)`, que sella
  `user-revoked-at:{userId}` en Redis (segundos Unix, TTL = TTL del access token) --
  el gateway (`gateway/src/plugins/auth.ts#authenticate`) lo lee en cada request
  autenticado y rechaza cualquier token con `iat` anterior. Guardado en segundos, no
  milisegundos, a propósito: comparar contra `Date.now()` dejaría el token nuevo que
  la propia `changePassword()` emite auto-revocado por el redondeo de `iat` al
  segundo. Mismo mecanismo cierra `deleteAccount()` y `changePassword()`.
- **PII de KYC/licencia sobrevivía a la baja de cuenta** (Medium): `onDelete:
  Cascade` de `KycVerification`/`DriversLicense` nunca disparaba porque la fila de
  `users` sobrevive a propósito (integridad referencial con envíos históricos) --
  `rawDecision`/`external_session_id` (sesión de Didit con documento y biometría) y
  la fecha de vencimiento del carnet quedaban en la base. Se agregó el borrado
  explícito de ambas tablas a la `$transaction` de `deleteAccount` (sin FK entrante
  desde envíos, a diferencia de `users`); `phoneVerified` también se resetea a
  `false` en `anonymizeAndDelete`.
- **TOCTOU entre el chequeo de envíos activos y la anonimización** (Low/medium):
  se agregó un lock por usuario en Redis (`account-deletion-lock:{userId}`, `SET NX
  EX 30`) alrededor de todo el bloque de `deleteAccount` -- cierra el caso de dos
  bajas concurrentes del mismo usuario. **No cierra** la carrera más amplia contra un
  envío creado desde `svc-shipments` en el medio (misma clase de problema que tuvo
  MOVO-118 antes de su fix) -- la solución de fondo (que `svc-shipments` valide
  `status` del sender/carrier al crear/aceptar un envío, rechazando `deleted`) queda
  fuera de alcance de este PR, aceptada por ahora sin ticket de seguimiento dedicado.
- **Rate limit de cambio de contraseña sin TTL ante una caída a mitad de camino**
  (Low): `INCR` + `EXPIRE` condicional eran dos comandos separados -- un fallo entre
  medio dejaba la key sin TTL, bloqueando al usuario para siempre. Se resolvió con
  `SET NX EX` atómico (mismo patrón que `phone-verification.service.ts`). Secundario:
  el contador solo se incrementa en intentos **fallidos** ahora (antes también en
  éxitos) y se resetea en un cambio exitoso -- 5 cambios legítimos seguidos ya no
  bloquean al usuario.
- **Endpoint interno de `svc-shipments` sin `response` schema** (Low): se cableó
  `response: { 200: activeShipmentsResponse }` en
  `account-deletion.routes.ts` -- sin esto, un cambio de forma en
  `hasActiveShipmentsForUser` podía pasar `undefined` (falsy) a `shipments-client.ts`
  y dejar pasar la baja en la dirección insegura, en silencio.
- Comentario desactualizado en `shipments-client.ts` corregido (decía "sin timeout
  explícito" sobre código que sí lo tiene).

### MOVO-124 — Sweep de fotos huérfanas en S3 vía tracking en Redis (`svc-users` + `svc-shipments`)

Decisión completa y detalle de la implementación en
`services/movo-svc-shipments/CLAUDE.md` (mismo mecanismo en los dos servicios). Acá:
`existsByPhotoUrl` nuevo en `user-repository.ts` (fuente de verdad contra Postgres que
usa el sweep antes de borrar), `getPhotoUploadUrl`/`confirmPhoto` de `users.service.ts`
ahora registran/destrackean la key en el sorted set `photos:pending:profile-photos` de
Redis, y `src/plugins/orphan-photo-sweep.ts` — **primer scheduled job de este
servicio** (mismo esqueleto `setInterval` + lock distribuido en Redis que
`receiver-confirmation-sweep.ts` de `svc-shipments`, MOVO-130).

Tests: `test/orphan-photo-sweep.test.ts` nuevo (mockeado, incluye el caso AC3: un
candidato con `photoUrl` vigente en `users.users` nunca dispara `deleteObject`).
`test/users.photo.integration.test.ts` ampliado con dos casos contra Redis real.
Suite completa 385/385, `tsc --noEmit` y `eslint` limpios.

**Fix de review (PR #96, tmvergara) — TOCTOU real entre `confirmPhoto()` y el sweep**:
mismo bug y mismo fix que su gemelo de `svc-shipments` (detalle completo en
`services/movo-svc-shipments/CLAUDE.md`, sección MOVO-124) — lock por key de S3 en
Redis (`photoConfirmationLockKey()` en `users.service.ts`) que se disputan
`confirmPhoto()` y el sweep antes de tocar S3/Postgres, cierra la ventana donde una
confirmación tardía podía terminar en `photoUrl` persistido apuntando a un objeto ya
borrado por el sweep, sin error visible.

### MOVO-139 — `EmailProvider` (Resend) y verificación de email por OTP (ADR-017)

Primer canal de email del proyecto. Cierra la limitación que MOVO-133/MOVO-134 dejaron
documentada ("sin `EmailProvider` no se puede notificar al email anterior") y es
precondición de MOVO-64 (recuperación de contraseña por email).

Decisiones clave:
- **`EmailProvider` calcado de `SmsProvider` (ADR-012)**: interfaz + factory por
  `EMAIL_PROVIDER` + `console-email-provider.ts` como default de dev/test/CI +
  `resend-email-provider.ts` para la demo, con fail-fast al arrancar si se pide `resend`
  sin `RESEND_API_KEY`/`EMAIL_FROM`. Resend se consume por `fetch` contra su API HTTP,
  no por su SDK (un solo POST con un JSON, mismo criterio que
  `telegram-sms-provider.ts`/`expo-push-provider.ts`).
- **El cuerpo viaja como `{ text, html }`, no como un string** (se aparta de la firma
  literal del ticket, `send(to, subject, body)`): un mail transaccional sin parte de
  texto plano es disparador clásico de filtros de spam, y sin HTML se ve roto en la
  mayoría de los clientes. Los dos los arman `buildOtpEmail`/`buildEmailChangedNotice`
  en `email-provider.ts` — templates en código, nunca en la UI de Resend (esos son para
  Broadcasts: no se versionan, no se testean y atarían el contenido al proveedor).
- **El canal se persiste en el registro de Redis del OTP** (`OtpRecord.channel`, nuevo):
  `resendOtp(otpId)` solo recibe el otpId, así que sin ese campo el reenvío no sabría si
  el target es un teléfono o un email. Mismo razonamiento por el que MOVO-133 metió
  `flow` en el hash. `createOtpService` pasa a recibir `{ sms, email }` (los dos
  obligatorios: `POST /auth/resend-otp` es genérica y puede tocarle cualquiera de los
  dos). Los registros sin `channel` — los que quedaran vivos al momento del deploy, TTL
  de 10 min — se leen como `sms`.
- **El OTP de cambio de email pasa a ir al email NUEVO**, corrigiendo la decisión de
  refinamiento de MOVO-133 (iba al teléfono actual, por no haber ningún canal de email):
  eso probaba posesión de la cuenta pero no propiedad de la dirección, así que se podía
  dejar como email de la cuenta una que no se controla. `email` + `emailVerified=true`
  se persisten en el mismo UPDATE, mismo criterio que `phone`/`phoneVerified`.
- **Aviso al email anterior best-effort**: se manda después del UPDATE ya persistido y
  con el OTP ya consumido, así que un fallo de Resend no puede revertir nada — devolver
  500 mostraría un error sobre una operación que salió bien, y el reintento fallaría con
  "el email nuevo es igual al actual". Se loguea y sigue. La dirección nueva viaja
  enmascarada (`j****z@gmail.com`): ese mail va a una casilla que ya no pertenece a la
  cuenta.
- **Flujo propio `email-verify`, separado de `email-change`** (AC8): verificar el email
  que la cuenta ya tiene y cambiarlo por otro son casos de uso distintos, y el
  namespacing por `flow` de MOVO-133 impide que un OTP de uno se consuma en el otro.
- **Sin gate duro**: un email no verificado no bloquea operar, solo se refleja en
  `PrivateProfile.emailVerified` (`@movo/shared`). Hacerlo obligatorio en el registro es
  alcance de MOVO-7.

Migración `20260823160000_add_email_verified_movo_139`: `email_verified` (default
`false`) + `email_verified_at` (solo auditoría, nunca se lee para decidir) en
`users.users`. Los usuarios existentes quedan sin verificar por backfill natural —
nadie probó todavía la propiedad de esas direcciones, que es justo lo que la US arregla.

Rate limit propio en el gateway para `POST /users/me/email/verify/otp` (5/15min,
`getRateLimitOverrides()`), alineado con los dos endpoints de cambio.

**Diseño de los mails y entregabilidad** (iteración posterior al primer envío real, que
cayó en la carpeta de no deseados de Outlook):
- Paleta de marca tomada de `movo-mobile/tailwind.config.js` (ink-950 `#0A0A0B`,
  lime-500 `#C6F24A`) para que un mail y una pantalla no parezcan de dos productos
  distintos: cabecera negra con el wordmark, filete lime de 3px, y el código en
  monoespaciada lime sobre negro (la app usa JetBrains Mono para datos así; ningún
  cliente de correo la tiene, degrada al monoespaciado del sistema).
- **Wordmark en texto, no el PNG del logo**: los clientes bloquean imágenes remotas
  hasta que el usuario las habilita — el logo no se vería en la primera lectura, que en
  un OTP es la única que importa —, un PNG pesado empeora el ratio texto/imagen que
  miran los filtros de spam, y un `data:` URI lo descartan Gmail y Outlook. Para usar el
  logo real haría falta hostearlo en una URL pública estable: el bucket de dev
  (`movo-shipment-media-dev`) hoy solo expone `profile-photos/*`, así que requiere un
  prefijo `brand/*` público en la policy — cambio de Terraform en `movo-infra` (ADR-009:
  nada de aprovisionamiento manual), no un `put-bucket-policy` a mano.
- Tablas anidadas con `bgcolor` en vez de divs: el motor de render de Outlook para
  Windows es Word (sin flexbox, sin grid, sin `border-radius`).
- `preheader` explícito: sin uno, la bandeja muestra el primer texto del cuerpo — en el
  mail de OTP eso ponía el código en la lista de mensajes, a la vista de cualquiera que
  mirara la pantalla.
- **Falta el registro DMARC** (`_dmarc.movosend.app`): verificado con `dig` que DKIM,
  SPF y el MX de bounces están, pero DMARC no existe en ninguno de los dos niveles. Es
  la causa principal del filtrado en Outlook/SmartScreen, que además castiga a un
  dominio recién creado sin historial de envíos. Pendiente en `movo-infra`.

Tests: `test/users.email-verification.integration.test.ts` (18 casos, Postgres+Redis
reales, captor de `EmailProvider` con el mismo patrón que el de SMS) + los casos de
cambio de email de `test/users.profile-edit.integration.test.ts` actualizados al canal
nuevo, más el aviso al email anterior y su fallo. 42/42 suites, 403/403 tests.

Pendiente / fuera de alcance: UI mobile (insignia + CTA, se suman a MOVO-135, que espera
este ticket); verificación obligatoria en el registro (MOVO-7); recuperación de
contraseña por email (MOVO-64); mover el `EmailProvider` a `shared/` (nace acá, se
evalúa al haber un segundo consumidor real).

### MOVO-140 — Recuperación de contraseña: OTP por SMS o email, señuelo anti-enumeración

`POST /auth/forgot-password`, `/auth/verify-reset-otp`, `/auth/reset-password` en
`src/modules/auth/` (nuevo `password-reset.service.ts`) + 3 rutas públicas con rate
limit propio en `gateway/src/config/routes-map.ts` (ver `gateway/CLAUDE.md`). Cierra
MOVO-64 junto con MOVO-71/MOVO-139 (base de OTP por SMS/email) y MOVO-134 (patrón de
revocación de sesiones al cambiar contraseña).

Decisiones clave:
- **Señuelo anti-enumeración persistido en el propio registro de Redis**:
  `otp-repository.ts#OtpRecord.isDecoy` (booleano, igual criterio que `channel` de
  MOVO-139) — `otp-service.ts#generateOtp`/`resendOtp` generan y hashean el código
  igual que un OTP real (mismo costo de Argon2id, misma latencia) pero saltean
  `deliver()`. Sin el flag en el registro, `resendOtp(otpId)` —genérico, solo recibe
  el otpId— no tiene forma de saber que no debe entregar nada, y el reenvío se
  vuelve un oráculo de enumeración por la puerta de atrás.
- **La consulta a la DB en `forgotPassword` se hace siempre, antes de decidir
  señuelo o no** (mismo criterio que el `DUMMY_HASH` de `login()`, MOVO-74): sin
  esto, el camino señuelo sería más rápido y la latencia delataría qué
  identificadores están registrados.
- **`SmsProvider` ganó `sendText(toE164, message)`**, separado de `send(toE164,
  code)`: ese último es específico de OTP (cada implementación arma
  `buildOtpMessage(code)` internamente), así que no servía para un aviso de texto
  libre como "tu contraseña cambió". `EmailProvider.send()` no necesitó cambios —
  ya recibía el contenido armado por el caller.
- **`passwordResetToken` es un JWT propio** (`purpose: "password_reset"`, `sub`=
  userId, 15min TTL, single-use vía `SET NX` en Redis), copiado del patrón de
  `phoneVerificationToken` (MOVO-71) pero deliberadamente no reusado: son propósitos
  distintos (uno registra una cuenta nueva, el otro cambia la contraseña de una
  existente).
- **No se rechaza que la contraseña nueva sea igual a la anterior** (a diferencia
  de `POST /users/me/password`, MOVO-134): acá el usuario llegó porque no la
  recordaba, bloquearlo si acertó la vieja es fricción sin ganancia de seguridad —
  decisión explícita del ticket, no un olvido.
- **`newPassword`/`registerBody.password` comparten el mismo objeto de schema**
  (`PASSWORD_SCHEMA` en `auth.schema.ts`, igual que `EMAIL_PATTERN`/`PHONE_PATTERN`):
  a diferencia de `users.schema.ts#changePasswordBody` (MOVO-134, duplicado a
  propósito por vivir en otro módulo), acá las dos definiciones viven en el mismo
  archivo, así que se comparte el objeto en vez de duplicarlo.
- **Aviso de contraseña cambiada revoca sesiones antes de mandarse, y es
  best-effort**: mismo orden y mismo criterio que el aviso al email anterior de
  MOVO-139 — un fallo de entrega no revierte el cambio de contraseña ni cambia el
  204, se loguea y sigue.

Tests: `test/auth.password-reset.integration.test.ts` (23 casos, Postgres+Redis
reales) cubriendo los dos canales, el señuelo en sus cuatro variantes (inexistente,
`emailVerified:false`, `banned`, `deleted`), el reenvío sobre un otpId señuelo, los
casos de error del OTP y del token, y que el refresh token previo quede muerto tras
el reset. 45/45 suites, 433/433 tests en `movo-svc-users`; 5/5 suites, 49/49 tests en
`gateway`. `tsc --noEmit` y `eslint` limpios en ambos paquetes. Probado a mano de
punta a punta con `SMS_PROVIDER=console`/`EMAIL_PROVIDER=console` (flujo feliz y
señuelo).

**Fixes de review sobre la implementación inicial (Pedro):**
- **Timing side-channel real en el señuelo** (Alto): `otp-service.ts#deliver()` hace
  una llamada de red real a Twilio/Resend solo en el camino real -- el hash Argon2id
  del código (AC4) ya era idéntico en los dos caminos, pero eso no alcanzaba: la
  espera de red domina por completo al hash, así que un atacante podía medir el
  tiempo de respuesta de `forgot-password` para distinguir el señuelo del real.
  Se agregó `DECOY_DELIVER_DELAY_MS` (200ms): el camino señuelo espera ese tiempo en
  vez de llamar al proveedor real (no se lo puede llamar de verdad -- costaría
  dinero y podría notificar a una cuenta baneada de que alguien está probando su
  identificador). No es constant-time perfecto (la latencia real de un proveedor
  externo varía), cierra la diferencia obvia reportada. Acotado a `isDecoy=true`
  (nunca se ejecuta para register/phone-change/email-verify, que nunca pasan ese
  flag), así que no afecta la latencia de ningún otro flujo de OTP.
- **`resetPassword()` no revalidaba el estado de la cuenta** (Alto): el
  `passwordResetToken` se emite con el estado de la cuenta al momento del OTP, pero
  nada impedía que quedara baneada/eliminada durante su TTL de 15min --
  `updatePassword()` no chequea `status`, solo hace el UPDATE por id, así que el
  cambio se persistía igual. Se agregó el mismo chequeo que `login()`/`refresh()`
  (MOVO-74/75): usuario inexistente -> 401 genérico, baneado/eliminado -> 403
  `ACCOUNT_SUSPENDED` (nuevo código de respuesta para este endpoint, ya existente en
  `@movo/shared`).
- **`SessionRepository` duplicado** (menor, simplificación): `createAuthService`
  creaba su propia instancia interna además de la que `auth.routes.ts` ya armaba
  para `passwordResetService` -- sin bug real (el repositorio no tiene estado
  propio), pero trabajo de más. `createAuthService` ahora acepta un
  `sessionRepository` opcional (default `createSessionRepository(redis)` si no se
  pasa, no rompe los dos call sites de test que lo instancian sin ese argumento);
  `auth.routes.ts` crea una sola instancia y la comparte.
- El cuarto hallazgo de la review (`sendText` requerido rompiendo ~10 tests) ya
  estaba resuelto en el momento de la review -- los 10 fixtures de `SmsProvider` en
  `test/` ya lo implementaban desde la primera versión de este PR.

Pendiente / fuera de alcance: consumo desde `movo-mobile` (ticket aparte).

### Pendientes de este servicio

- **Credenciales reales sin cargar** en AWS Secrets Manager (dev y prod) — el código
  ya está listo para tomarlas apenas se configuren: Twilio (4 vars, ADR-012), Didit
  (`DIDIT_MODE=live` + 5 vars, incluye `DIDIT_WORKFLOW_ID_LICENSE` de MOVO-15), Google
  Maps (server-side `GOOGLE_MAPS_API_KEY` compartida entre `svc-users`/futuros
  consumidores), Telegram bot (`SMS_PROVIDER=telegram`, solo dev),
  `STORAGE_PROVIDER=s3` + bucket/region de MOVO-97, Resend (`EMAIL_PROVIDER=resend` +
  `RESEND_API_KEY`/`EMAIL_FROM`, ADR-017 — falta además verificar el dominio de envío en
  Resend y sus registros SPF/DKIM por Terraform).
- **Terraform de `movo-infra`**: bucket de fotos de perfil (MOVO-97/ADR-016) aplicado
  en dev, `terraform apply` de prod pendiente.
- Mobile de MOVO-120 no genera/envía todavía un `sessionToken` de Places — ver
  `movo-mobile/CLAUDE.md`.

### MOVO-135 (backend mínimo) — `dni` y `phoneVerified` en la proyección privada

Cambio aditivo pedido por el frontend de MOVO-135 (editar perfil muestra el DNI como
dato de solo lectura, y una insignia de verificado junto al teléfono):
`toPrivateProfile()` (`src/models/user-profile.ts`) ahora mapea `user.dni` y
`user.phoneVerified`, y `privateProfileResponse` (`src/modules/users/users.schema.ts`) los
declara como `["string", "null"]` y `boolean`, ambos requeridos. El tipo compartido cambió en el mismo commit
(ver `shared/movo-shared/CLAUDE.md`).

No se tocó ningún endpoint de escritura: `patchProfileBody` sigue aceptando solo
`firstName`/`lastName`, así que mandar `dni` en el `PATCH /users/me` es 400
`VALIDATION_FAILED` igual que antes. El DNI se expone, no se edita.
