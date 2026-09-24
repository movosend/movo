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

Comunicación entre servicios: REST síncrono sobre HTTP, sin message broker. WebSocket
nativo (`@fastify/websocket`, ADR-022 — reemplaza la mención a Socket.io de ADR-005)
para el canal de tracking en tiempo real, gateway y `movo-svc-shipments`. Solo el
gateway expone puerto público (443); todo lo demás vive en la red Docker interna.

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
| 005 | REST + `/api/v1/` + Socket.io para tracking (mención de Socket.io REEMPLAZADA por ADR-022: WebSocket nativo); Swagger autogenerado | Over-fetching mitigado con query params de proyección |
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
| 020 | Handshake de custodia (MOVO-158) firma con ECDSA P-256/SHA-256 vía WebCrypto, formato de firma IEEE P1363 (raw r‖s, no DER) — la clave privada nunca sale del dispositivo (MOVO-157/158/159/195); lado mobile (MOVO-195) implementado con `@noble/curves` (JS puro, sin módulo nativo) en vez de un polyfill de WebCrypto o clave no-exportable en Keychain/Keystore nativo | Primera criptografía asimétrica del repo, sin precedente propio a reusar; firma en formato no-DER es una convención propia del proyecto (mobile tiene que hablar el mismo formato, no un estándar externo verificable por terceros); la privada pasa por JS del lado mobile en vez de quedar aislada 100% en hardware, aceptado por simplicidad/alcance del TFG (sin dev client/rebuild nativo) |
| 021 | Extensión del set canónico de `ShipmentStatus` de 9 a 11 estados (MOVO-208): `assigned_unfunded` (transportista asignado, hold de fondos todavía sin crear — consecuencia de la decisión de hold de MOVO-12 "opción B", anclado cerca del retiro en vez de en la aceptación de la oferta) y `completed` (entregado Y pago liberado, MOVO-212 — distingue "entregado" de "entregado y cobrado"). `delivery_failed` evaluado y descartado explícitamente (5 preguntas de negocio sin responder, ver `docs/shipments/state-diagram.md`) | Ninguna de las dos transiciones nuevas se dispara todavía (bloqueadas por Mercado Pago, MOVO-210/212) — el riesgo aceptado es que la máquina de estados ya permite un camino que ningún endpoint HTTP dispara hoy, documentado explícitamente como "disponible y probado, no disparado" en vez de dejarlo implícito |
| 022 | Canal de tiempo real (MOVO-200, spike): WebSocket nativo vía `@fastify/websocket` sobre el gateway y `movo-svc-shipments` (REEMPLAZA la mención a Socket.io de ADR-005) — cubre tracking (MOVO-11), chat (MOVO-26, cuyo AC ya pedía WebSockets explícito) y el panel de admin (MOVO-33) con un solo protocolo, en vez de Socket.io o Server-Sent Events | Sin reconexión automática ni salas/ack de fábrica (Socket.io los da, pero ningún caso de uso comprometido hoy los necesita — se construyen a mano si hace falta); nginx necesita headers Upgrade/Connection + subir `proxy_read_timeout` antes de que el canal funcione en producción (pendiente, ver "Pendientes transversales") |
| 023 | Retención de la traza GPS del transportista (MOVO-202): 30 días desde que el envío cierra (`assigned_unfunded`/`assigned`/etc. no cuentan, solo `delivered`/`completed`/`cancelled`/`rejected_by_receiver`), purgada por job periódico; un envío `disputed` nunca es candidato mientras siga en ese estado — el plazo recién arranca a contar desde que se resuelve (hoy sin transición de salida modelada, así que en la práctica no vence). Evidencia para disputas (MOVO-30), explícitamente no analítica ni perfilado | Ventana de 30 días es una decisión de equipo, no un requisito legal derivado — documentada como tal para la defensa; la supresión de cuenta (MOVO-39) borra la traza del usuario de inmediato como transportista, sin esperar ese plazo, pero ese borrado cross-servicio es best-effort (si `movo-svc-shipments` no responde, la baja de cuenta igual se completa y el barrido periódico la alcanza más tarde) |
| 024 | Tracking en tiempo real: ingesta por HTTP, difusión por WebSocket (MOVO-250, complementa ADR-022 sin modificarlo): el transportista reporta su posición con `POST /shipments/:id/positions` (o el lote `POST /shipments/positions`, hasta 100 ítems, un resultado por ítem) y el server la difunde por el WebSocket de ADR-022, que queda como canal de RECEPCIÓN (posiciones y `{type:"status"}` de cada transición). Ordena y agrupa por `capturedAt` (hora del dispositivo), no por hora de llegada: la última posición conocida solo avanza si `capturedAt` es más reciente (script Lua atómico en Redis) y la traza persiste una posición por tramo de 45s de `capturedAt` (`SET NX` por tramo) | Un WebSocket bidireccional habría dejado la emisión atada a un socket que el SO mata en segundo plano mucho antes que una tarea de red puntual; a cambio, la emisión no tiene ack en tiempo real (el resultado por ítem del lote lo reemplaza) y la cola offline del mobile depende de que el backend sea idempotente ante reenvíos (lo es: un tramo ya persistido no se duplica y el marcador nunca retrocede). Los claims de tramo viven 7 días en Redis, así que una cola vaciada después de ese plazo podría duplicar un tramo (aceptado: coincide con el TTL de la última posición) |

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

### Legal y compliance: Términos y Condiciones, Política de Privacidad (MOVO-224)

Primeros borradores de `docs/legal/terminos-y-condiciones.md` y
`docs/legal/politica-privacidad.md` (base legal argentina: Ley 25.326, CCyCN
contrato de transporte de cosas, Ley 24.240), con aviso académico explícito y
`[A COMPLETAR]` donde falta un dato real (fee de MP, mecánica de penalidad).
Documentos nuevos también subidos a Drive (`[Movo] NNN - Términos y
Condiciones`/`Política de Privacidad`) por el equipo. Decisiones no obvias:

- **Postura de responsabilidad deliberadamente agresiva** (TyC sección 13):
  MOVO se deslinda de pérdida/daño/robo del paquete en tránsito, atribuyendo
  esa responsabilidad exclusivamente al Transportista vía el contrato de
  transporte de cosas (CCyCN Arts. 1280-1318), en vez de fijar un tope
  monetario atado al valor declarado del envío. Es la postura que menos
  expone a MOVO en el texto, pero la que un tribunal tiene más margen para
  considerar abusiva frente a un Emisor-consumidor (Ley 24.240), dado que
  MOVO sí interviene en cobro, precio y disputas — riesgo documentado
  explícitamente en el propio documento, pendiente de validación por un
  abogado matriculado antes de cualquier lanzamiento real.
- **No inscripción ante el Registro Nacional de Bases de Datos (AAIP, Art. 21
  Ley 25.326)** mientras MOVO opere solo como proyecto académico sin
  producción real — riesgo regulatorio aceptado explícitamente, a revertir si
  MOVO pasa a operar con usuarios reales.
- **Derecho de arrepentimiento (Ley 24.240) declarado no aplicable** una vez
  aceptada una oferta, por encuadrar en la excepción del Art. 34 (servicio ya
  en ejecución con consentimiento expreso) — la protección equivalente es la
  cancelación sin cargo antes de aceptar una oferta (sección 10 del TyC).
- **Consentimiento diferenciado de KYC (dato biométrico/sensible) todavía no
  implementado como paso propio**: hoy queda cubierto por el checkbox general
  de Términos+Privacidad del registro (`movo-mobile`), no por un consentimiento
  puntual antes de iniciar el flujo de KYC — brecha documentada como pendiente
  en la propia Política de Privacidad (sección 3) en vez de quedar implícita.
  Mismo criterio aplicado a Google Analytics/Microsoft Clarity en la sección
  de cookies: listados como candidatas, no como herramientas ya integradas,
  porque no se verificó su integración real en `movo-admin` (institucional es
  repo separado).
- Registro/checkbox de aceptación, versionado (`LEGAL_DOCUMENT_VERSIONS`),
  persistencia de aceptación en `svc-users` y gate de re-aceptación: ver
  entradas de MOVO-224 en `shared/movo-shared/CLAUDE.md`,
  `services/movo-svc-users/CLAUDE.md` y `movo-mobile/CLAUDE.md`.
- Pendiente fuera de esta issue: footer con links legales en `movo-admin`
  (no existe todavía), purga automática de registros incompletos/KYC vencido
  (MOVO-230), y moderación de calificaciones (TyC sección 12) sin UI de
  reporte/edición todavía.

### MOVO-200 — Spike: canal de tiempo real (ADR-022)

Cierra la incertidumbre sobre el canal de tiempo real (ver "Pendientes transversales"
histórico — no había ninguna línea de WebSocket/Socket.io/SSE en el repo antes de este
spike). Decisión: **WebSocket nativo vía `@fastify/websocket`** (ADR-022), no
Socket.io ni SSE — reemplaza la mención a Socket.io que traía ADR-005. Documento de
conclusiones completo linkeado al issue en Linear (relevamiento, comparación de las 3
tecnologías, impacto en infra, esbozo de auth/autorización).

- **PoC mínima (AC5) en esta misma rama**: `services/movo-svc-shipments/src/plugins/
  websocket.ts` + `src/modules/tracking/tracking-poc.routes.ts` —
  `GET /shipments/:id/track` (WS) valida el JWT en el handshake
  (`verifyAccessToken`, mismo mecanismo que el gateway), autoriza por pertenencia al
  envío (`assertShipmentAccess` + `carrierId`) y empuja una posición de muestra.
  **No era la implementación final** — MOVO-201 (ticket hermano bloqueado por este
  spike, ver su entrada más abajo) la reemplazó por completo: conectaba directo a
  `svc-shipments` sin pasar por el gateway, sin salas ni difusión a múltiples
  suscriptores, sin ingesta real de GPS. La doc de uso vive ahora en
  `docs/tracking/README.md` (`docs/tracking-poc/` ya no existe).
- **MOVO-159 AC4 resuelto**: el condicional "polling o suscripción si hay Socket.io"
  pasa a "suscripción por WebSocket, cuando MOVO-201 esté disponible" — ese reemplazo
  de polling se hace en los tickets de implementación de MOVO-159/MOVO-199, no en este
  spike.
- **AC3 (infra) aplicado y validado localmente**: `infra/nginx/templates/
  default.conf.template` suma un `map $http_upgrade $connection_upgrade` (patrón
  estándar de nginx para servir HTTP y WS desde el mismo `location`, sin forzar
  `Connection: upgrade` en requests normales) + `proxy_set_header Upgrade/Connection` +
  `proxy_read_timeout` de 30s a 3600s. Validado con el stack local real
  (`infra/docker-compose.local.yml`, nginx real con cert self-signed, no mockeado):
  arranca sin errores con el template nuevo (equivalente a `nginx -t`, que este entorno
  no tenía disponible antes), el tráfico normal sigue funcionando
  (`curl https://localhost:8443/health` → 200), y un WebSocket real de punta a punta
  (TLS en nginx → upgrade reenviado → JWT validado → mensaje recibido) funciona
  apuntando nginx directo a `svc-shipments` (prueba temporal, revertida — el gateway
  real hoy responde 404 a ese path porque `@fastify/http-proxy` no reenvía upgrades de
  protocolo, confirmando que el hueco es MOVO-201, no nginx). El timeout subido aplica
  a TODO el `location /` (no solo a rutas WS, que todavía no existen como tales del
  lado del gateway) — trade-off documentado inline en el archivo. Sin probar contra un
  deploy real en dev/prod (EC2) todavía.
- **Pendiente de este ticket**: estimación informada de los tickets de implementación
  de MOVO-11/MOVO-201 (identificados, sin horas concretas todavía).

### MOVO-201 — Canal de tiempo real: implementación real (gateway + `svc-shipments`)

Reemplaza la PoC de MOVO-200 sobre la tecnología que fijó ADR-022. Detalle completo en
`gateway/CLAUDE.md` y `services/movo-svc-shipments/CLAUDE.md` (ambos con entrada propia
de MOVO-201) — acá solo lo transversal.

- **El gateway ahora sí proxea el upgrade WS** (`config/routes-map.ts#ServiceRoute.
  websocket`, solo en `/shipments`): `@fastify/http-proxy` lo maneja internamente sin
  necesitar `@fastify/websocket` ahí, pero no reenvía `x-user-*` al upstream por default
  en una conexión WS (solo `cookie`) — hubo que agregar un `wsClientOptions.
  rewriteRequestHeaders` propio. Cierra el hueco que el spike de MOVO-200 había
  confirmado (`@fastify/http-proxy` no reenviaba upgrades de protocolo en absoluto).
- **Heartbeat ping/pong implementado** (cada 30s, `movo-svc-shipments`) — cierra el
  pendiente transversal que había dejado MOVO-200 (ver abajo, la entrada vieja quedó
  resuelta) y permitió bajar `proxy_read_timeout` de nginx de 3600s a 90s.
- **Auth de browser (`movo-admin`/MOVO-33) queda diseñada, no implementada**: mecanismo
  elegido, subprotocolo `Sec-WebSocket-Protocol` (no query param, por el riesgo de
  logueo del JWT en nginx/Cloudflare) — sin consumidor real todavía (MOVO-33 no está
  bloqueado por MOVO-201), así que no se implementó código sin usar.
- **Sin verificar contra un deploy real en dev/prod (EC2)** — AC6 del ticket, mismo
  pendiente que ya traía MOVO-200 para nginx; esta sesión no tuvo acceso a esa infra.

### Automatización de sync de documentos legales (`scripts/sync-legal-docs.ts`)

Cierra el pendiente de sync manual que MOVO-224/228 (`movo-mobile`) habían dejado
documentado: `docs/legal/*.md` (fuente redactada, pensada para lectura en Drive/
GitHub) se copiaba a mano a `movo-mobile/src/content/legal/*.ts` (empaquetado como
`string` — Metro no soporta importar `.md` sin transformer custom) y la fecha de
`LEGAL_DOCUMENT_VERSIONS` (`shared/movo-shared/src/config/legal.ts`, ADR implícito
de MOVO-228) se bumpeaba también a mano en sincronía con el `.md`. Tres lugares a
mantener alineados sin ningún mecanismo que lo forzara — mismo tipo de gap que ya
costó dos veces con env vars olvidadas (ver "Git, commits y PRs" más arriba).

- **`npm run sync:legal`** (raíz del repo, `tsx scripts/sync-legal-docs.ts`)
  regenera los 3 archivos a partir de `docs/legal/*.md`: las dos copias `.ts` de
  `movo-mobile` (contenido completo, escapado para template literal) y
  `LEGAL_DOCUMENT_VERSIONS` en `@movo/shared`, tomando la fecha de la línea
  **"Última actualización"** del propio `.md`. **`npm run sync:legal:check`**
  (mismo script con `--check`) no escribe nada, solo falla si algo quedó
  desincronizado — pensado para correr en CI o antes de un commit.
- **Decisión de diseño clave: la fecha de versión NUNCA se deriva de un hash/diff
  del contenido, se respeta la que el equipo escribió a mano en "Última
  actualización"** — un typo o una corrección de redacción menor en el `.md` no
  debería forzar re-aceptación a toda la base de usuarios (MOVO-229 dispara el
  gate de re-aceptación apenas la versión persistida de una cuenta quede vieja).
  El flujo real para publicar un cambio legal: editar el `.md`, bumpear a mano su
  línea de "Última actualización", correr `npm run sync:legal`, commitear los 3
  archivos regenerados juntos.
- Sin hook de pre-commit todavía (el repo no tiene Husky configurado pese a que
  la sección de convenciones de código lo menciona — gap preexistente, no
  introducido acá) — la propagación depende hoy de correr el script a mano o de
  agregarlo como paso de CI, todavía no hecho.

### CI/CD mobile: build en EAS al crear un tag (`.github/workflows/mobile-eas.yml`)

Primer workflow de build/submit de `movo-mobile` — hasta acá el CI/CD solo cubría
backend (`ci-dev.yml`/`ci-prod.yml`). Un tag de git dispara el build en EAS Cloud:

- **`dev-*`** (ej. `dev-2026-09-21`) → development build, profile `development`, iOS +
  Android.
- **`v*`** (ej. `v1.0.0`) → profile `staging` solo iOS con `--auto-submit` a
  TestFlight. Un guard previo falla el job si el commit taggeado no es ancestro de
  `origin/develop` ni de `origin/main` — no se publica a TestFlight un build de una
  rama feature sin mergear.

**TestFlight apunta a dev, no a prod**: la EC2 de producción está apagada por costos, así
que el profile `staging` de `eas.json` (`distribution: store`, `EXPO_PUBLIC_API_URL=
https://api-dev.movosend.app`, push activado) reemplaza al `production` para este flujo.
`staging` declara `environment: "production"` a propósito: las variables de EAS
(`GOOGLE_MAPS_IOS_API_KEY`) están cargadas en el ambiente `production`, y sin esa línea
el build no las tomaría. El profile `production` sigue intacto y sin ningún workflow que
lo use — cuando se prenda la EC2 de prod, sumar un tag propio (ej. `prod-*`) con un
guard contra `main`.

Decisiones no obvias: cada job **espera** a que EAS termine el build (sin `--no-wait`), así
el check de GitHub refleja el resultado real. Cuesta ~15-25 min de runner por build más la
cola de EAS, pero el repo es público (minutos gratis) — si pasara a privado, revisar esto.
El development build corre en una matriz `ios`/`android` (dos jobs en paralelo,
`fail-fast: false`). Workflow en Node 22, no 20 como el resto: `eas-cli` latest depende de
paquetes que exigen Node >= 22. El workflow que corre es el del
commit taggeado, así que tiene que estar mergeado antes de taggear. La versión de
marketing (`version` de `app.config.js`) NO se deriva del tag — el número de build lo
incrementa EAS (`autoIncrement`). El hook `eas-build-post-install` de `movo-mobile`
buildea `@movo/shared` en el servidor de EAS (ver `movo-mobile/CLAUDE.md`).

**Aviso en Telegram** (`.github/scripts/notify-eas-build.sh`, secrets
`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` a nivel de repo, no de environment): al terminar
cada job avisa al chat del equipo si el build quedó listo o falló, con la plataforma
(iOS/Android) y el link a la página del build. Se hace desde el workflow y no con un
webhook de EAS porque Telegram no entiende el payload del webhook: haría falta una
función intermedia desplegada aparte. `if: always()` para avisar también los fallos;
`continue-on-error` y se omite sin secrets, así que un aviso que falla nunca cambia el
resultado del build. El link se saca del log de `eas build` con `grep` (no con `--json`,
para no depender de su formato). El script acepta `DRY_RUN=1` para probar el mensaje sin
enviarlo.

**Dispositivos iOS del development build**: el perfil ad hoc lleva la lista de UDIDs
adentro. Sumar un iPhone exige `eas device:create` y volver a correr a mano
`eas build -p ios --profile development` (login de Apple del titular, la cuenta es
Individual) para regenerar el perfil; recién el siguiente tag `dev-*` lo incluye. El CI,
al ser `--non-interactive`, no puede regenerarlo.

Estado: el build de `staging` y su submit a TestFlight se probaron a mano (la App Store
Connect API Key quedó guardada en EAS para el submit del CI; `ascAppId` fijo en
`eas.json#submit.staging.ios`); `expo-dev-client` se agregó a `movo-mobile` porque el
profile `development` lo necesita. El primer development build de Android se corrió a mano
(EAS no genera el keystore en modo `--non-interactive`). Un tag `dev-*` sobre la rama
encoló los builds y el aviso de Telegram llegó. Pendiente de verificar: la versión que
espera al build (matriz por plataforma), y un tag `v*` sobre `develop` (guard + TestFlight).

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
  de una línea en la tabla de arriba): 019, 020, 021, 022 (012-018 ya están pegados en
  el doc de Sprint 0, confirmado al buscar dónde iba ADR-022 — la lista anterior acá
  estaba desactualizada). **ADR-022 tiene su contenido completo ya redactado**, en un
  doc aparte (`ADR-022 - Canal de tiempo real (WebSocket nativo) - pegar en Sprint 0`,
  misma carpeta de Drive que el Sprint 0) porque esta sesión no tuvo forma de editar el
  contenido del doc de Sprint 0 directamente — falta que alguien lo pegue en la sección
  de ADRs y borre el doc aparte.
- **Nginx con soporte de upgrade WebSocket y heartbeat aplicados, sin probar contra un
  deploy real en EC2** (MOVO-200/ADR-022 AC3 + MOVO-201) — ver la entrada de MOVO-201
  arriba: el heartbeat ping/pong ya está implementado y `proxy_read_timeout` bajó de
  3600s a 90s. Falta la prueba contra dev/prod real (AC6 de MOVO-201), sin acceso a esa
  infra desde ninguna de las dos sesiones todavía.
- **Auth por header custom (`Authorization: Bearer`) no sirve para un cliente de
  navegador estándar** (`window.WebSocket` no permite headers custom, a diferencia del
  `WebSocket` de React Native) — MOVO-201 dejó el mecanismo DISEÑADO (subprotocolo
  `Sec-WebSocket-Protocol`, no query param) pero sin implementar, porque `movo-admin`/
  MOVO-33 (el único consumidor que lo necesitaría) no está bloqueado por MOVO-201 y
  todavía no lo pide. Implementar cuando ese ticket lo necesite, no antes.
- **`MP_TRANSACTION_FEE_RATE` sin confirmar** (MOVO-143,
  `shared/movo-shared/src/config/commission.ts`): placeholder (0.0499) hasta tener el
  valor real del contrato/homologación con MercadoPago. `MOVO_COMMISSION_RATE` (15%,
  comisión de Movo) sí está confirmado. Candidato a ADR corto (primera config de
  negocio compartida vía `@movo/shared` en vez de por `envSchema` de un servicio) —
  todavía no escrito, ver `services/movo-svc-shipments/CLAUDE.md` (MOVO-143) y
  `shared/movo-shared/CLAUDE.md` para el detalle de la decisión.
