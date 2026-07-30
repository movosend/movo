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

### MOVO-84 — Schema y migraciones de PostgreSQL (`services/movo-svc-users`)

Implementado: schema `users` en PostgreSQL, tablas `users.users` y `users.user_roles`, tipos enum `kyc_status_enum` y `user_role_enum`, índices únicos (`LOWER(email)` y `phone`) y trigger `update_users_updated_at` para actualización automática de `updated_at`. Incluye script de rollback (`down.sql`) y runner `scripts/run-migrations.sh` mejorado para omitir archivos `.down.sql` y soportar ejecuciones vía contenedor Docker.

### MOVO-86 — Plugin de conexión Redis (`services/movo-svc-users`)

Implementado: plugin de Fastify `src/plugins/redis.ts` que valida configuración requerida vía `@fastify/env` (*fail-fast*), expone cliente `ioredis` con reconexión de backoff exponencial (`fastify.redis`), método `fastify.checkRedisHealth()` con resguardo de timeout (2000ms), y cierre seguro (*graceful shutdown*) con límite de 1000ms en el hook `onClose` evitando bloqueos de procesos en deploy/SIGTERM.

### MOVO-88 — Session Repository para Refresh Tokens en Redis (`services/movo-svc-users`)

Implementado: repositorio de sesiones `src/repositories/session-repository.ts` conforme a ADR-004. Formato de claves `refresh:{userId}:{tokenId}` con TTL por defecto de 7 días (`604800s`). Expone `saveRefreshToken`, `findRefreshToken`, `revokeRefreshToken` y `revokeAllForUser` (con borrado asíncrono no bloqueante vía `SCAN` y `unlink`, escapando metacaracteres `\` `*` `?` `[` `]` para prevenir inyección glob y validando la ausencia de dos puntos en los IDs).

