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
  párrafo de 3-5 líneas alcanza. No repitas stats de tests ni narres cada bug encontrado
  y corregido en el camino: solo el estado final y, si hay una, la razón de una decisión
  no obvia.
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
| 004 | JWT corto (60min) + refresh token opaco en Redis (7 días — TTL extendido a 90 días por ADR-013), roles como array (`AccessTokenClaims.roles: UserRole[]`) | Token robado sigue válido hasta expirar (máx 60min) |
| 005 | REST + `/api/v1/` + Socket.io para tracking; Swagger autogenerado | Over-fetching mitigado con query params de proyección |
| 006 | EC2 + Docker Compose (no K8s/PaaS/ECS); frontends Next.js en Vercel | Sin auto-scaling; sin alta disponibilidad (aceptado para el alcance del TFG) |
| 007 | AWS S3 con presigned URLs para imágenes de envíos (nunca BLOBs en Postgres ni filesystem local) | Cliente implementa flujo de 2 pasos (pedir URL, hacer PUT) |
| 008 | Google Maps Distance Matrix API para la matriz de costos del VRPTW (REEMPLAZADO por ADR-013: migración a Routes API, Compute Route Matrix) | Costo por llamada (N²) y dependencia de red en el camino crítico |
| 009 | Terraform (AWS + Cloudflare) reemplaza aprovisionamiento manual | Curva de aprendizaje de HCL/state management |
| 010 | Gateway: servicios internos confían en `x-user-*` sin revalidar (se apoya en que solo el gateway expone puerto público) | Si un atacante llega a la red interna, el modelo de confianza cae — perimetral, no zero-trust |
| 011 | Prisma como ORM estándar para todos los servicios Node de MOVO (primera implementación en `movo-svc-users`, los demás lo adoptan al tener dominio real) | Curva de aprendizaje del equipo; requiere driver adapter (`@prisma/adapter-pg`, Prisma 7) y baselinear las 2 migraciones SQL ya aplicadas como histórico |
| 012 | Twilio como proveedor de SMS para OTP (MOVO-71), detrás de una interfaz `SmsProvider`; implementación de consola es el default de dev/test/CI, Twilio real queda reservado para la demo final | Sin envío real de SMS fuera de la demo — limitación aceptada para no incurrir en costos de una API externa de pago (riesgo R10 del plan de proyecto); el adapter (riesgo R11) permite activar Twilio de verdad solo cambiando `SMS_PROVIDER` |
| 013 | Refresh token con TTL extendido de 7 a 90 días (MOVO-75), reemplazando el valor original de ADR-004 — prioridad del equipo: minimizar cuánto tienen que volver a loguearse los usuarios en una app que no maneja datos bancarios | Ventana de exposición mayor si un refresh token es robado; mitigado por la rotación de un solo uso + detección de reuso que introduce la misma US (reusar un refresh ya canjeado revoca todas las sesiones del usuario) |
| 014 | Google Maps como proveedor de geocoding para el paso de mapa del wizard de registro (MOVO-73), detrás de una interfaz `GeocodingProvider`; mock determinístico es el default de dev/test/CI, Google real vía `GEOCODING_PROVIDER=google` — primera implementación real de un servicio de Google Maps en el proyecto pese a que ADR-008/ADR-013 ya lo habían decidido para `movo-svc-pricing-logistics` (todavía un esqueleto) | Dos API keys de Google distintas a provisionar (Geocoding API server-side, restringida por IP; Maps SDK client-side del mobile, restringida por bundle id/SHA) — ninguna cargada todavía, mismo estado pendiente que las credenciales de Twilio/Didit |
| 015 | Google Routes API (método `Compute Route Matrix`, tier Basic) reemplaza Distance Matrix API (ADR-008, declarada Legacy) — consumida desde `movo-svc-pricing-logistics` con cuota diaria dura en GCP y `GOOGLE_MAPS_MAX_ELEMENTS` como salvaguarda de costos | Tier Basic ($5/1.000 elem, sin tráfico en vivo/peajes); límite de 625 elementos por request y streaming |
| 016 | Foto de perfil (MOVO-97, primera implementación real de ADR-007): bucket S3 con el prefijo `profile-photos/` de lectura pública (policy de bucket, resto privado) + key con UUID aleatorio, en vez de bucket 100% privado con presigned GET en cada lectura | `photo_url` queda como URL estable y cacheable por el cliente; a cambio, quien tenga la URL exacta ve la foto sin autenticarse — aceptado porque la foto ya es información pública por diseño (AC9 de MOVO-97, la usa la contraparte de un envío para reconocer a la persona) |

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
- Migraciones en deploy: `run-migrations.sh` (SQL a mano, `svc-payments`/`svc-admin`)
  lleva ledger propio (`public.schema_migrations`) para tolerar reruns sin repetir
  migraciones no-idempotentes. `svc-users`/`svc-shipments` (Prisma) usan
  `docker compose pull <servicio> && docker compose run --rm -T <servicio> npx prisma
  migrate deploy` — el `pull` explícito es necesario porque `run` no repullea una imagen
  ya presente localmente. `DATABASE_URL` para Prisma necesita user/password
  percent-encodeados (a diferencia de `pg`, que tolera el string crudo) — el parseo
  hace backtrack desde el último `@` para tolerar passwords que contengan `@`.
- `docker image prune -af` (sin `--volumes`) corre al final de cada deploy — el disco
  chico de la EC2 (ADR-006) se llena de imágenes `<none>` si no se limpia. Rotación de
  logs (`json-file`, `max-size: 10m` / `max-file: 3`) en todos los servicios.

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

_Sección viva — entrada corta por US/sprint (qué se hizo, en qué archivos, decisiones no
obvias, qué queda pendiente). Detalle completo (narrativa de bugs, stats de tests,
alternativas consideradas) vive en el historial de commits/PRs, no acá._

### MOVO-50 — Spike: VRPTW con Google OR-Tools

Entregables en `docs/or-tools/` (`vrptw-spike-report.md`, `vrptw_prototype.py`).
Prefiltro geométrico al segmento de ruta (descarta candidatos >15km sin llamar a
OR-Tools/Google Maps). Cache de la solución del feed (0 llamados extra al aceptar una
oferta). SLA <50ms para 20 envíos, fallback greedy determinístico <0.2ms. Motivó
ADR-013 (Routes API sobre Distance Matrix).

### MOVO-67 — `@movo/shared`

JWT (`signAccessToken`/`verifyAccessToken`, TTL 60min), refresh token opaco, contrato
`ApiError`/`ApiErrorCode` (códigos nunca se renombran, solo se agregan), tipos de
dominio (`UserRole`, `KycStatus`, `AccountStatus`). Consumido como npm workspace por
gateway y servicios Node — el mobile lo importa siempre por subpath (ver MOVO-73), el
barrel raíz arrastra `jsonwebtoken`/`node:crypto`.

### MOVO-68 — Middleware del API Gateway

Auth, autorización por rol (`app.authorize(roles)`), rate limiting con Redis, error
handler central, ruteo declarativo `/api/v1` (`config/routes-map.ts`). Rutas públicas
se declaran por método+path exacto en `getPublicRoutes()` — cualquier ruta nueva es
protegida por defecto salvo que se liste explícitamente. Rate limit general 200/min +
estricto en login (5/15min); `keyGenerator` explícito por limiter (necesario:
`@fastify/rate-limit` en modo decorator comparte namespace de Redis entre limiters sin
esto). Solo `svc-users`/`svc-shipments` conectados por ahora.

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

### MOVO-73 — Onboarding en `movo-mobile`: registro, OTP, mapa, KYC embebido, dark mode

Wizard de 7 pasos (`app/(auth)/register.tsx`): datos básicos → DNI → dirección → mapa
(geocoding) → OTP → contraseña → revisión. KYC vía SDK nativo de Didit — import
diferido con `require()` dentro del handler, nunca `import` estático (el SDK rompe
Expo Go si se evalúa al arrancar, porque expo-router evalúa todas las rutas al abrir
la app). Dark mode automático (`darkMode:"class"` en NativeWind — sigue el tema del
SO, sin toggle manual). Tabla `users.address` nueva (una por registro, lat/long vía
`GeocodingProvider` mock/google, ADR-014); endpoint público `POST /geocode` que proxea
la Geocoding API server-side. Keys de Google Maps van en `app.config.js`/EAS env vars,
nunca en `app.json`/`eas.json` (se trackean en git).

Fixes de esta misma US que dejaron el flujo realmente utilizable:
- Resume del onboarding: el redirect a `/kyc` desde `/` no se disparaba porque nadie
  consumía `hasPendingRegistration` — corregido en `app/index.tsx`.
- KYC en `pending` era un pozo sin salida: `createSession` ahora reconcilia contra
  Didit (`getSessionDecision`, pull) antes de expirar el intento previo — evita
  perder un `approved`/`rejected` real por reintentar demasiado rápido.
- `phoneVerificationToken` se libera ante cualquier falla de `create()` (nested write
  atómico de Prisma, seguro liberar siempre), no solo en conflicto de datos.
- `Expired`/`Abandoned`/`Kyc Expired` de Didit mapean a `KycStatus.EXPIRED`
  (reintentable) — sin validar contra sandbox real.

### MOVO-76 — Login, secure storage, refresh automático, guard de navegación (mobile)

`http-client.ts`: interceptor adjunta `Authorization`, refresh single-flight ante 401
(no reintenta si el 401 viene de un `Authorization` explícito del caller — evita
competir con el refresh proactivo y disparar la detección de reuso de MOVO-75).
`auth-store.ts` (Zustand + `expo-secure-store`). El guard de `(app)/_layout.tsx`
reacciona al store solo, sin `router.replace` explícito en logout. `app/index.tsx`
redirige sesión restaurada a `/home` (KYC aprobado) o `/kyc` (resto).

### MOVO-78 — Perfil propio, insignias, logout (mobile)

Tab bar de 3 pestañas. Tipos de wire contract (`PublicProfile`/`PrivateProfile`/
`ProfileBadge`) movidos a `@movo/shared`. Formateo de contadores con guard explícito
contra `null`/`NaN` (nunca `?? 0` ciego — `NaN ?? 0` sigue siendo `NaN`). Separación
pública/privada resuelta por tipos de componente (`ProfilePrivateSection` no acepta
campos de `PublicProfile`), no por flag visual sobre un componente genérico.

### MOVO-105 — Máquina de estados de envío (`svc-shipments`)

`src/domain/shipment-state-machine.ts`, dominio puro sin DB. 9 estados canónicos
(`ShipmentStatus` en `@movo/shared`, reemplaza los 5 provisorios de MOVO-67), 13
transiciones válidas según el DTE diseñado en Drive (`docs/shipments/
state-diagram.md`). Cancelación del emisor válida desde 4 estados de origen (una,
post-`assigned`, "con penalización" — penalización aún sin implementar). `disputed`
sin transición de salida modelada (resolución de admin, ticket futuro).

### MOVO-104 — Schema y migraciones de `shipments`

Primer dominio real de `svc-shipments` → adopta Prisma (ADR-011). Modelos
`Shipment`/`ShipmentEvent`/`ShipmentPhoto`. `shipment-repository.ts#updateStatus()` es
la única vía de escritura de `status` (usa `transition()` de MOVO-105 antes del
UPDATE, en la misma transacción inserta el evento). TOCTOU conocido y aceptado (sin
lock atómico entre la relectura del estado y el UPDATE) — seguimiento en MOVO-118.
Gotcha: `_prisma_migrations` vive en `public`, compartida entre todos los servicios
Prisma sobre el mismo Postgres (ADR-003) — migraciones nuevas de `svc-shipments` se
generan con `prisma migrate diff --from-empty` + `migrate deploy`, nunca
`migrate dev` contra el Postgres compartido de dev.

### MOVO-80 — Creación de envío, detalle y listado propio (`svc-shipments`)

Primer flujo de negocio real de `svc-shipments` sobre MOVO-104/105: `POST /shipments`,
`GET /shipments/:id` (403 a un tercero, nunca 404 filtrado) y `GET /shipments/mine`
(paginado, primer endpoint paginado del repo). `src/app.ts` de este servicio nunca
había terminado de cablearse (sin `@fastify/env`, sin error-handler) — se completó
como prerrequisito, portando el mismo patrón de `movo-svc-users`.

Decisiones clave:
- **Búsqueda de receptor movida a `svc-users`** (`GET /users/search?q=`, no en
  `svc-shipments` como sugería el AC literal) — es su dominio, evita una llamada
  extra entre servicios solo para buscar. Busca por nombre completo
  (`firstName`+`lastName`, substring case-insensitive) — no hay campo `username` en
  `User`, y buscar por email/teléfono se descartó a propósito (habilitaría
  enumeración de usuarios).
- **`src/adapters/users-client.ts`**: primera llamada interna servicio-a-servicio del
  repo (hasta ahora todos los adapters hablaban con APIs de terceros). `fetch` nativo
  + `AbortSignal.timeout(5000)` — sin timeout, una demora en `svc-users` cuelga el
  request de creación de envío indefinidamente. Sin modo mock (a diferencia de
  `DiditClient`/`GeocodingProvider`): los tests inyectan un `UsersClient` falso vía
  `buildApp({ usersClient })`, no hace falta un tercer modo por costo/credenciales.
  Chequea existencia y KYC de identidad aprobado del receptor en una sola llamada
  (`GET /users/:id` ya devuelve `isVerified`).
- **`suggestedPriceArs` con fórmula placeholder** (tarifa base + $/kg + $/km
  Haversine) en `shipments.service.ts` — `svc-pricing-logistics` (motor real, EP-05)
  todavía es solo un esqueleto. Documentado explícitamente como temporal, sin nueva
  migración ni adapter de pricing.
- **Bug de timezone encontrado corriendo el servicio real (no por los tests
  `app.inject`)**: `pickupDate`/`pickupTimeWindowStart`/`pickupTimeWindowEnd` se
  guardan como `Date` ancladas a UTC (valores de calendario/reloj de pared, no
  instantes), pero los serializadores `asDate`/`asTime` de fast-json-stringify
  (detrás de `format: "date"`/`"time"` en el schema de respuesta) le restan el
  `getTimezoneOffset()` del proceso antes de recortar el ISO string — pensado para
  mostrar un instante real en hora local, corre el valor si el proceso no corre en
  UTC (confirmado en local, Córdoba UTC-3: "09:00" salía "06:00"). Corregido
  convirtiendo esos tres campos a string ya formateado (`toShipmentDto` en
  `shipments.routes.ts`) antes de que lleguen al serializador — `asDate`/`asTime`
  dejan pasar un string tal cual, sin ajuste. Sin este fix, cualquier deploy con
  `TZ` distinto de UTC habría corrompido esos tres campos en toda respuesta.

Pendiente / fuera de alcance de MOVO-80: penalización de cancelación post-`assigned`
y transición de salida de `disputed` (MOVO-105, sin ticket todavía); el `carrierId`
no participa en `GET /shipments/mine` (no hay asignación automática este sprint).

### MOVO-15 — Verificación de licencia de conducir

Reutiliza el mecanismo de KYC de MOVO-72 con `verification_type:"license"` (mismo
pipeline, `workflow_id` distinto por tipo en Didit). Tabla nueva
`users.drivers_license` (registro del carnet, ciclo de vida propio — distinto del log
de intentos en `kyc_verification`). Insignia `license_verified` cableada. Pantalla
`license-kyc.tsx` en mobile, desacoplada del wizard de registro (usuario ya logueado,
usa la sesión real vía el interceptor de MOVO-76).

### MOVO-97 — Foto de perfil: S3 + presigned URLs (ADR-007, ADR-016)

`StorageProvider` (interfaz + `S3StorageProvider`/`MockStorageProvider`). La
presigned URL firma también `content-type`/`content-length` (el cliente tiene que
mandar esos headers exactos o S3 rechaza la firma). La key del objeto se deriva
parseando `photo_url` ya guardado — no hay columna nueva. Credenciales AWS vía IAM
role de la EC2. Bucket real (`movo-shipment-media-dev`) configurado con CORS + policy
de lectura pública acotada a `profile-photos/*` (sin `ListBucket` público) — portado a
Terraform (`movo-infra`), aplicado en dev; prod tiene el código listo pero sin
`terraform apply` corrido todavía.

### MOVO-107 — Push notifications: permisos y registro de token (mobile)

Implementado contra el contrato de MOVO-106 (backend, todavía sin implementar).
`device-id.ts` (UUID persistido en secure-store, sobrevive a logout — identifica el
dispositivo, no la sesión). `expo-crypto` en vez del paquete `uuid` (evita el
polyfill de `crypto.getRandomValues` en Hermes). Des-registro en logout, tolera
fallos sin bloquear el logout. `eas.projectId` repuesto en `app.config.js` (se había
perdido al migrar de `app.json` en MOVO-73).

### Pendientes transversales

- **Credenciales reales sin cargar** en AWS Secrets Manager (dev y prod) — el código
  ya está listo para tomarlas apenas se configuren: Twilio (4 vars, ADR-012), Didit
  (`DIDIT_MODE=live` + 5 vars, incluye `DIDIT_WORKFLOW_ID_LICENSE` de MOVO-15), Google
  Maps (server-side `GOOGLE_MAPS_API_KEY` compartida entre `svc-users`/futuros
  consumidores + `GOOGLE_MAPS_IOS/ANDROID_API_KEY` del mobile), Telegram bot
  (`SMS_PROVIDER=telegram`, solo dev), `STORAGE_PROVIDER=s3` + bucket/region de MOVO-97.
- **Terraform de `movo-infra`**: bucket de fotos de perfil (MOVO-97/ADR-016) aplicado
  en dev, `terraform apply` de prod pendiente.
- **MOVO-118**: arreglar el TOCTOU de `shipment-repository.ts#updateStatus()`
  (MOVO-104) con `SELECT ... FOR UPDATE` cuando haya asignación automática o
  concurrencia real.
- **ADRs con desarrollo completo pendiente de pegar en Drive** (solo tienen el resumen
  de una línea en la tabla de arriba): 012, 013, 014, 015, 016.
- **`eas init`/development build real en dispositivo**: pendiente para probar de
  punta a punta el SDK de Didit (KYC) y push notifications (MOVO-107) fuera de Expo Go.
- Backend de **MOVO-106** (registro de push token del lado servidor) no existe
  todavía — MOVO-107 (mobile) está implementado contra su contrato propuesto.
- **AC5 (aviso en foreground) sin componente nuevo**: se configura
  `Notifications.setNotificationHandler({ shouldShowAlert: true, ... })` a nivel de
  módulo — usa el banner nativo del SO incluso con la app abierta. No hay ningún
  banner auto-dismiss reusable en el repo (`ErrorBanner` es persistente a propósito),
  así que construir uno hubiera sido alcance extra no pedido por el AC.
- **AC6 (navegar al detalle de un envío) queda parcialmente resuelto a propósito**: el
  listener (`addNotificationResponseReceivedListener`) parsea `data.type === 'shipment'`
  y deja el punto de extensión documentado en el propio código, pero no navega a
  ningún lado real — no existe ninguna pantalla de envíos todavía (MOVO-83+, sin
  arrancar). Decisión tomada con el usuario: mejor dejar el parseo listo y sin acción
  que inventar un destino (`/home`) que no es el real.
- **`httpClient` no exponía `delete`** (`HttpMethod` ya incluía `"DELETE"` pero el
  objeto exportado no lo usaba) — se agregó `httpClient.delete<T>(path, body, headers)`,
  mismo shape que `post`/`patch`, porque el contrato de MOVO-106 manda `{ deviceId }`
  en el body del `DELETE`.
- **`expo-crypto` en vez del paquete `uuid`** para generar el `deviceId`: evita el
  polyfill de `crypto.getRandomValues` que `uuid` necesita en RN/Hermes — decisión
  tomada con el usuario junto con las dos anteriores.
- **AC4 (des-registro en logout)**: `auth-store.ts#logout()` llama a
  `unregisterCurrentDevice()` **antes** de `clearSession()` (necesita el accessToken
  todavía en memoria para el header `Authorization`), envuelto en `try/catch` propio
  además del que ya trae la función internamente — mismo criterio de "un paso
  secundario nunca bloquea salir de la cuenta" que ya usa esa función con
  `authClient.logout`.
- **`eas init` ya se había corrido** (proyecto "movo-mobile", org "movosend"), pero el
  `projectId` nunca quedó commiteado — vivía en un `app.json` local de una rama
  anterior, reemplazado por `app.config.js` en MOVO-73 sin portar el valor, y se perdió
  al cambiar de rama. Repuesto acá: `owner: "movosend"` +
  `extra.eas.projectId: "077f9c8d-cb66-4772-a76c-34e4548290e7"` en `app.config.js`
  (verificado con `npx expo config --type public`, que ahora sí resuelve ambos).
- **AC7 (Expo Go, aun con `projectId` configurado)**: `Notifications.
  getExpoPushTokenAsync({ projectId })` sigue tirando en Expo Go (no soporta push
  remoto, independientemente del `projectId`) — se atrapa en `push-registration.ts`,
  se loguea y no rompe nada más.
- `app.config.js`: se agregó `"expo-notifications"` al array `plugins` (sin esto
  Android no genera el ícono/sonido de notificación en el build nativo). Sin cambios
  en `.env.example` — el push token de Expo no requiere ningún secret del lado
  cliente, a diferencia de las keys de Google Maps.

Tests nuevos: `test/device-id.test.ts`, `test/notifications-client.test.ts`,
`test/push-registration.test.ts` (permiso denegado no registra — AC1; permiso
concedido registra — AC2/AC3; `getExpoPushTokenAsync` fallando no rompe — AC7;
de-registro tolera fallos), `test/use-push-notifications.test.tsx` (registro único por
transición a autenticado, re-registro tras logout/login en el mismo dispositivo, tap
de notificación de envío no crashea, cleanup del listener al desmontar), más dos casos
agregados a `test/auth-store.test.tsx` (logout des-registra el dispositivo, y tolera
que falle). 111/111 en `movo-mobile` (subieron de 93). `tsc --noEmit` sin errores. No
hay `eslint.config.js` en `movo-mobile` todavía (paquete sin lint configurado, a
diferencia del resto del monorepo) — no es parte de esta US.

Pendiente / fuera de alcance de MOVO-107: backend real de MOVO-106 (código escrito
contra su contrato, sin poder integrar hasta que exista — con `projectId` ya
configurado, este es ahora el único bloqueo real para probar push de punta a punta),
pantalla de destino real para AC6 (depende de MOVO-83+), y el DoD manual del ticket
(development build en dispositivo físico, casos de prueba con push real) — no
verificable en este entorno.

### MOVO-98 — Paso de foto de perfil al cerrar el onboarding y edición desde el perfil (`movo-mobile`)

Implementado el último paso del onboarding para cargar la foto de perfil (cámara o galería) con recorte 1:1, compresión en cliente y subida directa a S3 vía presigned URL (ADR-007, MOVO-97), reutilizado también desde la pantalla de perfil propio (`app/(app)/(tabs)/profile.tsx`) para cambiar o eliminar la foto.

Archivos nuevos:
- `app/(auth)/profile-photo.tsx`: pantalla de cierre de onboarding con copy explicativo sobre confianza y handshake en Movo (AC2), botón "Continuar", "Más tarde" (AC8) y activación de sesión persistida (AC9).
- `components/profile/photo-picker.tsx`: componente autónomo y reutilizable de selección, vista previa, subida directa, edición y borrado de foto (AC10).
- `src/lib/photo-utils.ts`: utilidades para conversión de URIs locales a `Blob` (`uriToBlob` vía `XMLHttpRequest`), compresión y redimensión en cliente (`prepareProfilePhoto` a máx 1024px, JPEG 0.8 con `expo-image-manipulator` — AC5), y pickers nativos con `expo-image-picker` (`allowsEditing: true`, `aspect: [1, 1]` — AC4).
- `src/api/users-client.ts`: cliente para `getPhotoUploadUrl` (`POST /users/me/photo/upload-url`), `confirmPhoto` (`PUT /users/me/photo`), `deletePhoto` (`DELETE /users/me/photo`) y `uploadPhotoToS3` (PUT directo a S3 sin header Authorization).

Decisiones clave:
- **Subida binaria a S3 en React Native**: `fetch(file://)` en iOS/Hermes falla con URLs locales o multipart. Se implementó `uriToBlob` con `XMLHttpRequest` (`responseType = 'blob'`) y upload directo a S3 con `XMLHttpRequest` PUT pasando el `Blob` y el `Content-Type` exacto de la presigned URL (ADR-007 / AC6).
- **`httpClient` seguro para requests sin body**: se corrigió `doFetch` para que solo adjunte `Content-Type: application/json` si `body !== undefined`. Esto previene el error `400 FST_ERR_CTP_EMPTY_JSON_BODY` de Fastify en peticiones `DELETE` o `GET` con 0 bytes de cuerpo.
- **Transición de KYC y sincronización de estado**: `kyc.tsx` navega a `/profile-photo` únicamente con KYC `approved`; en `manual_review` u otros estados el botón "Ir al inicio" ejecuta `goHome()`. Al montar `profile-photo.tsx`, se activa la sesión persistida en `useAuthStore` para que las peticiones de `PhotoPicker` viajen con el Bearer token válido.
- **Sincronización de KYC aprobado al reabrir la app**: `auth-store.ts` expone `updateKycStatus`, `home.tsx` y `useRegistration` consumen `useMyProfile` para reflejar el estado fresco del backend, y `app/index.tsx` revalida contra `getMyProfile()` antes de mandar a `/kyc` para evitar bucles cuando un usuario es aprobado mientras la app está cerrada.
- `app.config.js`: agregados `NSPhotoLibraryUsageDescription` y `NSCameraUsageDescription` en `infoPlist`, más el plugin `expo-image-picker`.

Tests nuevos y actualizados: `test/photo-utils.test.ts`, `test/users-client.test.ts`, `test/photo-picker.test.tsx`, `test/profile-photo-screen.test.tsx`, `test/kyc.test.tsx`, `test/profile.test.tsx`, `test/http-client.test.tsx`. Total de 19 suites pasadas / 137 tests exitosos en `movo-mobile`. `tsc --noEmit` sin errores.
