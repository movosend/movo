# CLAUDE.md — Contexto del proyecto MOVO

## Qué es este archivo

Contexto común del equipo para trabajar con Claude (o cualquier asistente de IA) en este
repositorio. Se carga automáticamente al abrir Claude Code acá. El objetivo es que
cualquier integrante, en cualquier sesión, tenga de entrada el mismo entendimiento del
proyecto sin tener que re-explicarlo cada vez.

Antes de dar por cerrada una US, usar la skill `.claude/skills/cerrar-us/` — decile a
Claude algo como "cerremos esta US" o "revisá si cumplimos todo del ticket" y la
dispara. Compara la implementación contra el ticket de Linear ítem por ítem, corre
tests, chequea si falta un ADR, y actualiza el historial del paquete que tocaste.

**Es un documento vivo.** Reglas de mantenimiento:

- Al terminar una US/PR que agregue una decisión de diseño, un servicio nuevo, o cambie
  una convención: sumá una entrada al historial del paquete/servicio que tocaste —
  `HISTORIAL.md` en `movo-mobile` y en `services/movo-svc-{users,shipments,payments}`
  (no se cargan solos, el `CLAUDE.md` de cada uno apunta ahí), y la sección **"Estado
  actual de la implementación"** del `CLAUDE.md` en el resto (`gateway`,
  `shared/movo-shared`, `services/movo-svc-{pricing-logistics,admin}`) — con una entrada corta (qué se hizo, en qué archivos,
  qué queda pendiente/fuera de alcance). Si la US es transversal a varios servicios o es
  una decisión de infraestructura/proceso, va en la sección homónima de este archivo
  raíz en su lugar. No dupliques el detalle que ya está en el commit o en la descripción
  del PR — un párrafo de 3-5 líneas alcanza. No repitas stats de tests ni narres cada
  bug encontrado y corregido en el camino: solo el estado final y, si hay una, la razón
  de una decisión no obvia.
- Si una convención de código/proceso cambia (nuevo ADR, nueva regla de linting, etc.),
  actualizá la sección correspondiente acá, no solo en el documento de Drive.
- Si agregás un ADR nuevo en el entregable de Sprint 0 (Drive), sumá su fila a la tabla
  de `docs/adr/README.md` y su número + título corto al índice de ADRs de este archivo.
- Si un `CLAUDE.md` crece por encima de ~40k caracteres, Claude Code avisa y cada sesión
  que lo carga paga ese contexto: mové el historial a un `HISTORIAL.md` al lado, como en
  los paquetes de arriba.
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
nuevo que referencia y deprecate al anterior.

Detalle de cada uno (decisión + trade-off aceptado) en **`docs/adr/README.md`**:
antes de tocar un área regida por un ADR (o de proponer algo que pueda contradecir uno),
leé su fila ahí. Índice de los vigentes:

001 Microservicios · 002 Node+Fastify para I/O, Python+FastAPI solo en pricing ·
003 Postgres único (esquema por servicio) + Redis · 004 JWT 60 min + refresh opaco en
Redis, roles como array · 005 REST `/api/v1` + Swagger autogenerado (su Socket.io lo
reemplaza 022) · 006 EC2 + Docker Compose, Next en Vercel · 007 S3 con presigned URLs ·
008 Distance Matrix (reemplazado) · 009 Terraform · 010 servicios confían en `x-user-*`
del gateway · 011 Prisma como ORM · 012 Twilio detrás de `SmsProvider` · 013 refresh de
90 días con rotación y detección de reuso · 014 geocoding de Google detrás de
`GeocodingProvider` · 015 Google Routes API (Compute Route Matrix) · 016 fotos de
perfil en prefijo S3 público · 017 Resend detrás de `EmailProvider` · 018 `POST /quote`
provisorio versionado · 019 pricing stateless, `Offer` en shipments · 020 handshake
ECDSA P-256 / P1363 · 021 `ShipmentStatus` de 11 estados · 022 WebSocket nativo ·
023 retención de traza GPS 30 días · 024 tracking: ingesta HTTP, difusión WS ·
025 pricing `demand_fuel_routes_v1` · 026 bloqueo de usuarios simétrico ·
027 `rejected_by_receiver` no terminal · 028 precio comprometido (`quoteId`) ·
029 `TripStatus.EXPIRED` vs `CANCELLED` · 030 juegos: `/demo` con API key ·
031 juego del optimizador · 032 expiración y cierre automático · 033 navegación por
deep-link · 034 inicio de viaje · 035 arquitectura de cobro (MP) · 036 requisitos
habilitantes del transportista · 037 saga de asignación · 038 transferencia de receptor ·
039 (propuesto) tarjetas guardadas con CVV · 040 chat propio · 041 pricing
`package_tapered_v2` · 042 viajes recurrentes · 043 (propuesto) refresh idempotente del
panel · 044 cuenta corriente del usuario · 045 salida de `in_transit` demorado ·
046 push de chat · 047 (propuesto) penalidad de cancelación ·
048 cuenta cobradora de Movo por credenciales · 049 sanciones de cuenta: suspensión,
inhabilitación y marca en Redis ·
050 plazo del hold de MP (5 días) y N=3 · 051 soporte al usuario sobre el chat existente ·
052 atribución del no-retiro por GPS · 053 oferta del recargo por demanda: solo `declared`

## Convenciones de código

- TypeScript estricto (`strict: true`) en todo Node/Next.js/Expo. `any` prohibido sin
  comentario justificándolo — usar `unknown` + type guards.
- Tipos compartidos entre servicios Node van en `shared/movo-shared`, nunca duplicados.
- Naming: `camelCase` (variables/funciones), `PascalCase` (clases/interfaces),
  `UPPER_SNAKE_CASE` (constantes/env vars), `kebab-case` (archivos TS, endpoints REST),
  `snake_case` (archivos Python, tablas/columnas de DB).
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
- Un endpoint nuevo que inicie un compromiso nuevo (crear, ofertar, aceptar, declarar un viaje) se suma a
  `SUSPENDED_BLOCKED_ROUTES` (`gateway/src/config/routes-map.ts`, MOVO-298), o una cuenta suspendida lo usa sin que
  falle ningún test. Revisarlo en el PR.
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
- Migraciones en deploy: todos los servicios Node (Prisma, `svc-admin` desde MOVO-288,
  que dejó sin uso y borró `run-migrations.sh`) usan
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
US **por servicio/paquete** vive en el historial de ese directorio, no acá — esta
sección solo lista lo transversal (credenciales, decisiones cross-servicio). Lo que es de
un área concreta va en el `CLAUDE.md` de esa carpeta (`infra/` para nginx y WebSocket,
`.github/` para CI/CD mobile, `docs/legal/` para TyC/Privacidad y su sync):_

- `gateway/CLAUDE.md`
- `services/movo-svc-users/HISTORIAL.md`
- `services/movo-svc-shipments/HISTORIAL.md`
- `services/movo-svc-pricing-logistics/CLAUDE.md`
- `services/movo-svc-payments/HISTORIAL.md`
- `services/movo-svc-admin/CLAUDE.md`
- `shared/movo-shared/CLAUDE.md`
- `movo-mobile/HISTORIAL.md`

### Pendientes transversales

- **Credenciales reales sin cargar** en AWS Secrets Manager (dev y prod) — el código
  ya está listo para tomarlas apenas se configuren: Twilio (4 vars, ADR-012), Didit
  (`DIDIT_MODE=live` + 5 vars, incluye `DIDIT_WORKFLOW_ID_LICENSE` de MOVO-15), Google
  Maps (server-side `GOOGLE_MAPS_API_KEY` compartida entre `svc-users`/futuros
  consumidores + `GOOGLE_MAPS_IOS/ANDROID_API_KEY` del mobile), Telegram bot
  (`SMS_PROVIDER=telegram`, solo dev), `STORAGE_PROVIDER=s3` + bucket/region de MOVO-97,
  Resend (`EMAIL_PROVIDER=resend` + `RESEND_API_KEY`/`EMAIL_FROM`, ADR-017), precio de
  combustible (`FUEL_PRICE_PROVIDER=energia` en `movo-svc-pricing-logistics`, MOVO-138/ADR-025;
  no es una credencial, la API es pública, pero sin esa var dev cotiza con el precio fijo de
  config).
- **Terraform de `movo-infra`**: bucket de fotos de perfil (MOVO-97/ADR-016) aplicado
  en dev, `terraform apply` de prod pendiente. El dominio de envío de mails
  (MOVO-139/ADR-017) ya está verificado en Resend con DKIM/SPF/MX de bounces **y
  DMARC** (`_dmarc.movosend.app`, `p=none`) resueltos — verificado con `dig`, ver
  `services/movo-svc-users/HISTORIAL.md` (MOVO-139). Sigue llegando a spam en Outlook
  igual: con la autenticación completa y alineada, eso ya es reputación de dominio
  nuevo sin historial de envíos, no un gap de DNS — mejora con volumen/tiempo, no con
  otro registro. Falta portar a Terraform los registros que se cargaron a mano en
  Cloudflare (incluido el DMARC), y (opcional) un prefijo `brand/*` público en el
  bucket de dev si se quiere usar el PNG del logo en los mails.
- **ADRs con desarrollo completo pendiente de pegar en Drive** (solo tienen el resumen
  de una línea en la tabla de arriba): 019, 020, 021, 022, 026, 028, 029, 032, 035, 037, 038, 040, 041, 042, 046, 049, 050, 051, 052, 053 (012-018 ya están pegados en
  el doc de Sprint 0, confirmado al buscar dónde iba ADR-022 — la lista anterior acá
  estaba desactualizada). **ADR-022 tiene su contenido completo ya redactado**, en un
  doc aparte (`ADR-022 - Canal de tiempo real (WebSocket nativo) - pegar en Sprint 0`,
  misma carpeta de Drive que el Sprint 0) porque esta sesión no tuvo forma de editar el
  contenido del doc de Sprint 0 directamente — falta que alguien lo pegue en la sección
  de ADRs y borre el doc aparte. **ADR-026 (MOVO-175) tiene su contenido completo ya redactado** en un doc aparte
  (`ADR-026 - Bloqueo de usuarios - pegar en Sprint 0`, misma carpeta de Drive), mismo
  procedimiento que ADR-022. Ojo con la numeración: ADR-025 es el pricing dinámico
  (MOVO-216), por eso este es 026.
- **Nginx con soporte de upgrade WebSocket y heartbeat aplicados, sin probar contra un
  deploy real en EC2** (MOVO-200/ADR-022 AC3 + MOVO-201) — ver la entrada de MOVO-201
  arriba: el heartbeat ping/pong ya está implementado y `proxy_read_timeout` bajó de
  3600s a 90s. Falta la prueba contra dev/prod real (AC6 de MOVO-201), sin acceso a esa
  infra desde ninguna de las dos sesiones todavía.
- **WS del panel de soporte (MOVO-323 → MOVO-322)**: el cliente (`movo-admin`) ya abre el WebSocket con un ticket de un
  solo uso en el subprotocolo `movo-support.v1`, y cae a polling si falla. Falta del lado servidor: `POST
  /admin/support/realtime-ticket`, el upgrade en `svc-admin` (vía gateway `/api/v1/admin/support/ws` y `infra/nginx`) y
  `GET /admin/support/events`. Contrato en `docs/support/README.md`. Esto resuelve el diseño de la entrada siguiente para el panel.
- **Auth por header custom (`Authorization: Bearer`) no sirve para un cliente de
  navegador estándar** (`window.WebSocket` no permite headers custom, a diferencia del
  `WebSocket` de React Native) — MOVO-201 dejó el mecanismo DISEÑADO (subprotocolo
  `Sec-WebSocket-Protocol`, no query param) pero sin implementar, porque `movo-admin`/
  MOVO-33 (el único consumidor que lo necesitaría) no está bloqueado por MOVO-201 y
  todavía no lo pide. Implementar cuando ese ticket lo necesite, no antes.
- **Cuenta cobradora del saldo (ADR-048)**: en dev ya están `MP_COLLECTOR_*` (token `TEST-` de Movo S.A., vence ~15/04/2027,
  se renueva con `services/movo-svc-payments/scripts/collector-oauth.mjs`), `MP_WEBHOOK_SECRET` (webhook registrado en el
  panel de `movosend`) y `ALERT_*` (Telegram, grupo "Movo Team"). En prod falta cargar las credenciales productivas del panel
  de la cuenta real de Movo S.A. y borrar el legado `MERCADOPAGO_ACCESS_TOKEN`.
- **Adjuntos de soporte en `movo-infra` (MOVO-321)**: falta en el bucket de `svc-shipments` el prefijo privado `support/*` (sin lectura
  pública) con `s3:PutObject`/`GetObject`/`DeleteObject` para el rol de la EC2, CORS con `PUT` para `admin.movosend.app` y los previews de
  Vercel (el panel sube desde el navegador), y una regla de lifecycle de respaldo para `support/pending/*` (el sweep de huérfanos ya borra
  los nunca usados; la regla cubre los que fallen al borrarse). Sin `DeleteObject`, el sweep loguea y deja el objeto.
- **`s3:DeleteObject` sobre `shipments/*` sin confirmar en `movo-infra`** (MOVO-124/MOVO-230): lo necesitan el sweep de
  fotos huérfanas y la purga de historial vencido de `svc-shipments`. Sin el permiso, los dos fallan, loguean y
  reintentan en cada corrida sin borrar nada.
- **Credenciales de Mercado Pago de prod sin cargar** (MOVO-267): dev ya tiene todas (app
  sandbox `movosend`); en prod faltan `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_REDIRECT_URI`,
  `MP_WEBHOOK_SECRET` y `MP_TOKEN_ENCRYPTION_KEY` (app de la cuenta real de Movo).
- **Config de comisiones compartida vía `@movo/shared`** (MOVO-143,
  `shared/movo-shared/src/config/commission.ts`): candidato a ADR corto (primera config
  de negocio en el barrel en vez de en el `envSchema` de un servicio), todavía no
  escrito. `MOVO_COMMISSION_RATE` (15%) está confirmado; `MP_TRANSACTION_FEE_RATE` es un
  estimado a propósito, ver la entrada de MOVO-225 más abajo.

### MOVO-215 — Plazo del hold de MP y N de la saga (spike cerrado)

El sandbox de MP no vence holds: dos holds siguieron `authorized` ~188 h (13/10 al 21/10),
más que los 5 y 7 días documentados. Se queda el mínimo documentado: `MP_HOLD_VALIDITY_DAYS=5`
(`svc-payments`) y `FUNDING_NEAR_PICKUP_DAYS=3` (`svc-shipments`), sin cambio de defaults
(ADR-050, `docs/payments/adr-050-plazo-del-hold.md`; medición en
`docs/payments/mercadopago-spike/HOLD-EXPIRY-MEASUREMENT.md`). Sin confirmar: el
`status_detail` de un hold vencido que asume el webhook de MOVO-268 (`cancelled`+`expired`).

### MOVO-225 — Comisión de Mercado Pago: estimado, no valor contractual

No hay un porcentaje de MP que confirmar: MP descuenta su comisión de la cuenta de cada
transportista (según sus tarifas, el plazo de liberación y el medio de pago del emisor).
Los TyC (secciones 3, 5.1 y 7, v0.2) lo dicen así y corrigen la comisión de Movo (15%
sobre el neto, no sobre el precio). Todo monto que la app le muestra al transportista
como cobro es "Recibís aprox." = neto menos el estimado de MP (sobre el bruto, a validar
con pagos reales; `estimateReceivedArs` de `@movo/shared`, tasa de
`EXPO_PUBLIC_MP_TRANSACTION_FEE_RATE`). Pendiente:
persistir el `mercadopago_fee` real del hold/captura para mostrar el monto exacto.
- **Webhook de MP y alertas en prod** (MOVO-268): en dev ya están registrados (17/10). En prod
  falta cargar `https://api.movosend.app/api/v1/payments/webhooks/mercadopago` (tópico
  `payment`) en el panel de la app real con su clave como `MP_WEBHOOK_SECRET`, y las `ALERT_*`
  (sin ellas las alertas solo quedan en el log).
- **`MP_TRANSACTION_FEE_RATE` sin confirmar** (MOVO-143,
  `shared/movo-shared/src/config/commission.ts`): placeholder (0.0499) hasta tener el
  valor real del contrato/homologación con MercadoPago. `MOVO_COMMISSION_RATE` (15%,
  comisión de Movo) sí está confirmado. Candidato a ADR corto (primera config de
  negocio compartida vía `@movo/shared` en vez de por `envSchema` de un servicio) —
  todavía no escrito, ver `services/movo-svc-shipments/HISTORIAL.md` (MOVO-143) y
  `shared/movo-shared/CLAUDE.md` para el detalle de la decisión.
