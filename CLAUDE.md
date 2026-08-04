# CLAUDE.md — Contexto del proyecto MOVO

## Qué es este archivo

Contexto común del equipo para trabajar con Claude (o cualquier asistente de IA) en este
repositorio. Se carga automáticamente al abrir Claude Code acá. El objetivo es que
cualquier integrante, en cualquier sesión, tenga de entrada el mismo entendimiento del
proyecto sin tener que re-explicarlo cada vez.

Antes de dar por cerrada una US, usar la skill `.claude/skills/cerrar-us/` — decile a
Claude algo como "cerremos esta US" o "revisá si cumplimos todo del ticket" y la
dispara. Compara la implementación contra el ticket de Linear ítem por ítem, corre
tests, chequea si falta un ADR, y actualiza este mismo archivo.

**Es un documento vivo.** Reglas de mantenimiento:

- Al terminar una US/PR que agregue una decisión de diseño, un servicio nuevo, o cambie
  una convención: actualizá la sección **"Estado actual de la implementación"** con una
  entrada corta (qué se hizo, en qué archivos, qué queda pendiente/fuera de alcance).
  No dupliques el detalle que ya está en el commit o en la descripción del PR — un
  párrafo de 3-5 líneas alcanza.
- Si una convención de código/proceso cambia (nuevo ADR, nueva regla de linting, etc.),
  actualizá la sección correspondiente acá, no solo en el documento de Drive.
- Si agregás un ADR nuevo en el entregable de Sprint 0 (Drive), sumá su resumen de una
  línea en la tabla de ADRs de este archivo.
- Mantené las secciones de contexto de negocio (arquitectura, stack, convenciones)
  resumidas — el detalle completo con alternativas consideradas y justificación vive en
  Drive, este archivo es un índice denso, no un reemplazo.

## Qué es MOVO

Plataforma de logística distribuida P2P: conecta personas que necesitan enviar un
paquete con personas que ya están viajando esa ruta (transportistas). Sin
intermediarios centralizados — seguridad vía criptografía asimétrica (cryptographic
handshake para la transferencia de custodia), precios dinámicos por algoritmo, y
optimización de rutas (VRPTW con Google OR-Tools).

Proyecto final de carrera, Ingeniería en Sistemas de Información, UTN Facultad Regional
Córdoba. Equipo de 5: Ariza (Alena), Bordino Blanche (Juan Cruz), Dalmagro (Lucas),
Yorlano (Pedro), Vergara (Tomás Ignacio).

**Por qué importa esto para el código:** es un trabajo final académico, no solo software
funcionando — los entregables incluyen una memoria escrita y defensa oral. Las
decisiones técnicas necesitan justificación documentada (ver ADRs abajo), y limitaciones
conocidas se documentan explícitamente como aceptadas en vez de dejarlas implícitas.

Actores: Emisor (solicita envío y paga), Transportista (declara ruta, acepta envíos y
cobra), Receptor (recibe el paquete, confirma entrega vía QR), Administrador (operador
interno, monitorea y resuelve disputas). Un mismo usuario puede ser Emisor y
Transportista simultáneamente.

## Stack y arquitectura

| Contenedor | Tecnología | Responsabilidad |
| --- | --- | --- |
| `movo-mobile` | React Native + Expo (TS) | App para emisores/transportistas/receptores |
| `movo-admin` | Next.js (TS) | Panel de administración — deploy en Vercel |
| `movo-institucional` | Next.js (TS) | Landing institucional — repo separado, sin relación funcional |
| `gateway` (movo-api-gateway) | Node.js + Fastify (TS) | Punto de entrada único: routing, auth, rate limiting |
| `services/movo-svc-users` | Node.js + Fastify (TS) | Identidad, auth (JWT+refresh), KYC (Didit.me), perfiles, reputación |
| `services/movo-svc-shipments` | Node.js + Fastify (TS) | Ciclo de vida de envíos, cryptographic handshake, tracking GPS (WebSockets) |
| `services/movo-svc-payments` | Node.js + Fastify (TS) | Integración Mercado Pago: Auth & Capture, Split Payments, Marketplace OAuth |
| `services/movo-svc-pricing-logistics` | Python + FastAPI | Motor de precios dinámico, subastas, optimización VRPTW de rutas |
| `services/movo-svc-admin` | Node.js + Fastify (TS) | Reportes, disputas, soporte del panel admin |
| `shared/movo-shared` | TS (npm workspace) | Tipos de dominio, JWT, contrato `ApiError` — importado por gateway y servicios Node |
| PostgreSQL 16 | — | Única instancia relacional, un esquema por microservicio |
| Redis 7 | — | Sesiones, refresh tokens, rate limiting, estado de WebSockets |
| Nginx | — | Termina TLS en la EC2, reenvía al gateway |

Infra: AWS EC2 + Docker Compose (un ambiente por EC2: dev y prod), Terraform (repo
separado `movo-infra`), Cloudflare (DNS), GitHub Actions (CI/CD), Vercel (frontends
Next.js). Ver `README.md` para instrucciones de setup local.

Comunicación entre servicios: REST síncrono sobre HTTP, sin message broker. Socket.io
para el canal de tracking en tiempo real. Solo el gateway expone puerto público (443);
todo lo demás vive en la red Docker interna.

Todas las rutas del backend quedan bajo el prefijo `/api/v1/*` (`GET /health` es la
excepción, sin versionar, para healthchecks).

## Architecture Decision Records (ADRs)

Los ADRs completos (contexto, alternativas consideradas, trade-offs) viven en Google
Drive, entregable `[Movo] 004 - Sprint 0.md`, sección "Architecture Decision Records".
Convención: un ADR aceptado no se modifica — si una decisión cambia, se crea un ADR
nuevo que referencia y deprecate al anterior. Resumen de los vigentes:

| ADR | Decisión | Trade-off aceptado |
| --- | --- | --- |
| 001 | Microservicios (no monolito ni serverless) | Comunicación síncrona REST introduce acoplamiento temporal; mitigado con `x-request-id` en logs |
| 002 | Node.js+Fastify para I/O; Python+FastAPI solo para `pricing-logistics` | Dos stacks a mantener |
| 003 | PostgreSQL único compartido (esquema por servicio) + Redis para sesiones/estado rápido | Punto único de fallo, mitigado con esquemas separados y snapshots |
| 004 | JWT corto (60min) + refresh token opaco en Redis (7 días), roles como array (`AccessTokenClaims.roles: UserRole[]`) | Token robado sigue válido hasta expirar (máx 60min) |
| 005 | REST + `/api/v1/` + Socket.io para tracking; Swagger autogenerado | Over-fetching mitigado con query params de proyección |
| 006 | EC2 + Docker Compose (no K8s/PaaS/ECS); frontends Next.js en Vercel | Sin auto-scaling; sin alta disponibilidad (aceptado para el alcance del TFG) |
| 007 | AWS S3 con presigned URLs para imágenes de envíos (nunca BLOBs en Postgres ni filesystem local) | Cliente implementa flujo de 2 pasos (pedir URL, hacer PUT) |
| 008 | Google Maps Distance Matrix API para la matriz de costos del VRPTW | Costo por llamada (N²) y dependencia de red en el camino crítico |
| 009 | Terraform (AWS + Cloudflare) reemplaza aprovisionamiento manual | Curva de aprendizaje de HCL/state management |
| 010 | Gateway: servicios internos confían en `x-user-*` sin revalidar (se apoya en que solo el gateway expone puerto público) | Si un atacante llega a la red interna, el modelo de confianza cae — perimetral, no zero-trust |

## Convenciones de código

- TypeScript estricto (`strict: true`) en todo Node/Next.js/Expo. `any` prohibido sin
  comentario justificándolo — usar `unknown` + type guards.
- Tipos compartidos entre servicios Node van en `shared/movo-shared`, nunca duplicados.
- Naming: `camelCase` (variables/funciones), `PascalCase` (clases/interfaces),
  `UPPER_SNAKE_CASE` (constantes/env vars), `kebab-case` (archivos TS, endpoints REST),
  `snake_case` (archivos Python, tablas/columnas de DB).
- Estructura por servicio Node: `src/{routes,services,repositories,models,plugins,utils}`
  + `index.ts`, tests en `test/` (unit + integration).
- Estructura del servicio Python: `app/{routers,services,models,db,utils}` + `main.py`.
- Lint/format: ESLint + Prettier (TS), Ruff + mypy (Python). Husky + lint-staged corren
  en pre-commit — un commit con errores de lint no pasa.
- Swagger/OpenAPI se genera automáticamente (Fastify/FastAPI) — nunca a mano. Si el
  código y el Swagger generado difieren, el código manda; el PR debe confirmar que el
  Swagger generado refleja el endpoint tocado.

## Git, commits y PRs

- Ramas: `main` (prod, solo vía PR desde `develop`) → `develop` (staging, integración
  continua) → `feature/*` `fix/*` `hotfix/*` (efímeras). Nomenclatura:
  `<tipo>/MOVO-<id>-<descripcion-corta>` (usar "Copy git branch name" desde Linear).
- Commits: Conventional Commits (`feat|fix|docs|refactor|test|chore|perf|ci`), en
  minúsculas, sin punto final, un cambio lógico por commit. Footer `Refs: MOVO-xxx`
  para vincular sin cerrar el issue (el cierre pasa por `Closes MOVO-xxx` en la PR, no
  en el commit).
- PRs: título `<tipo>(<scope>): <descripción> [MOVO-<id>]`. Descripción con checklist
  (tests unitarios/integración, Swagger actualizado, `.env.example` documentado).
  Squash merge siempre. Al menos un integrante distinto al autor revisa antes de
  aprobar, más el auto-review de GitHub Copilot/agentes de IA para calidad y
  vulnerabilidades.
- `.env.example` se actualiza en el mismo PR que introduce la variable — un PR que
  agrega una env var sin documentarla no se aprueba.

## Testing

- Framework por paquete: Vitest (servicios Node + gateway), Jest/`jest-expo` +
  React Native Testing Library (`movo-mobile`), Vitest + Testing Library (`movo-admin`),
  Pytest (`movo-svc-pricing-logistics`).
- Niveles: unitario (lógica de negocio, aislado), integración (Supertest / `app.inject`
  de Fastify contra DB/Redis reales, nunca mockeados), E2E (flujos completos de usuario,
  se corren antes de entregas parciales y cambios críticos, no en cada push).
  Detalle completo en `docs/plan-de-testing.md` del repo.
- Cobertura mínima acordada: 70% en componentes críticos (lógica de negocio, auth,
  validaciones, persistencia, comunicación entre servicios). Los paquetes sin lógica de
  dominio real (scaffolds) reportan cobertura pero no tienen umbral estricto todavía.
- CI (`pr-checks.yml`) corre lint + type-check + tests con detección de cambios por
  path; ya provisiona Postgres y Redis reales como servicios del job. El check
  `tests-summary` bloquea merge a `develop`/`main`.

## Despliegue y ambientes

- `develop` → deploy automático a dev (EC2 menor capacidad). `main` (merge desde
  `develop`) → deploy a prod (EC2 producción). Evaluadores de la cátedra acceden a prod.
- Secretos: nunca en el repo. Local → `.env` (gitignored). Dev/prod → AWS Secrets
  Manager, inyectados al arrancar cada contenedor. CI → GitHub Secrets. Frontends
  Next.js → variables de entorno de Vercel por ambiente.
- Puerto 22 SSH abierto a `0.0.0.0/0` en las EC2 es una limitación aceptada y documentada
  (restricción de AWS Security Groups para filtrar solo IPs de GitHub Actions), no un
  descuido.

## Documentación completa (Google Drive)

La documentación no-código vive en la carpeta compartida de Drive del equipo,
convención de nombre `[Movo] NNN-Nombre del documento`. Si tenés Drive sincronizado
localmente, pasale a Claude la ruta de esa carpeta en tu máquina para que pueda leer
estos documentos completos (la ruta local varía por integrante, no está hardcodeada acá):

- **`[Movo] 002-Estudio Inicial.md`** — objetivo del proyecto, diagnóstico de mercado,
  propuesta detallada del producto, explicación técnica de KYC (Didit.me), cryptographic
  handshake, algoritmo de pricing/rutas, sistema de pagos, glosario de dominio completo.
- **`[Movo] 003-Plan de Proyecto.md`** — roles, metodología, estimación, presupuesto de
  desarrollo, costo operativo mensual, modelo de monetización y flujo de fondos.
- **`[Movo] 004 - Sprint 0.md`** — Working Agreement completo, gestión de configuración,
  los 10 ADRs con alternativas consideradas, pautas de codificación, plan de testing,
  User Story Mapping y backlog detallado (32 historias en 7 épicas), glosario técnico.
- **Manual de Marca Movo** — identidad visual, fuera de alcance técnico.

## Backlog (resumen)

7 épicas alineadas a los bounded contexts: **EP-01** Identidad y Confianza (66hs),
**EP-02** Publicación y Descubrimiento (64hs), **EP-03** Asignación y Negociación (18hs),
**EP-04** Ejecución del Envío (92hs), **EP-05** Pagos y Economía (42hs), **EP-06**
Reputación y Comunidad (24hs), **EP-07** Gestión y Administración (46hs). MVP: 24 de 32
historias, 284hs. Backlog detallado y estimaciones por historia en Drive.

## Glosario rápido de dominio

- **Handshake criptográfico**: protocolo de transferencia de custodia entre emisor y
  transportista (y luego transportista y receptor) vía pares de claves asimétricas +
  validación de proximidad GPS, para confirmar que el paquete cambió de manos sin
  depender de confianza ciega.
- **KYC**: verificación de identidad vía Didit.me (liveness detection + validación
  documental), requerido antes de operar como transportista.
- **VRPTW**: Vehicle Routing Problem with Time Windows — el problema que resuelve el
  motor de optimización de rutas (Google OR-Tools) en `movo-svc-pricing-logistics`.
- **Sender / Carrier**: roles contextuales (no son un campo fijo de cuenta) — un mismo
  usuario puede ser ambos. Ver `UserRole` en `shared/movo-shared`.

---

## Estado actual de la implementación

_Sección viva — agregar una entrada corta por US/sprint relevante, no borrar el
historial de entradas anteriores salvo que queden completamente obsoletas._

### MOVO-67 — Librería compartida (`@movo/shared`)

JWT (`signAccessToken`/`verifyAccessToken`, TTL 60min, issuer `movo`), refresh token
opaco (`signRefreshToken`, no persiste — el servicio consumidor guarda el hash en
Redis), contrato `ApiError`/`ApiErrorCode` (formato único de error, códigos son wire
contract: nunca se renombran, solo se agregan), tipos de dominio (`UserRole`,
`KycStatus`, `AccountStatus`). Consumida como npm workspace real desde `gateway/` y los
servicios Node (`package.json: "@movo/shared": "*"`).

### MOVO-68 — Middleware del API Gateway

Implementado: autenticación (`plugins/auth.ts`), autorización por rol
(`app.authorize(roles)`), rate limiting con Redis (`plugins/rate-limit.ts` +
`plugins/redis.ts`), manejador de errores central (`plugins/error-handler.ts`), ruteo
declarativo bajo `/api/v1` (`config/routes-map.ts` + `routes/index.ts`).

Decisiones clave:
- Rutas públicas se declaran por **método+path exacto**, no por prefijo — cualquier ruta
  nueva es protegida por defecto salvo que se liste explícitamente en
  `getPublicRoutes()`. Ver comentario en `routes-map.ts` (zona de conflicto: sumar al
  final de la lista, nunca reordenar).
- Rate limit: general (200/min, configurable vía `RATE_LIMIT_MAX`) + estricto en
  `POST /auth/login` (5 intentos/15min). `register`/`refresh`/`verify-phone` quedan bajo
  el general — decisión abierta si conviene extender el estricto a esos endpoints
  también.
- `@fastify/rate-limit` corre un solo chequeo por request (flag interno
  `rateLimitRan`): el limitador general se registra con `global: false` y se aplica
  explícitamente por ruta junto al estricto, nunca los dos a la vez.
- Solo `svc-users` y `svc-shipments` están conectados al gateway este sprint.
  `svc-payments` y `svc-admin` quedan comentados en `routes-map.ts`, listos para
  descomentar. `svc-pricing-logistics` todavía no tiene ruta pública definida.
- `/webhooks/didit` es un path placeholder — ajustar cuando la US de integración con
  Didit.me defina el path real.
- Confianza en la red interna documentada en ADR-010 (ver tabla de ADRs arriba).

Pendiente / fuera de alcance de MOVO-68: proxy hacia `svc-payments`/`svc-admin`, rate
limit estricto en más endpoints de auth (si el equipo lo decide).

### MOVO-70 — Endpoint de registro de usuario (`svc-users`)

Implementado `POST /auth/register` (ya público en el gateway desde MOVO-68, sin
cambios ahí): `src/modules/auth/{auth.routes,auth.service,auth.schema}.ts`, más
`src/plugins/error-handler.ts` (portado del gateway, primer uso de `ApiError` en
`svc-users`) registrado en `app.ts`.

Decisiones clave:
- **Actualizado al integrar develop (MOVO-85/87/91 mergeados)**: la primera versión de
  esta US traía un `auth.repository.ts` propio (con `createUser` ad-hoc e inserción de
  roles por defecto como literales `'emisor'`/`'transportista'` de la DB), construido
  porque MOVO-87 (user-repository completo) y MOVO-85 (plugin `fastify.db` con
  `search_path`/healthcheck) no habían arrancado todavía. Al mergear develop ese archivo
  se borró: `auth.service.ts` ahora usa `createUserRepository()` de
  `src/repositories/user-repository.ts` (MOVO-87), pasando
  `roles: [UserRole.SENDER, UserRole.CARRIER]` (`DEFAULT_USER_ROLES` en
  `auth.service.ts`) en vez de literales de DB — el mapeo rol/KYC lo resuelve la capa de
  `models/user.ts` (`roleToDb`/`kycStatusFromDb`). El `kycStatus` de la respuesta ahora
  sale de `user.kycStatusIdentity` (leído de la fila recién persistida), no de un
  `KycStatus.NOT_STARTED` hardcodeado. El error de duplicado que se atrapa es
  `UserConflictError` (de `models/user.ts`), no el `DuplicateUserError` propio que existía
  antes — mismo shape (`field: "email" | "phone"`). Ver **MOVO-91** más abajo: cuando esa
  US alinee los enums de la DB a `@movo/shared`, esta capa de mapeo desaparece pero el
  código de `auth.service.ts` no debería necesitar cambios (ya consume tipos de dominio,
  no literales de DB).
- `fullName` se separa en `first_name`/`last_name` (la migración no tiene un campo
  único) partiendo por el primer espacio; el schema exige al menos dos palabras.
- Teléfono normalizado a E.164 argentino (`+549` + 10 dígitos) sin importar si el
  usuario mandó `+54`, `9`, ambos o ninguno — normalización en
  `auth.service.ts#normalizePhoneToE164Ar`.
- AC3/AC4 (409 en duplicado) se resuelven confiando en los índices únicos de la
  migración (`users_email_lower_idx`, `users_phone_key`) y traduciendo la violación de
  Postgres (código `23505`) al código de error correspondiente, en vez de un `SELECT`
  previo — evita una ventana de carrera entre el chequeo y el `INSERT`.
- Hash de contraseña con **`@node-rs/argon2`** (Argon2id), no `argon2` (paquete nativo
  vía `node-gyp`): falló al instalar en Windows sin Visual Studio Build Tools.
  `@node-rs/argon2` trae binarios prebuilt (napi-rs) por plataforma, sin compilación
  local — más portable para un equipo con máquinas dev distintas.
- Se agregaron dos códigos nuevos al contrato `ApiErrorCode` de `@movo/shared`:
  `USER_EMAIL_ALREADY_EXISTS`, `USER_PHONE_ALREADY_EXISTS` (409).
- El error-handler de `svc-users` también normaliza errores de validación de schema
  (AJV) al formato único (`VALIDATION_FAILED`, 400) — antes no existía ningún
  `setErrorHandler` en este servicio.
- **Decisión de scope (04/08, coordinada con el equipo vía comentario en Linear)**: en
  los comentarios del ticket se propuso extender el contrato con `dni`/`address` y mover
  la verificación de teléfono por OTP a *antes* de la creación de la cuenta (`register`
  exigiendo un `phoneVerificationToken`). Ninguna de las dos entra en esta US:
  - `dni`/`address` quedan afuera del payload de `POST /auth/register` — si hacen falta,
    van en una US de perfil aparte, todavía sin definir.
  - El flujo OTP-antes-del-registro es contrato de **MOVO-71** ("Verificación de
    teléfono por OTP"), que sigue en Todo con el AC original (OTP *después* de crear la
    cuenta). MOVO-70 no implementa `phoneVerificationToken` hasta que MOVO-71 se
    actualice al nuevo orden — evita que este endpoint quede bloqueado por un ticket que
    ni siquiera arrancó.
  - La normalización de `account_status`/KYC (parte de lo que pedía el AC7 original) es
    alcance de **MOVO-92** ("Chore actualización de la Entidad User"), en curso en
    paralelo (Pedro Yorlano) — no de MOVO-70.

Pendiente / fuera de alcance de MOVO-70: suite de tests corrida completa tras el merge
con develop, contra Postgres/Redis reales — **59/59 tests pasan**, cobertura 94%
statements / 84.21% branches / 100% funciones (umbral configurado: 55%). `tsc --noEmit`,
`eslint` y `npm run build` sin errores.

### MOVO-85 — Plugin de conexión PostgreSQL en movo-svc-users (`fastify.db`)

Implementado en `src/plugins/db.ts`: pool de `pg` decorado como `fastify.db`,
`search_path` fijado al schema `users`, manejo de errores de pool sin tumbar el
proceso, y `checkDbHealth()` para el futuro `GET /health` (MOVO-89).

Decisiones clave:
- `search_path` se fija vía el parámetro de conexión `options: "-c search_path=users,public"`
  (aplicado por Postgres en el handshake), no con un `client.query("SET search_path...")`
  en el evento `connect` del pool — esa alternativa generaba una carrera real entre esa
  query y la primera query del caller sobre el mismo cliente (warning de deprecación de
  `pg` por queries superpuestas). La vía por connection param es atómica y no la tiene.
- `pool.on("error", ...)` solo loguea — `pg.Pool` reconecta solo en el próximo uso, no
  hace falta lógica de retry manual.
- `checkDbHealth()` replica el shape de `checkRedisHealth()` (MOVO-86) a propósito, para
  que MOVO-89 pueda componer ambos con `Promise.all` sin adaptar nada.
- Límites de pool explícitos (`max: 10`, `idleTimeoutMillis`, `connectionTimeoutMillis`)
  agregados más allá de lo pedido por el AC, para no depender de los defaults de `pg` en
  una EC2 sin autoscaling (ADR-006).
- `checkDbHealth()` NO usa `Promise.race` con timeout manual: si Postgres cuelga en vez
  de responder, esa técnica no cancela la query real — `pool.query` sigue viva y retiene
  el cliente para siempre (con `max: 10`, pocos healthchecks colgados agotan el pool y
  tumban el servicio para requests reales). Se corrigió vía `statement_timeout` +
  `query_timeout` en la config del `Pool` (línea de `new Pool({...})`): Postgres cancela
  la query server-side y `pg-pool` trata el timeout como error de cliente, evictando y
  destruyendo el cliente colgado (`_release` → `_remove` → `client.end()`) en vez de
  devolverlo al pool. Corregido a partir de comment de review en MOVO-85.

Pendiente / fuera de alcance: el endpoint `GET /health` en sí (MOVO-89) y el
`user-repository` completo sobre este plugin (MOVO-87) — ambos consumen `fastify.db` /
`checkDbHealth()` sin necesitar cambios de este plugin.

### MOVO-87 — `user-repository`: capa de acceso a datos de usuarios

Implementado en `src/repositories/user-repository.ts` + `src/models/user.ts`:
`findByEmail`/`findByPhone`/`findById` (case-insensitive en email), `create` (usuario +
roles en una transacción), `updateKycStatusIdentity`/`updateKycStatusLicense`. Se
consolidó ahí también el `count()` que vivía en el scaffold viejo de
`modules/users/users.repository.ts` (borrado).

Decisiones clave:
- `updateKycStatus(id, status)` del AC se implementó como **dos** métodos
  (`updateKycStatusIdentity`/`updateKycStatusLicense`) en vez de uno, porque la tabla
  tiene dos columnas KYC — el de identidad es el que gobierna autorización general
  (ADR-004), el de licencia es solo persistencia (no lógica de MOVO-15). Detalle en
  comentario de MOVO-87 en Linear.
- `create()` excede la firma literal del AC (`create(userData)`): también acepta
  `roles` e inserta en `users.users` + `users.user_roles` en una sola transacción,
  coordinado con MOVO-70 (Alena tenía un repo local propio para no bloquearse, ver
  comentarios en MOVO-87).
- El array de roles agregado con `array_agg(ur.role::text)` necesita el cast a `text`:
  `pg` no conoce el OID de un enum custom de Postgres y sin el cast devuelve el array
  como el string literal crudo (`"{...}"`), no un array de JS.
- `vitest.config.ts` del servicio: se agregó `fileParallelism: false` (los tests de
  integración pegan contra el mismo Postgres real con `TRUNCATE` en `beforeEach` — sin
  esto, archivos de test corriendo en paralelo se pisan datos entre sí) y se amplió el
  `include` de coverage a `src/repositories/**`/`src/models/**` (antes solo medía
  `src/modules/**`, dejando afuera `session-repository.ts` de MOVO-88 y todo este
  ticket).
- **Mismatch de enums (rol/KYC) entre `@movo/shared` y la DB, resuelto y luego
  revertido**: MOVO-87 lo resolvió originalmente con una capa de mapeo explícita
  (`roleToDb`/`roleFromDb`/`kycStatusToDb`/`kycStatusFromDb` en `models/user.ts`). El
  equipo decidió después alinear los enums de la DB a `@movo/shared` en vez de mantener
  el mapeo — ver **MOVO-91** más abajo, que reemplaza esa capa.

Correcciones a partir del review del PR #28 (MOVO-87):
- **`InvalidEnumValueError`** (`models/user.ts`): `roleFromDb`/`kycStatusFromDb` tiraban
  `Error` genérico, indistinguible de un fallo de conexión para el que lo atrapa. Un
  valor de enum sin equivalente en `@movo/shared` es drift de schema (integridad), no
  algo transitorio que convenga reintentar. `kycStatusFromDb` ahora recibe el nombre de
  columna porque el mismo enum respalda `kyc_status_identity` y `kyc_status_license`.
  `roleToDb` queda con `Error` genérico a propósito: ese caso es bug de código.
- **`PublicUser` + `toPublicUser()`** (`models/user.ts`): `User` es interno e incluye
  `passwordHash`; el DTO público lo excluye vía `Omit`. `toPublicUser` se construye
  campo por campo y no con spread, para que agregar una propiedad a `User` rompa en
  compilación y obligue a decidir si es pública, en vez de filtrarla por defecto.
- **`create()` relee la fila persistida** antes del `COMMIT` (mismo `client`, ve sus
  propias escrituras) en vez de derivar los roles de `input.roles`. Las columnas del
  usuario ya venían de `RETURNING *`; el hueco eran solo los roles.
- ⚠️ **Al rebasear MOVO-91 sobre esto**: el commit que elimina la capa de mapeo borra
  las mismas funciones donde vive `InvalidEnumValueError`. Resolver el conflicto tomando
  "la versión de 91" hace desaparecer el fix **sin que falle ningún test** (los casts de
  91 no validan nada). Hay que reponerlo como `parseUserRole`/`parseKycStatus` que
  validen contra `Object.values(...)` antes del cast en `mapRowToUser`, y actualizar los
  literales de los tests de `toPublicUser` a los valores alineados (`sender`, `pending`).

Pendiente / fuera de alcance: reputación, verificación real de licencia (MOVO-25,
MOVO-15), endpoints de registro/login/KYC (MOVO-70 y siguientes).

### MOVO-91 — Alinear enums de `users.users` con `@movo/shared`

Revierte la capa de mapeo de MOVO-87: en vez de traducir entre el enum de Postgres
(español/mayúscula) y `@movo/shared` (inglés/minúscula) en cada lectura/escritura, se
alinea la DB a `@movo/shared` (que no se toca, sigue siendo la fuente de verdad) vía
`ALTER TYPE ... RENAME VALUE` (preserva filas existentes, no requiere migrar datos).
Ticket nuevo en vez de reabrir MOVO-84 (ya Done), para dejar trazado en la memoria del
TFG por qué se tocó un schema ya cerrado.

_(completar detalle de archivos/decisiones cuando se termine de implementar)_

### MOVO-89 — `GET /health` con estado de PostgreSQL y Redis

Implementado en `src/modules/health/` (`health.routes.ts` + `health.schema.ts`),
registrado desde `app.ts` en reemplazo del stub que devolvía `{ status: "ok" }` fijo.
Compone `checkDbHealth()` (MOVO-85) y `checkRedisHealth()` (MOVO-86) — es el único
sub-issue de MOVO-66 que integra ambos plugins.

Decisiones clave:
- **Códigos de status**: 200 ambas OK, **503** si falla una, **502** si fallan las dos.
  El AC 3 original decía "503 si alguna falla"; se ajustó a pedido del equipo (ticket
  actualizado en Linear). Para el `HEALTHCHECK` de Docker es indistinto —cualquier
  no-2xx cuenta como fallo—, la distinción es para diagnóstico humano.
- **El body nunca lleva el detalle del error.** `checkDbHealth`/`checkRedisHealth`
  devuelven el mensaje crudo de `pg`/`ioredis`, que puede incluir usuario, host o puerto
  de la conexión, y `/health` se sirve sin autenticación. El handler lo loguea con
  `app.log.error` y publica sólo `status`. El schema de respuesta es la segunda barrera:
  Fastify serializa únicamente lo declarado, así que un descuido futuro tampoco filtra.
  Viene del review de MOVO-85, donde se difirió explícitamente a esta issue.
- Los dos checks corren con `Promise.all`: la latencia es la del más lento y no la suma
  (AC 2). Ninguna de las dos funciones rechaza, así que `Promise.all` no corta antes.
- **`Dockerfile`: `HEALTHCHECK --timeout` de 5s a 10s.** El pool corta las queries a los
  5s (`statement_timeout`/`query_timeout`, MOVO-85), así que con Postgres "vivo pero
  mudo" el check tardaba exactamente el límite y Docker mataba el `wget` antes de que se
  entregara el 503 — nunca se veía el body que dice cuál dependencia cayó. Con Postgres
  caído de verdad (conexión rechazada) falla al instante y esto no aplica.
- Vocabulario del body (`status` + `checks`, valores `ok`/`error`) elegido para que lo
  copien el resto de los servicios: reusa el mismo shape que ya devuelven los dos
  plugins, sin traducir.

Pendiente / fuera de alcance: el gateway no rutea el `/health` de los servicios (se
consulta desde dentro de la red Docker), su propio `/health` sigue siendo un stub.
