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
| 011 | Prisma como ORM estándar para todos los servicios Node de MOVO (primera implementación en `movo-svc-users`, los demás lo adoptan al tener dominio real) | Curva de aprendizaje del equipo; requiere driver adapter (`@prisma/adapter-pg`, Prisma 7) y baselinear las 2 migraciones SQL ya aplicadas como histórico |
| 012 | Twilio como proveedor de SMS para OTP (MOVO-71), detrás de una interfaz `SmsProvider`; implementación de consola es el default de dev/test/CI, Twilio real queda reservado para la demo final | Sin envío real de SMS fuera de la demo — limitación aceptada para no incurrir en costos de una API externa de pago (riesgo R10 del plan de proyecto); el adapter (riesgo R11) permite activar Twilio de verdad solo cambiando `SMS_PROVIDER` |

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
- **Integración con MOVO-91 (hecha)**: 91 elimina las funciones donde vivía
  `InvalidEnumValueError`, así que el conflicto podía "resolverse" tomando la versión de
  91 y hacer desaparecer el fix sin que fallara ningún test (los casts no validan nada).
  Se conservó la validación, portada a `parseUserRole`/`parseKycStatus` — ver MOVO-91
  más abajo.

Pendiente / fuera de alcance: reputación, verificación real de licencia (MOVO-25,
MOVO-15), endpoints de registro/login/KYC (MOVO-70 y siguientes).

### MOVO-91 — Alinear enums de `users.users` con `@movo/shared`

Revierte la capa de mapeo de MOVO-87: en vez de traducir entre el enum de Postgres
(español/mayúscula) y `@movo/shared` (inglés/minúscula) en cada lectura/escritura, se
alinea la DB a `@movo/shared` (que no se toca, sigue siendo la fuente de verdad) vía
`ALTER TYPE ... RENAME VALUE` (preserva filas existentes, no requiere migrar datos).
Ticket nuevo en vez de reabrir MOVO-84 (ya Done), para dejar trazado en la memoria del
TFG por qué se tocó un schema ya cerrado.

Implementado: migración `20260731200000_align_user_enums_with_shared.sql` (+
`.down.sql`) con `ALTER TYPE ... RENAME VALUE` — `users.user_role_enum` pasa de
`emisor/transportista/admin` a `sender/carrier/admin`; `users.kyc_status_enum` de
mayúscula a minúscula (`not_started/pending/approved/rejected/expired`); `DEFAULT` de
columna re-especificado explícitamente por claridad (aunque el rename ya los actualiza
solo, al estar resueltos por OID y no por texto).

Se borró por completo la capa de mapeo de MOVO-87 en `models/user.ts`
(`roleToDb`/`roleFromDb`/`kycStatusToDb`/`kycStatusFromDb` y sus diccionarios):
ya no hay traducción, el literal de DB y el valor de dominio son el mismo string.
`user-repository.ts` pasa `UserRole`/`KycStatus` directo como parámetro de query.

**Corrección al integrar con develop (PR #29):** la versión original de MOVO-91
reemplazaba la capa de mapeo por casts sin validar (`row.kyc_status_identity as
KycStatus`), con el argumento de que la columna es un enum de Postgres y físicamente no
puede tener un valor fuera del enum. El argumento es cierto pero cubre el riesgo
equivocado: lo que puede entrar es un valor que **sí** está en el enum de Postgres pero
**no** en `@movo/shared` (un `ALTER TYPE ... ADD VALUE` que no actualice el dominio).
Esa desalineación no es hipotética — es exactamente la que motivó este ticket. Y los
roles gobiernan autorización (ADR-004), así que un valor inválido entrando en silencio
llega a los claims del JWT. Se conserva entonces la validación que MOVO-87 sumó por
review, portada a la forma alineada: `parseUserRole`/`parseKycStatus` chequean contra
`Object.values(...)` y tiran `InvalidEnumValueError` antes de castear.

Pendiente: el ticket de Linear queda abierto (no se pasa a Done) a pedido del usuario.
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

### Hotfix — Migraciones de DB automáticas en deploy (`ci-dev.yml` / `ci-prod.yml`)

Los deploys a dev/prod nunca corrían los `.sql` de `services/*/migrations/` contra la
base real de la EC2 — `scripts/run-migrations.sh` solo se usaba en el job de tests,
contra el Postgres efímero del CI. Se agregaron dos steps nuevos a `deploy-dev` y
`deploy-prod` (antes del step que pushea las imágenes nuevas, para que ningún
contenedor arranque contra un schema desactualizado): copian el script + las carpetas
`migrations/` de cada servicio a la EC2, y por SSH levantan Postgres, esperan a que
esté listo (`pg_isready` vía `docker exec`) y corren las migraciones de `svc-users`,
`svc-shipments`, `svc-payments` y `svc-admin` en ese orden.

Decisiones clave:
- Como Postgres no expone puerto público en la EC2 (ADR-010), la migración se aplica
  vía `docker exec` dentro del propio contenedor — mismo fallback que ya tenía
  `run-migrations.sh` para cuando no hay `psql` en el host, ahora es el camino
  principal en producción/dev, no un fallback incidental.
- **`scripts/run-migrations.sh` ahora lleva registro de lo aplicado** en una tabla
  `public.schema_migrations` (compartida entre servicios, una sola instancia de
  Postgres — ADR-003), con `(service, filename)` como clave. Antes, el script
  reaplicaba todos los `.sql` de la carpeta en cada corrida — funcionaba de pura
  suerte porque la única migración real hasta ahora está escrita con guards
  `IF NOT EXISTS`. Corriendo automáticamente en cada deploy contra una base
  persistente, eso ya no alcanza: una migración futura no-idempotente (un
  `ALTER TABLE ADD COLUMN` con backfill, un `INSERT`) rompería el segundo deploy.
  Cada migración se aplica junto con su `INSERT` al ledger en la misma transacción
  (`BEGIN`/`COMMIT`), así una falla a mitad de camino no la deja marcada como
  aplicada sin estarlo.
- Verificado localmente contra Postgres real: primera corrida aplica y registra,
  segunda corrida saltea todo sin tocar la DB.

Este hotfix se armó y mergeó directo a `main` (rama `hotfix/run-db-migrations-on-deploy`)
mientras `develop` tenía en curso la adopción de Prisma (MOVO-93, más abajo) — de ahí
que el step haya tenido que rehacerse desde cero en `develop` al promoverlo (ver
**Fix — Reponer migraciones de deploy** más abajo, que documenta esa reconstrucción y
dos bugs nuevos que aparecieron recién al correr contra la EC2 real).

### MOVO-93 — Adoptar Prisma como ORM en `movo-svc-users`

ADR-011: Prisma pasa a ser el ORM estándar para **todos** los servicios Node de
MOVO, no una decisión puntual de este servicio. `movo-svc-users` es la primera
implementación porque es el único con dominio real hoy — `svc-shipments`/
`svc-payments`/`svc-admin` siguen siendo placeholders (`SELECT 1`, sin schema real) y
por eso siguen con `run-migrations.sh` por ahora; adoptan Prisma desde el arranque
cuando empiecen a modelar su dominio, en vez de escribir SQL a mano y migrar después.

Implementado:
- `prisma/schema.prisma`: modela a mano (no `db pull`) las 2 migraciones SQL ya
  aplicadas — `datasource` con `schemas = ["users"]` (multi-schema, GA desde 5.15, sin
  `previewFeatures`), modelos `User`/`UserRoleGrant` con `@map`/`@@map` a las columnas y
  tablas snake_case existentes, enums `UserRole`/`KycStatus` mapeados a
  `user_role_enum`/`kyc_status_enum`. `generator client` usa `moduleFormat = "cjs"` — el
  resto del servicio sigue siendo CommonJS, no se fuerza la conversión a ESM que Prisma 7
  trae por default.
- **Prisma 7 requiere driver adapter para providers SQL** (`@prisma/adapter-pg`, sobre
  `pg`) — `new PrismaClient()` sin adapter no compila. `src/plugins/db.ts` instancia
  `PrismaPg` con los mismos timeouts que tenía el `Pool` de MOVO-85
  (`statement_timeout`/`query_timeout`/`connectionTimeoutMillis`) y decora `app.db` con
  el `PrismaClient` resultante. Se cae el `search_path=users,public` que fijaba MOVO-85:
  con `schemas = ["users"]`, Prisma genera SQL con el schema ya calificado
  (`"users"."users"`), no depende de search_path.
- Las 2 migraciones SQL existentes (`20260728160000_create_users_schema`,
  `20260731200000_align_user_enums_with_shared` de MOVO-91) se copiaron tal cual a
  `prisma/migrations/<mismo-nombre>/migration.sql` y se marcaron como aplicadas con
  `prisma migrate resolve --applied` — no se re-ejecutan, Prisma solo las trata como
  historial. Migraciones nuevas de acá en adelante se crean con
  `prisma migrate dev`/`migrate deploy` (`npm run migrate`/`migrate:dev`), no a mano.
- `user-repository.ts` reescrito con `PrismaClient`: `create()` pasa a un nested write
  (`user.create({ data: { ..., roles: { create: [...] } } })`), atómico por diseño de
  Prisma, reemplaza el `BEGIN`/`COMMIT` manual. `findByEmail` usa el filtro
  `mode: "insensitive"` de Prisma en vez de `LOWER(email) = LOWER($1)` a mano — el índice
  funcional `users_email_lower_idx` de la migración original sigue en la DB pero no tiene
  representación en `schema.prisma` (Prisma no modela expression indexes).
- **Hallazgo empírico, no documentado así en la guía de Prisma**: con el driver adapter
  de Prisma 7, un conflicto de unicidad (`P2002`) no expone los campos en
  `error.meta.target` como en versiones anteriores — vienen anidados en
  `error.meta.driverAdapterError.cause.constraint.fields`. Verificado corriendo un script
  ad-hoc contra Postgres real antes de confiar en la forma del error (Prisma 7.9.1). Está
  documentado como comentario en `user-repository.ts#uniqueConstraintFields` por si una
  futura versión de Prisma cambia el shape.
- `update()` de Prisma tira `P2025` si el id no existe, en vez de devolver 0 filas como el
  `UPDATE ... RETURNING *` original — `updateKycStatusIdentity`/`updateKycStatusLicense`
  atrapan `P2025` y devuelven `null`, preservando el contrato previo.
- Tests de integración migrados de `app.db.query(...)` (API de `pg`) a la API tipada de
  Prisma o `$queryRaw`/`$executeRawUnsafe` cuando hace falta SQL crudo:
  `user-repository.integration.test.ts`, `auth.register.integration.test.ts`,
  `db.plugin.test.ts`, `users.count.integration.test.ts`. El test de `db.plugin.test.ts`
  que verificaba `search_path` se reemplazó por uno que prueba que una query contra el
  schema `users` resuelve bien sin depender de él (ver arriba).
- **Bug preexistente en `develop` encontrado de paso, no introducido por esta US**:
  `auth.register.integration.test.ts` (MOVO-70) todavía esperaba los literales de enum
  pre-MOVO-91 (`"NOT_STARTED"`, `"emisor"/"transportista"`) — el último push a `develop`
  (merge de MOVO-91) quedó en CI rojo por esto. Se corrigió en el mismo commit al migrar
  ese test a Prisma.
- CI: `pr-checks.yml`/`ci-dev.yml`/`ci-prod.yml` — el step "Run migrations" se separó en
  dos, condicionados por `matrix.service.name`: `npx prisma migrate deploy` para
  `movo-svc-users`, `run-migrations.sh` sin cambios para los demás.
- `package.json`: `postinstall: prisma generate` (se regenera el cliente en cada
  `npm ci`/`install`, no se commitea `src/generated/prisma/` — gitignored). `prisma`
  como **dependency, no devDependency**: la CLI viaja en la imagen de producción a
  propósito (ver Dockerfile abajo).
- **Dockerfile**: el stage de runtime copia también `prisma.config.ts` y `prisma/`
  (schema + migraciones), y ya no usa `--omit=dev` para excluir `prisma` (ahora es
  dependency). Motivo: Postgres no expone puerto público en la EC2 (ADR-010), así que
  no hay forma de correr `prisma migrate deploy` desde afuera del contenedor — el
  deploy tiene que invocarlo *dentro* de la imagen ya pulleada, con
  `docker compose run --rm movo-svc-users npx prisma migrate deploy`, sin instalar
  nada nuevo en la EC2 ni depender de red hacia el registry de npm desde prod. Los dos
  `npm ci` del Dockerfile siguen con `--ignore-scripts`: en ninguno de los dos stages
  está copiado `prisma/schema.prisma` en el momento en que corre `npm ci` (se copia
  package.json solo, para cachear la capa de deps aparte del código fuente); el
  builder corre `prisma generate` explícito ya con el código fuente copiado, el
  runtime no lo necesita (usa el cliente ya compilado en `dist/`).
- Verificado con la imagen ya buildeada (no en una imagen de desarrollo): `docker run
  ... npx prisma migrate deploy` aplica las 2 migraciones contra Postgres real, una
  segunda corrida es no-op, y la app sigue arrancando y sirviendo `/health` normal.

Pendiente / fuera de alcance de MOVO-93 (ver corrección más abajo): el commit
`992fd60` de esta rama ("ci: correr prisma migrate deploy para movo-svc-users en los
workflows") agregó el step de migraciones Prisma dentro del job de tests
(`node-services`, contra el Postgres efímero del CI) pero de paso **borró por
completo** el bloque `Aplicar migraciones de base de datos en dev/prod` de
`deploy-dev`/`deploy-prod` — el que agregó el hotfix
`hotfix/run-db-migrations-on-deploy` contra `main` y corre migraciones reales contra
la EC2 por SSH. No fue un ajuste del loop, fue una eliminación del step entero: esta
rama se creó antes de que ese hotfix llegara a `main`, así que en el `develop` de
origen ese bloque todavía no existía como para "ajustarlo" — el TODO que dejó el
hotfix avisando este punto de integración quedó, sin querer, resuelto de la forma
más rota posible (ningún servicio migra contra la EC2 real en deploy, ni con
Prisma ni con SQL).

### Fix — Reponer migraciones de deploy tras la integración con MOVO-93

Detectado antes de promover `develop` a `main` (habría sido una regresión
silenciosa: CI en verde, deploy en verde, pero ningún contenedor con schema al
día). Repuesto en `ci-dev.yml`/`ci-prod.yml` el step `Aplicar migraciones de base de
datos en dev/prod` que había desaparecido, con el mismo mecanismo SSH/`docker exec`
de siempre para `svc-shipments`/`svc-payments`/`svc-admin`, y `movo-svc-users`
separado con `docker compose run --rm -T movo-svc-users npx prisma migrate deploy`
(la imagen ya trae la CLI de Prisma + `prisma/migrations`, ver comentario en el
Dockerfile del servicio) tal como indicaba el TODO original.

Decisión clave: antes del `prisma migrate deploy` se agrega
`docker compose pull movo-svc-users` explícito — `docker compose run` no repullea
una imagen que ya existe localmente con el mismo tag (`policy: missing`), y en este
punto del workflow el pull general recién pasa en el step siguiente. Sin este pull
explícito, el deploy migraría con el schema de la imagen vieja.

Segundo hallazgo relacionado: `scripts/run-migrations.sh` en `develop` también era
la versión **sin ledger** (`develop` nunca recibió el hotfix
`run-db-migrations-on-deploy`, que fue directo a `main`) — el mismo script que el
CLAUDE.md documentaba como corregido, en `develop` seguía reaplicando todas las
migraciones `.sql` en cada corrida. Se reemplazó por la versión de `main` con la
tabla `public.schema_migrations` y `BEGIN`/`COMMIT` por archivo.

### Fix — Percent-encoding de DATABASE_URL para Prisma

El primer deploy a dev con el step repuesto (arriba) rompió igual:
`prisma migrate deploy` tiraba `P1013: invalid port number in database URL`. Causa:
la password de Postgres en Secrets Manager sale sin percent-encodear, y trae
caracteres reservados de RFC 3986 (`/`, `#`, `%`, `{`, `}`, etc. — password generada
aleatoriamente). `node-postgres` (`pg`, usado por `svc-shipments`/`payments`/`admin`
y por el resto de la app antes de MOVO-93) parsea ese connection string con un regex
propio tolerante; el parser de Prisma no, y rompe apenas encuentra un `/` o similar
donde no lo espera.

Fix en el step "Generar .env desde Secrets Manager" de `ci-dev.yml`/`ci-prod.yml`:
después de volcar el secret a `.env`, se re-escribe la línea `DATABASE_URL=` con
user/password percent-encodeados (`urllib.parse.quote` vía `python3 -c`, invocado
desde bash con regex `[[ =~ ]]`/`BASH_REMATCH` para no depender de parsing YAML/JSON
adicional). Percent-encodeado es válido también para `pg` (lo decodea), así que no
rompe a los otros servicios.

De paso, se reemplazó el `set -a; source .env; set +a` de esas mismas migraciones
(pre-existente desde el hotfix original, también en `main`) por un loop
`while IFS='=' read` que exporta cada variable sin que bash intente parsear el
`.env` como script — la password con caracteres especiales rompía el `source`
literal (`syntax error near unexpected token`), silencioso hasta ahora porque el
único valor que se leía de ahí (`POSTGRES_USER`) tenía default `movo` que
coincidía por casualidad.

Confirmado en dev: `workflow_dispatch` de `ci-dev.yml` corrió entero contra la EC2
(deploy + migraciones + baseline de Prisma) antes de promover `develop` a `main`.

### Fix — Password con `@` rompía el split de user/password en DATABASE_URL

Al promover a `main`, el primer deploy a **prod** no llegó ni al P3005 (baseline):
`prisma migrate deploy` tiraba `P1001: Can't reach database server at
'eGs-W.9}9H:5432'` — un host que no existe, con pinta de fragmento de la password.
Causa: la password de prod (a diferencia de la de dev) tiene un `@` adentro. El
regex del fix anterior, `([^@]+)@`, corta en el **primer** `@` que encuentra —
aunque esté adentro de la password — y deja el resto de la password pegado al host
real en el grupo "rest", que se vuelca sin encodear al `DATABASE_URL` final.
`pg` nunca tuvo este problema: su parser corta en el **último** `@`.

Fix: el grupo de la password pasa a ser `(.+)` (codicioso, sí puede contener `@`)
seguido de `@([^@]+)$` para el host — el motor de regex hace backtrack del
codicioso hasta el último `@` posible, que es el separador real. Verificado en
local con una password sintética que incluye `@` en el medio: separa host/puerto
correctos y decodea exacto a la password original.

Pendiente: falta el baseline manual de Prisma (`prisma migrate resolve --applied`
para las 2 migraciones históricas) contra `api.movosend.app` — el P1001 pasó antes
de llegar a esa validación, así que sigue sin hacerse. Primera corrida de
`ci-prod.yml` después de este fix va a fallar con P3005 (mismo motivo que en dev)
hasta correr el baseline.

### MOVO-92 — Chore actualización de la Entidad User

Normalización y alineación completa de la entidad `User` en todo el repositorio según las definiciones del equipo (DER / MOVO-92):
- **`@movo/shared`**: `AccountStatus` actualizado a `active`, `banned`, `deleted`.
- **Prisma & DB**: Migración `20260804210000_update_user_entity_movo_92.sql` + actualización de `schema.prisma`. Se removieron los campos obsoletos de KYC (`last_kyc_verification_identity_id` y `last_kyc_verification_license_id`) y el booleano `is_banned`. Se agregaron la columna `status` (`account_status_enum` default `'active'`) y `birthdate` (`DATE` nullable).
- **Dominio & Repositorio**: `models/user.ts` (interfaces `User`, `PublicUser`, `UserRow`, `CreateUserInput`, validador `parseAccountStatus`), `repositories/user-repository.ts` y suite de tests en `test/` refactorizados y 100% en verde.

### Hotfix — `docker image prune` automático en deploy (dev/prod)

Incidente en prod (04/08): el deploy de una PR mergeada a `main` falló a mitad de
camino — "no space left on device" al pullear imágenes nuevas. El disco de la EC2
(6.8GB) se había llenado de imágenes `<none>` acumuladas de deploys anteriores: cada
deploy mueve el tag (`:dev`/`:prod`) a la imagen nueva y deja la vieja como dangling,
y ningún paso del workflow las borraba nunca. `movo-svc-users` y `proxy` quedaron sin
poder recrearse, prod quedó con `svc-users` corriendo en una imagen vieja/sin tag
(código desalineado del schema recién migrado) hasta la recuperación manual.

Fix en `ci-dev.yml`/`ci-prod.yml`: al final del step "Pull de imágenes nuevas y restart
de contenedores", después de `docker compose up -d`/`restart proxy` (con los
contenedores nuevos ya arriba, así solo se borra lo que nadie usa), se agrega
`docker image prune -af`. Deliberadamente **sin** `--volumes` — ese flag sí puede
borrar volúmenes no referenciados por ningún contenedor en el momento del prune (ahí
vive `movo_postgres-data`), y no hace falta para liberar el espacio que ocupan las
imágenes.

De paso, se agregó rotación de logs (`x-logging` en `infra/docker-compose.yml`,
`json-file` con `max-size: 10m` / `max-file: 3`, aplicado a los 9 servicios) —
preventivo: al revisar el incidente, los logs no resultaron ser la causa (contenedores
recién recreados, tamaños insignificantes), pero el driver `json-file` no tiene tope
por default y es el mismo tipo de problema (disco chico, ADR-006) que ya nos mordió una
vez con las imágenes.

Pendiente / fuera de alcance de este hotfix: aumentar el tamaño de disco de la EC2 si
vuelve a quedar justo — el prune y la rotación de logs resuelven la acumulación, no un
piso de espacio muy chico de por sí.

### MOVO-71 — Verificación de teléfono por OTP (`svc-users`)

**Cambio de contrato respecto al AC original, ya resuelto y reflejado en Linear (ver
nota de MOVO-70 más arriba, ahora desactualizada en ese punto)**: el OTP se verifica
**antes** de crear la cuenta, no después. `POST /api/v1/auth/register` (MOVO-70, todavía
sin implementar ese lado) va a requerir un `phoneVerificationToken` emitido acá.

Implementado: `src/repositories/otp-repository.ts` (Redis, motor genérico — no sabe que
`target` es un teléfono, a propósito, para poder reusarlo en el reset de contraseña de
MOVO-64 sin reescribir esta capa), `src/services/otp-service.ts` (genera/verifica/reenvía,
hashea con `@node-rs/argon2` igual que las contraseñas), `src/adapters/{sms-provider,
console-sms-provider,twilio-sms-provider}.ts` (AC8), `src/modules/auth/
phone-verification.service.ts` (capa específica de teléfono: normaliza, orquesta
`otp-service`, emite/consume el `phoneVerificationToken`), 3 rutas nuevas en
`auth.routes.ts`/`auth.schema.ts` (`send-otp`, `verify-otp`, `resend-otp`).

Decisiones clave:
- **Invariante: un solo OTP activo por target.** `otp-repository.create()` invalida
  cualquier OTP previo del mismo `target` (índice secundario `otp:target:{target}` →
  `otpId`) antes de crear uno nuevo — sin esto, llamar `send-otp` repetidas veces después
  de vencido el cooldown (pero antes del TTL de 10 min) dejaba códigos válidos
  simultáneos, cada uno con su propio presupuesto de 5 intentos.
- **`resend-otp` siempre genera un código nuevo** bajo el mismo `otpId`: como el código
  se guarda hasheado (nunca en claro, AC3), reenviar el original es imposible — el texto
  plano no existe en ningún lado después del envío inicial.
- **AC2 se agregó al ticket después de la primera pasada de implementación** (el mensaje
  de SMS tiene que recordar no compartir el código y que nadie de Movo lo va a pedir —
  mitiga ingeniería social contra OTP). Detectado al cerrar la US comparando contra el
  ticket de nuevo. `buildOtpMessage(code)` centralizado en `adapters/sms-provider.ts`,
  usado tanto por `TwilioSmsProvider` como por el log de `ConsoleSmsProvider` (para que
  en dev se vea el texto real), con test dedicado al contenido del mensaje.
- **`send-otp` nunca devuelve 429**, a propósito: dentro del cooldown de un OTP activo
  devuelve el mismo `otpId` sin mandar SMS de nuevo (evita el bypass obvio de llamar
  `send-otp` en loop en vez de `resend-otp`, que sí devuelve 429).
- **Status codes exactos del AC vigente** (no los que parecían más "estándar" a priori):
  `AUTH_OTP_INVALID` → 401, `AUTH_OTP_EXPIRED` → 422 — ambos con el mismo `message`
  genérico, la distinción vive en `code`/`statusCode`, no en el texto.
- `incrementAttempts` usa un script Lua (`EXISTS` + `HINCRBY`) para que el incremento sea
  atómico: sin esto, un TTL que vence justo entre el `findById` del caller y el
  incremento crea una key "fantasma" de un solo campo, sin TTL.
- `phoneVerificationToken`: JWT firmado con `jsonwebtoken` (no `@fastify/jwt`, para que
  `phone-verification.service.ts` sea un servicio puro sin depender de la instancia de
  Fastify — así lo puede importar MOVO-70 sin acoplarse a rutas), claims `sub` (teléfono
  E.164), `purpose: "phone_verification"`, `jti`, TTL 15 min. **AC6 pone la invalidación
  de un solo uso dentro del scope de esta US** (no solo emitir el token):
  `consumePhoneVerificationToken(token, phone)` valida firma/propósito/expiración/
  teléfono y marca el `jti` como usado en Redis (`SET ... NX`, atómico) — construida acá
  para que MOVO-70 no tenga que reabrir esta capa, aunque el único caller real (el
  `register()` que la va a invocar) todavía no existe.
- Gateway (`gateway/src/config/routes-map.ts`): reemplazadas las tres rutas nuevas por el
  placeholder muerto `POST /auth/verify-phone` (contrato viejo que ya no existe) en
  `getPublicRoutes()` — sin esto, las tres rutas quedan protegidas por defecto (MOVO-68) y
  nadie sin cuenta puede llamarlas, rompiendo el flujo completo. No estaba en el file-list
  original del ticket, pero es una consecuencia necesaria.
- `SMS_PROVIDER` (`console`|`twilio`, default `console`) + credenciales de Twilio nuevas
  en `config/env.ts`/`.env.example` — ver ADR-012. **Auth vía API Key, no Auth Token**
  (recomendación explícita de Twilio: el Auth Token da acceso total a la cuenta y no es
  revocable sin regenerar todo; una API Key se limita en permisos y se revoca sola). El
  SDK espera `twilio(apiKeySid, apiKeySecret, { accountSid })` — el Account SID sigue
  siendo obligatorio (identifica la cuenta) pero ya no es la credencial: son
  `TWILIO_ACCOUNT_SID` + `TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET` +
  `TWILIO_FROM_NUMBER`, las 4 requeridas si `SMS_PROVIDER=twilio`. También agregadas al
  `environment:` de `movo-svc-users` en `infra/docker-compose.yml` (antes solo tenía
  `DATABASE_URL`/`REDIS_URL`/`JWT_SECRET` — sin este paso, cargarlas en Secrets Manager
  no alcanza: el compose no reenvía todo `.env`, enumera variable por variable). Ojo con
  `SMS_PROVIDER=${SMS_PROVIDER:-console}` en ese archivo (no `${SMS_PROVIDER-console}`):
  si la variable está ausente en Secrets Manager, Compose la sustituye por vacío, y una
  env var *presente pero vacía* no matchea el enum de `envSchema` (AJV solo aplica su
  default cuando la variable está ausente) — sin el `:-` el servicio no arranca.
- Tests: `test/otp-repository.test.ts` (Redis puro), `test/auth.otp.integration.test.ts`
  (Fastify + Postgres/Redis reales, con un `SmsProvider` capturador inyectado vía
  `buildApp({ smsProvider })` para poder leer el código generado, ya que nunca sale por
  HTTP — verificado también a mano contra el server real con `SMS_PROVIDER=console`),
  `test/adapters/twilio-sms-provider.test.ts` (única excepción a "nunca mockeado": Twilio
  es una API de pago, se mockea el SDK). 105/105 tests del servicio en verde, cobertura
  92.04% statements / 82.66% branches (umbral: 55%).
- **Bug preexistente encontrado de paso, no introducido por esta US ni corregido acá**:
  `src/plugins/auth.ts` (scaffold viejo de `@fastify/jwt`, sin uso real todavía) lee
  `process.env.JWT_SECRET` directo, pero `env-schema` (detrás de `@fastify/env`) con
  `dotenv: true` nunca escribe en `process.env` — solo arma `app.config`. `npm run dev`
  se cae al boot con "missing secret" salvo que `JWT_SECRET` ya esté exportado en la
  shell (los tests no lo sufren porque lo setean a mano en `beforeAll`). Fuera de alcance
  arreglarlo acá — es el mismo plugin que la nota de MOVO-68/CLAUDE.md ya marca para
  migrar a `signAccessToken`/`verifyAccessToken` de `@movo/shared` cuando se implemente
  login.

Pendiente / fuera de alcance de MOVO-71: `POST /auth/register` (MOVO-70) todavía no
consume `phoneVerificationToken` ni persiste `phoneVerified=true` — la función
`consumePhoneVerificationToken` queda lista para que esa US la use. AC7 ("no se puede
avanzar a KYC sin teléfono verificado") queda satisfecho por construcción del nuevo
orden, no por un chequeo explícito de esta US. Dos pendientes que no son código: falta
pegar el ADR-012 completo (contexto/alternativas) en el Drive — solo se agregó el
resumen de una línea acá, sin permiso de escritura sobre el Doc; y falta cargar las 4
credenciales de Twilio en AWS Secrets Manager (`movo/dev/app-secrets` y
`movo/prod/app-secrets`) para que `SMS_PROVIDER=twilio` funcione fuera de local — el
código ya está listo para tomarlas (ver bullet de `docker-compose.yml` arriba), la
carga real es una acción del equipo con acceso a AWS.

**Agregado tras el merge con `develop` (login MOVO-74, conflicto en `auth.routes.ts`
resuelto combinando ambos lados sin cambiar comportamiento de ninguno)**: se sumó un
tercer `SmsProvider`, `TelegramSmsProvider` (`src/adapters/telegram-sms-provider.ts`),
exclusivo del entorno `develop` (`SMS_PROVIDER=telegram`) — manda el OTP a un grupo de
Telegram vía el HTTP API del bot (`fetch` nativo de Node 20, sin dependencia nueva), en
vez de depender de mirar la consola de EC2 en `api-dev.movosend.app`. El texto del
mensaje identifica teléfono y código (no reusa `buildOtpMessage`, pensado para el
usuario final: acá el destinatario es el grupo de devs). En `prod` se sigue usando
`twilio`. Mismo mecanismo de secrets que Twilio: `TELEGRAM_BOT_TOKEN`/
`TELEGRAM_CHAT_ID` nuevas en `config/env.ts`/`.env.example`/`docker-compose.yml`,
`createSmsProvider` falla rápido al arrancar si faltan con `SMS_PROVIDER=telegram`.
Test: `test/adapters/telegram-sms-provider.test.ts` (mockea `fetch`, mismo criterio que
`twilio-sms-provider.test.ts`). Pendiente, fuera de este cambio de código: crear el bot
con BotFather, agregarlo al grupo de devs, y cargar `SMS_PROVIDER=telegram` +
`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` en `movo/dev/app-secrets` — tarea manual del
equipo con acceso a AWS, igual que el pendiente de credenciales de Twilio de arriba.

### MOVO-74 — Endpoint de login (`POST /auth/login`)

Implementado endpoint de autenticación con credenciales (`phone` + `password`) en `src/modules/auth/` (`auth.routes.ts`, `auth.schema.ts`, `auth.service.ts`), expuesto como `POST /api/v1/auth/login` por el gateway.

Decisiones clave:
- **Respuesta Plana en la Raíz**: Devuelve `200` con `userId`, `accessToken`, `refreshToken`, `expiresIn` (3600s), `kycStatus`, `fullName`, `roles` directamente en la raíz de la respuesta (sin anidar en un objeto `user`), alineado al contrato de `movo-mobile`.
- **Prevención de Timing Attacks**: Si el usuario no existe por teléfono, se ejecuta la verificación de contraseña con Argon2id contra un hash sintético (`DUMMY_HASH`) para garantizar latencia constante y prevenir enumeración de usuarios.
- **Validación de Estado de Cuenta**: Si `user.status` es `banned` o `deleted`, responde `403` con `ApiError` code `"ACCOUNT_SUSPENDED"`.
- **Emisión de Tokens**: Access Token JWT firmado con claims (`sub`, `roles`, `kycStatus`) y TTL de 60 minutos (ADR-004). Refresh token opaco persistido en Redis en `refresh:{userId}:{tokenId}` con TTL de 7 días usando `createSessionRepository`. Soporta múltiples logins simultáneos sin revocar sesiones previas.
- **Swagger & Schema Validation**: Registrado en OpenAPI con esquemas de entrada/salida y códigos HTTP `200`, `400`, `401`, `403`.

### MOVO-72 — Integración con Didit.me: sesión KYC, webhook y máquina de estados (`svc-users`)

Implementado `src/modules/kyc/` (`kyc.routes.ts`/`kyc.schema.ts`/`kyc.service.ts`, sigue
la convención real de módulos del servicio, no el `src/routes/` suelto que sugería el
ticket), `src/adapters/didit-client.ts` (+ `http-didit-client.ts`/`mock-didit-client.ts`/
`didit-signature.ts`), `src/repositories/kyc-verification-repository.ts` +
`src/models/kyc-verification.ts`. Tres rutas nuevas, públicas en el gateway (sin JWT —
ver más abajo): `POST /kyc/session`, `GET /kyc/status`, `POST /kyc/webhook`.

Decisiones clave:
- **Modelo de datos alineado al DER, no inventado**: el usuario compartió el DER vigente
  del dominio (`Movo_DER_1.0.md`) durante la planificación — ya modelaba una tabla
  `KYC_VERIFICATION` (singular: `users.kyc_verification`) con `verification_type` enum
  (`identity`/`license`, minúscula post-MOVO-91 — el DER la dibuja en mayúscula, es solo
  estilo del diagrama), `provider`, `external_session_id` (único), `status`
  (reusa `KycStatus` de `@movo/shared`, no duplica vocabulario), `requested_at`,
  `resolved_at`, `raw_decision`. `User.kycStatusIdentity` sigue siendo el caché de
  lectura rápida que el propio DER documenta ("se necesita acceder a esto cada vez que
  se revisa si un usuario es válido"); toda escritura a `kyc_verification` actualiza ese
  caché en la misma `db.$transaction`. Detalle completo del esquema documentado también
  como comentario en MOVO-72 (Linear), con el compromiso de actualizarlo si algo cambia
  durante la implementación.
- **`KycStatus` de `@movo/shared` no tenía `manual_review`** (mapea "In Review" de
  Didit) — agregado al final del enum (aditivo, mismo criterio que `ApiErrorCode`).
  Migración `20260805235652_add_kyc_verification_movo_72` — generada con
  `prisma migrate dev` pero **editada a mano** después: la primera corrida coló cambios
  de drift no relacionados (VARCHAR→TEXT, `ON UPDATE CASCADE`, un índice recreado) entre
  `schema.prisma` y el SQL original de MOVO-93 — se recortó el `.sql` a solo lo de KYC y
  se verificó con `prisma migrate reset` que la migración recortada aplica limpia sola.
- **Sin tabla de auditoría aparte**: AC11 pide "tabla de auditoría **o** log
  estructurado" (no ambas) — se cubre con logging estructurado (pino, ya activo,
  `Fastify({ logger: true })`) en cada transición, más la propia `kyc_verification`
  como historial persistente. Evita una segunda tabla (`kyc_events`) que se había
  diseñado en una iteración anterior del plan y se descartó al confirmar con el usuario
  que alcanzaba con lo mínimo.
- **Idempotencia del webhook (AC7) sin tabla ni constraint aparte**: `resolveByExternalSessionId`
  hace un `updateMany` condicionado a `status: fromStatus` (Prisma) — atómico a nivel DB.
  Si `count === 0` (webhook duplicado, o `session_id` desconocido/fuera de orden), no-op
  y 200 igual (Didit reintenta si no recibe 2xx).
- **Gap real encontrado y cerrado dentro de esta US**: `POST /auth/register` (MOVO-70)
  nunca consumía el `phoneVerificationToken` que emite `verify-otp` (MOVO-71) —
  `phone_verified` no se seteaba en ningún lado del código. El AC2 de MOVO-72 ("solo
  crear sesión si el teléfono está verificado") era imposible de cumplir de punta a
  punta sin esto. Confirmado con el usuario: se extendió el scope de MOVO-72 para
  wirear `register()` (`auth.schema.ts`/`auth.service.ts`/`auth.routes.ts`) — el
  `phoneVerificationToken` ahora es requerido en el body y se consume (single-use)
  antes de crear la cuenta.
- **`POST /kyc/session` y `GET /kyc/status` eran rutas públicas en la primera versión**
  (sin JWT, `userId` explícito en vez de derivarlo de un token) — en el punto del
  onboarding donde mobile las llama (justo después de `register`, antes de `login`)
  todavía no había access token. Revertido en la revisión de PR #51 (tmvergara, ver
  bullet siguiente): con `register()` emitiendo tokens, el diseño original del AC1
  ("crea una sesión [...] para el usuario autenticado") vuelve a ser posible sin el
  desvío. **MOVO-94 queda resuelto por este cambio, no solo mitigado** — no hace falta
  el ticket de seguimiento que se había abierto para la decisión anterior.
- **`register()` emite tokens de sesión, igual que `login()` (revisión de PR #51,
  tmvergara)**: `RegisterUserResult` pasa a ser el mismo shape que `LoginUserResult`
  (`accessToken`/`refreshToken`/`expiresIn`/`kycStatus`/`fullName`/`roles`) —
  `auth.service.ts#register()` firma el access token y persiste el refresh token en
  Redis (`sessionRepository.saveRefreshToken`) antes de devolver la respuesta 201.
  Motivo: el estándar de industria en onboarding con KYC (Stripe Identity, Persona, la
  mayoría de neobancos) es que el registro autentica; el AC1 original de MOVO-72 ya lo
  asumía. Como consecuencia directa, `/kyc/session` y `/kyc/status` (gateway,
  `routes-map.ts`) dejan de estar en `getPublicRoutes()` — son rutas protegidas como
  cualquier otra, sin rate limit estricto (quedan bajo el general 200/min). El `userId`
  se deriva del header `x-user-id` que el gateway inyecta tras validar el JWT (ADR-010,
  `kyc.routes.ts#requireUserIdFromHeader`), no de un parámetro del body/querystring —
  `KycSessionBody`/`KycStatusQuerystring` (`kyc.schema.ts`) se eliminaron. Un
  `x-user-id` ausente o mal formado (llamada directa al servicio sin pasar por el
  gateway) responde `401 AUTH_TOKEN_INVALID`.
  **Pendiente, fuera de este cambio**: coordinar con MOVO-73 (movo-mobile, in progress)
  — `use-registration.ts` tiene que persistir los tokens que devuelve el `register`
  nuevo antes de navegar a la pantalla de KYC, y las llamadas a `/kyc/session`/
  `/kyc/status` necesitan adjuntar `Authorization` a mano (el interceptor genérico
  sigue siendo alcance de MOVO-76, que no existe todavía). El caso borde de token
  vencido a mitad del onboarding (AC7 de MOVO-73, "flujo reanudable") queda sin
  resolver en este cambio — a decidir si es limitación aceptada o si MOVO-73 necesita
  un refresh manual mínimo.
- **Bug encontrado en la misma revisión: el `phoneVerificationToken` se perdía en un
  reintento de registro tras un conflicto de datos.** `register()` consume el token
  (single-use) *antes* de llamar a `repository.create()`; si `create()` fallaba por
  `UserConflictError` (409, típicamente un typo en el email), el token ya había quedado
  marcado como usado en Redis — el usuario tenía que rehacer todo el flujo de OTP para
  reintentar, aunque su teléfono siguiera verificado. Corregido agregando
  `releasePhoneVerificationToken(jti)` a `PhoneVerificationService`
  (`phone-verification.service.ts`) — borra la key `phone-verification-used:{jti}` de
  Redis — y llamándolo en el `catch` de `UserConflictError` dentro de
  `auth.service.ts#register()`, antes de relanzar el 409. `consumePhoneVerificationToken`
  ahora devuelve también el `jti` (antes solo `{ phone }`) para poder liberarlo.
- **Bug de rate-limit del gateway encontrado y corregido de paso**: al agregar el rate
  limit estricto de `/kyc/session` (mismo `{max:5, timeWindow:"15 minutes"}` que
  `/auth/login`), los tests mostraron que ambos limiters compartían el mismo contador en
  Redis. Causa: `@fastify/rate-limit` en modo decorator (`app.rateLimit(opts)`, la forma
  en que `gateway/src/routes/index.ts` arma el limiter general y cada uno estricto)
  siempre arma el namespace del store con `routeInfo: {}` fijo — la clave real en Redis
  terminaba siendo `fastify-rate-limit-undefinedundefined-<ip>` para **todos** los
  limiters creados así, sin importar su ruta o config (confirmado con
  `redis-cli keys`). Preexistente desde MOVO-68, agravado recién ahora al haber una
  segunda ruta con rate limit estricto. Corregido agregando un `keyGenerator` explícito
  por limiter (`` `${method} ${path}:${ip}` ``) en `routes/index.ts` — es la única forma
  de distinguirlos con esta API (`routeInfo` no es configurable desde afuera de la
  librería).
- **Raw body para verificar la firma del webhook (AC5)**: `addContentTypeParser`
  scopeado dentro de `kycRoutes` (Fastify lo encapsula por plugin, no se filtra a
  `/auth/*` ni `/users/*` — verificado con `test/kyc.raw-body-isolation.test.ts`).
  HMAC-SHA256 sobre JSON canónico (claves ordenadas recursivamente), comparación
  timing-safe, ventana anti-replay de 300s sobre `X-Timestamp`.
- **Mapeo de estados de Didit → `KycStatus`**: solo los 3 estados terminales
  (`Approved`/`Declined`/`In Review`) disparan transición; los intermedios
  (`Not Started`/`In Progress`/`Awaiting User`/`Resubmitted`) se ignoran. `Expired`/
  `Abandoned`/`Kyc Expired` quedan **sin mapear a propósito** — todavía sin confirmar
  contra el sandbox real (los otros 3 sí, ver "Validado contra el sandbox real" abajo).
- **Shape real del payload del webhook confirmado contra el sandbox** (vía "Probar
  Webhook" de la consola, los 3 escenarios terminales): `status`/`session_id`/
  `vendor_data`/`workflow_id`/`webhook_type` viven en el nivel superior — coincide con
  lo que el código esperaba. `decision` es un objeto de ~20KB con el detalle completo de
  cada feature (OCR, NFC, AML, liveness, cuestionario, IP) — trae imágenes de
  documento, domicilio, fecha de nacimiento y otros datos que AC9 prohíbe persistir;
  `buildRedactedRawDecision` nunca lo copia tal cual, confirmado con un test que verifica
  que ningún campo sensible del fixture sobrevive a la redacción.
- **El motivo de revisión manual no vive donde se había asumido originalmente**:
  `decision.reviews` queda vacío incluso en el payload real de ejemplo de `In Review`
  (se completa recién cuando un humano termina una revisión manual en el back-office de
  Didit, después de este webhook). El motivo real está disperso en
  `decision.<feature>[].warnings[]` — confirmado con el payload real de `Declined`
  (`decision.id_verifications[0].warnings[0]` trae `{feature, risk:
  "DOCUMENT_EXPIRED", short_description: "Document expired", ...}`).
  `extractDecisionWarnings()` (`kyc.service.ts`) recorre genéricamente todas las arrays
  de `decision` (no las lista a mano — Didit puede agregar features nuevas) y extrae
  solo `feature`/`risk`/`short_description` de cada `warnings[]` — nunca
  `long_description` (más texto libre, menos revisado) ni ningún otro campo del item
  que las contiene. Puede devolver `[]` legítimamente (el ejemplo real de `In Review` no
  trae ningún warning individual) — no todo caso en `manual_review` va a tener un motivo
  estructurado, y eso está bien.
- Modo `DIDIT_MODE=mock` (default, mismo criterio que `SMS_PROVIDER=console`): sesiones
  sintéticas sin red, no depende de credenciales de sandbox para levantar el servicio en
  dev/test/CI. `DIDIT_MODE=live` exige `DIDIT_API_KEY`/`DIDIT_WORKFLOW_ID_IDENTITY`/
  `DIDIT_WEBHOOK_SECRET` (`createDiditClient` falla rápido al arrancar si faltan).
- Diagramas de secuencia y de estados (Mermaid) en `docs/kyc/` — versionados junto al
  código (mismo criterio que `docs/plan-de-testing.md`) en vez de Drive, para que sirvan
  de guía de diseño y se actualicen en el mismo PR si el flujo cambia.
- Gateway (`routes-map.ts`): prefix `/kyc` nuevo; se remueve por completo el placeholder
  `/webhooks/didit` de MOVO-68 (dead code, reemplazado por `/kyc/webhook` — AC4 del
  ticket pide ese path explícitamente).

Tests: 169/169 en `svc-users` (subieron de 167 al agregar cobertura de
`extractDecisionWarnings` con el shape real), 30/30 en `gateway`. Suite completa
(`svc-users` + `gateway` + `shared`) verificada contra Postgres/Redis reales.

**Validado contra el sandbox real de Didit.me** (Paso 7 del plan, hecho en vivo con
credenciales reales del usuario — no solo con `DIDIT_MODE=mock`):
- `POST /kyc/session` real: `createSession` contra `POST /v3/session/` con
  `DIDIT_API_KEY`/`DIDIT_WORKFLOW_ID_IDENTITY` reales devolvió 201 con
  `session_id`/`session_token` reales, persistidos correctamente en `kyc_verification`.
- Túnel local: `ngrok` no estaba instalado; `npx localtunnel` funcionó para la primera
  prueba pero **el servicio gratuito `loca.lt` resultó no confiable** (el túnel murió
  solo, y una segunda instancia ni siquiera conectó — confirmado que no era problema de
  red local, `google.com` respondía normal). Se cambió a `cloudflared tunnel --url`
  (Cloudflare Quick Tunnels, `brew install cloudflared`, sin cuenta/login) — mucho más
  estable (<1s de respuesta consistente). Recomendado sobre `localtunnel` para este
  flujo de ahora en más.
- **Firma real de Didit validada end-to-end**: "Probar Webhook" de la consola (con la
  firma real que calcula Didit, no una simulada por nosotros) llegó a
  `POST /kyc/webhook` a través del túnel y `verifyDiditSignature` la aceptó — confirma
  que la canonicalización JSON (claves ordenadas recursivamente) coincide exactamente
  con la de Didit. Era el mayor riesgo técnico del ticket y ya no es una incógnita.
- El primer intento devolvió `401`/timeout porque el shape del payload y el
  `session_id` de prueba de Didit no coinciden con una sesión real nuestra — comportamiento
  esperado y correcto (AC7: sesión desconocida se ignora, responde 200 igual).
- **Ciclo completo de punta a punta con una sesión propia real** (no simulada por
  "Probar Webhook"): se creó una sesión real vía `POST /kyc/session`, se completó el
  flujo de verificación real en `https://verify.didit.me/session/<token>` (modo
  sandbox — simulado, no valida documentos de verdad) con resultado `Declined`, y
  Didit mandó el webhook real correspondiente. Resultado: `kyc_verification.status =
  rejected` con `resolvedAt` seteado, `vendor_data` coincidiendo exactamente con el
  `userId`, y `extractDecisionWarnings()` extrayendo 4 warnings reales
  (`DATA_REVIEW_MINOR_FIELD_MISMATCH`, `DATA_REVIEW_CRITICAL_FIELD_MISMATCH`,
  `DATA_REVIEW_FIELDS_EDITED_BY_USER`, `DOCUMENT_NOT_SUPPORTED_FOR_APPLICATION`) sin
  ningún dato sensible mezclado. `GET /kyc/status` reflejó `rejected` correctamente
  (`manualReviewReason: null` es el comportamiento esperado para `rejected` — ese campo
  solo se expone para `manual_review` por diseño; el detalle sigue disponible en
  `raw_decision` para debugging/futuro panel de admin). Esta es la confirmación más
  fuerte posible de que el flujo funciona real de punta a punta, no solo contra mocks.

Pendiente / fuera de alcance de MOVO-72: mapeo de `Expired`/`Abandoned`/`Kyc Expired`
(no hay forma de generar esos escenarios desde "Probar Webhook" de la consola;
requeriría dejar vencer una sesión real o abandonarla a mitad de camino). Panel de
admin para casos en `manual_review` (AC10 solo deja el dato consultable,
`findManualReviewCases()`): MOVO-32, sprint posterior. La decisión de rutas públicas
sin JWT (que tenía seguimiento en MOVO-94) quedó resuelta en la revisión de PR #51 —
ver bullets de arriba ("`register()` emite tokens de sesión").

**Cambios aplicados tras la revisión de PR #51 (tmvergara, 2026-08-06)**: además de los
tres bullets de arriba (rutas de KYC protegidas, `register()` emite tokens, fix del
`phoneVerificationToken` perdido en reintento), se actualizaron los tests existentes al
nuevo contrato: `auth.register.integration.test.ts` (shape de respuesta + caso nuevo de
liberación de token), `auth.login.integration.test.ts` (conteo de refresh tokens en
Redis, ahora +1 por cada `register()` de fixture), `kyc.session.integration.test.ts` /
`kyc.status.integration.test.ts` (header `x-user-id` en vez de body/querystring, casos
nuevos de 401 sin header / header inválido), `gateway/test/routes-prefix.test.ts`
(`/kyc/session` y `/kyc/status` exigen `Authorization: Bearer`). `docs/kyc/
sequence-diagram.md` y el `README.md` raíz (sección de rutas públicas) actualizados
para no contradecir el diseño nuevo. 173/173 tests en `svc-users` (subieron de 169),
32/32 en gateway (subieron de 30) — suite completa contra Postgres/Redis reales, más un
smoke test manual de punta a punta a través del gateway real (`register` → token →
`POST /kyc/session` con `Authorization` → `GET /kyc/status`) para confirmar la
inyección de `x-user-id`, no solo `app.inject()` sin gateway de por medio.

Sigue pendiente, sin cambios de código en esta revisión: coordinación con MOVO-73
(movo-mobile) descrita arriba, y actualizar Linear (MOVO-70 tiene un AC vigente que
dice explícitamente "sin tokens de sesión" — contradicho por este cambio; MOVO-94 pasa
a estar resuelto, no en Backlog).

