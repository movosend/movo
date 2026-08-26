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
  una convención: actualizá la sección **"Estado actual de la implementación"** del
  `CLAUDE.md` del paquete/servicio que tocaste (`gateway/CLAUDE.md`,
  `services/<servicio>/CLAUDE.md`, `movo-mobile/CLAUDE.md`,
  `shared/movo-shared/CLAUDE.md`) con una entrada corta (qué se hizo, en qué archivos,
  qué queda pendiente/fuera de alcance). Si la US es transversal a varios servicios o es
  una decisión de infraestructura/proceso, va en la sección homónima de este archivo
  raíz en su lugar. No dupliques el detalle que ya está en el commit o en la descripción
  del PR — un párrafo de 3-5 líneas alcanza. No repitas stats de tests ni narres cada
  bug encontrado y corregido en el camino: solo el estado final y, si hay una, la razón
  de una decisión no obvia.
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
| 017 | Resend como proveedor de email (MOVO-139), detrás de una interfaz `EmailProvider` con el molde de ADR-012: implementación de consola como default de dev/test/CI, Resend real vía `EMAIL_PROVIDER=resend`. Elegido sobre AWS SES porque salir del sandbox de SES exige aprobación manual de AWS con tiempos impredecibles, y el free tier de Resend (3k mails/mes) cubre de sobra el TFG | Un proveedor externo más del que depender; el dominio de envío necesita SPF/DKIM propios (un `terraform apply` en `movo-infra`, el DNS ya se maneja por Cloudflare) y la cuenta queda sin verificar hasta la demo, igual que Twilio/Didit |
| 018 | Precio sugerido de un envío (MOVO-82): contrato `POST /quote` en `movo-svc-pricing-logistics` con una implementación provisoria versionada explícitamente (`calculationMethod: euclidean_linear_v1` — distancia euclidiana + peso + factor de tipo de paquete, coeficientes en config), en vez de bloquear la creación de envíos hasta tener el motor real (demanda + combustible + Google Routes API) | Precio inexacto hasta que el motor real reemplace `euclidean_linear_v1`; el contrato ya queda versionado para ese reemplazo sin migrar a los consumidores (`movo-svc-shipments`, futuro wizard mobile de MOVO-83) |
| 019 | `movo-svc-pricing-logistics` stateless (sin base de datos propia ni esquema en Postgres); la entidad `Offer` vive en el esquema `shipments` | Acoplamiento de `shipments` con la lógica de ofertas a cambio de atomicidad transaccional (evita 2PC/Sagas distribuidas entre servicios) |

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
- **Una env var nueva se toca en tres lugares, siempre en el mismo PR**: (1)
  `.env.example` del servicio, (2) el `envSchema` de `src/config/env.ts`, y (3) el bloque
  `environment:` del servicio en `infra/docker-compose.yml`. Olvidarse del (3) ya nos
  pasó dos veces (`PLACES_PROVIDER`, y `EMAIL_PROVIDER`/`RESEND_API_KEY`/`EMAIL_FROM` de
  MOVO-139) y falla de la forma más cara de diagnosticar: el deploy sale verde y el
  servicio arranca sano, pero silenciosamente con el default del schema (el provider
  mock/console), porque Compose solo inyecta al contenedor lo que está listado en
  `environment:` — cargarla en Secrets Manager no alcanza, el `.env` que genera
  `ci-dev.yml` vuelca el secret entero pero ahí solo sirve para interpolación. Si la var
  elige implementación (`*_PROVIDER`, `DIDIT_MODE`), va con `:-<default>` y no `-<default>`:
  una var presente pero vacía no matchea el enum de AJV y tira el servicio abajo al boot.

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
alternativas consideradas) vive en el historial de commits/PRs, no acá. El historial de
US **por servicio/paquete** vive en el `CLAUDE.md` de ese directorio, no acá — esta
sección solo lista lo transversal (infra, credenciales, decisiones cross-servicio):_

- `gateway/CLAUDE.md`
- `services/movo-svc-users/CLAUDE.md`
- `services/movo-svc-shipments/CLAUDE.md`
- `services/movo-svc-pricing-logistics/CLAUDE.md`
- `shared/movo-shared/CLAUDE.md`
- `movo-mobile/CLAUDE.md`

### Pendientes transversales

- **Credenciales reales sin cargar** en AWS Secrets Manager (dev y prod) — el código
  ya está listo para tomarlas apenas se configuren: Twilio (4 vars, ADR-012), Didit
  (`DIDIT_MODE=live` + 5 vars, incluye `DIDIT_WORKFLOW_ID_LICENSE` de MOVO-15), Google
  Maps (server-side `GOOGLE_MAPS_API_KEY` compartida entre `svc-users`/futuros
  consumidores + `GOOGLE_MAPS_IOS/ANDROID_API_KEY` del mobile), Telegram bot
  (`SMS_PROVIDER=telegram`, solo dev), `STORAGE_PROVIDER=s3` + bucket/region de MOVO-97,
  Resend (`EMAIL_PROVIDER=resend` + `RESEND_API_KEY`/`EMAIL_FROM`, ADR-017).
- **Terraform de `movo-infra`**: bucket de fotos de perfil (MOVO-97/ADR-016) aplicado
  en dev, `terraform apply` de prod pendiente. El dominio de envío de mails
  (MOVO-139/ADR-017) ya está verificado en Resend con DKIM/SPF/MX de bounces **y
  DMARC** (`_dmarc.movosend.app`, `p=none`) resueltos — verificado con `dig`, ver
  `services/movo-svc-users/CLAUDE.md` (MOVO-139). Sigue llegando a spam en Outlook
  igual: con la autenticación completa y alineada, eso ya es reputación de dominio
  nuevo sin historial de envíos, no un gap de DNS — mejora con volumen/tiempo, no con
  otro registro. Falta portar a Terraform los registros que se cargaron a mano en
  Cloudflare (incluido el DMARC), y (opcional) un prefijo `brand/*` público en el
  bucket de dev si se quiere usar el PNG del logo en los mails.
- **ADRs con desarrollo completo pendiente de pegar en Drive** (solo tienen el resumen
  de una línea en la tabla de arriba): 012, 013, 014, 015, 016, 017, 018, 019.
