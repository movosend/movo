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
  persiste. **Limitación aceptada**: no se puede notificar al email anterior que el
  email cambió (mismo motivo, sin canal de email) — se cierra cuando exista un
  `EmailProvider` compartido con MOVO-64 (recuperación de contraseña). No revoca
  sesiones (el email no es credencial de sesión, a diferencia de la contraseña — ver
  ticket hermano MOVO-134).
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

Tests: `test/users.profile-edit.integration.test.ts` (21 casos, Postgres+Redis reales,
mismo patrón de `SmsProvider` captor que `auth.otp.integration.test.ts`) cubriendo las
8 AC del ticket, incluida la carrera de unicidad de teléfono/email simulada
adelantando el `UPDATE` de otro usuario entre el paso 1 y el verify. 40/40 suites /
347/347 tests en `movo-svc-users`. `tsc --noEmit` limpio acá, en `gateway` y en
`shared/movo-shared`.

Pendiente / fuera de alcance: consumo desde `movo-mobile` (ticket aparte); cambio de
contraseña y baja de cuenta (ticket hermano MOVO-134, en refinamiento con el equipo);
`birthdate`/`dni` (existen en el schema, no se editan por ningún endpoint todavía).

### Pendientes de este servicio

- **Credenciales reales sin cargar** en AWS Secrets Manager (dev y prod) — el código
  ya está listo para tomarlas apenas se configuren: Twilio (4 vars, ADR-012), Didit
  (`DIDIT_MODE=live` + 5 vars, incluye `DIDIT_WORKFLOW_ID_LICENSE` de MOVO-15), Google
  Maps (server-side `GOOGLE_MAPS_API_KEY` compartida entre `svc-users`/futuros
  consumidores), Telegram bot (`SMS_PROVIDER=telegram`, solo dev),
  `STORAGE_PROVIDER=s3` + bucket/region de MOVO-97.
- **Terraform de `movo-infra`**: bucket de fotos de perfil (MOVO-97/ADR-016) aplicado
  en dev, `terraform apply` de prod pendiente.
- Mobile de MOVO-120 no genera/envía todavía un `sessionToken` de Places — ver
  `movo-mobile/CLAUDE.md`.
