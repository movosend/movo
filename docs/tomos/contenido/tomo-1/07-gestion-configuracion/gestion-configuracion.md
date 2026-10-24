# Repositorios

## Estructura del monorepo principal

Todo el código de Movo vive en un único repositorio bajo la organización de GitHub `movosend`. La documentación no-código (diseños, actas, entregables académicos) vive en Google Drive, en la carpeta compartida del equipo; desde la entrega final, además, las fuentes de estos tomos viven en `docs/tomos/` del propio repositorio. La convención de nombre de documentos en Drive es `[Movo] NNN-Nombre del documento`.

```
movo/
├── movo-mobile/                    # React Native + Expo (iOS y Android)
├── movo-admin/                     # Panel de administración (Next.js)
├── gateway/                        # API Gateway: routing, autenticación y rate limiting
├── services/
│   ├── movo-svc-users/             # Node.js: identidad, auth, KYC, perfiles, reputación
│   ├── movo-svc-shipments/         # Node.js: envíos, viajes, ofertas, handshake, tracking, chat
│   ├── movo-svc-payments/          # Node.js: integración con Mercado Pago
│   ├── movo-svc-pricing-logistics/ # Python + FastAPI: motor de precios y optimización de rutas
│   └── movo-svc-admin/             # Node.js: reportes, soporte y operación del panel
├── shared/movo-shared/             # Librería interna: tipos de dominio, JWT, contrato ApiError
├── infra/                          # docker-compose, nginx, variables de ambiente
├── docs/                           # ADRs, diagramas, plan de testing, fuentes de los tomos
├── scripts/                        # utilidades del monorepo
├── .github/workflows/              # pr-checks, ci-dev, ci-prod, mobile-eas, sync-main-to-develop
└── CLAUDE.md                       # contexto del proyecto para asistentes de IA (documento vivo)
```

Cada servicio mantiene además su propio `CLAUDE.md` con el estado de su implementación, la historia de decisiones y los pendientes. La infraestructura como código (Terraform para AWS y Cloudflare) vive en un repositorio separado, `movo-infra`.

FastAPI (Python) se utiliza para el servicio con lógica computacional intensiva (OR-Tools); Node.js se utiliza en el resto por la madurez de su ecosistema para WebSockets y para el SDK de Mercado Pago.

## Repositorio institucional

El código de la página institucional (*landing*) de Movo vive en un repositorio separado, ya que se considera una unidad aislada del producto: no guarda relación funcional ni dependencias significativas y su ciclo de desarrollo y despliegue es completamente independiente.

## Convención de nombres

| Contexto | Convención | Ejemplo |
|---|---|---|
| Archivos Python | `snake_case` | `auth_service.py` |
| Archivos TypeScript/JS | `kebab-case` | `payment-service.ts` |
| Componentes React / React Native | `PascalCase` | `ShipmentCard.tsx` |
| Variables de entorno | `UPPER_SNAKE_CASE` | `MP_TRANSACTION_FEE_RATE` |
| Documentos en Drive | `[Movo] NNN-Nombre` | `[Movo] 004 - Sprint 0` |
| Tablas y columnas de base de datos | `snake_case` | `pickup_evidence` |
| Endpoints REST | `kebab-case` | `/shipments/:id/receiver-transfers` |

: Convenciones de nombres por contexto.

# Ciclo de Vida de los Artefactos

Todo artefacto del proyecto tiene un responsable claro y un momento definido para su creación y actualización. La regla general: **el desarrollador asignado al issue es el propietario del artefacto hasta que el issue se cierra**. Cualquier modificación posterior requiere un nuevo issue en Linear.

## Artefactos en GitHub

Estos artefactos están versionados con Git, tienen historial de cambios auditado y todo cambio pasa por una rama y un Pull Request.

### Código fuente

| Momento | Acción | Responsable |
|---|---|---|
| Inicio del issue | Crear la rama desde `develop` actualizado | Desarrollador asignado |
| Durante el desarrollo | Commits atómicos con `Refs: MOVO-xxx` | Desarrollador asignado |
| Al terminar | Abrir el PR con el checklist completo | Desarrollador asignado |
| Durante la revisión | Responder comentarios y ajustar | Desarrollador asignado |
| Aprobación | Squash merge a `develop` | Reviewer (último en aprobar) |

: Ciclo de vida del código fuente.

### Contratos de API (OpenAPI/Swagger)

Los archivos OpenAPI los generan automáticamente Fastify y FastAPI al ejecutar cada servicio; no se escriben ni se editan a mano. Son un artefacto derivado del código: si el código es correcto y el Swagger está desactualizado, el código manda. Un PR que modifica un endpoint sin verificar el Swagger generado no puede ser aprobado.

| Momento | Acción | Responsable |
|---|---|---|
| Al introducir o modificar un endpoint | Verificar que la especificación generada refleja el cambio | Desarrollador asignado |
| En el checklist del PR | Confirmar que el Swagger está actualizado antes de aprobar | Reviewer |

: Ciclo de vida de los contratos de API.

### Configuración e infraestructura

Incluye `docker-compose.yml`, los pipelines de `.github/workflows/`, el `Dockerfile` de cada servicio y el `.env.example` de cada servicio. Siguen el mismo ciclo de vida que el código fuente. Regla específica: **una variable de entorno nueva se actualiza en tres lugares dentro del mismo PR** (el `.env.example` del servicio, el esquema de validación de `src/config/env.ts` y el bloque `environment:` del servicio en `infra/docker-compose.yml`). Un PR que agrega una variable sin documentarla no puede ser aprobado.

### Esquemas de base de datos

Los archivos de migración son el historial auditado de cómo evolucionó el modelo de datos y siguen el mismo ciclo que el código fuente. La herramienta de migraciones es **Prisma** (ADR-011), con una carpeta `prisma/migrations/` por servicio.

| Momento | Acción | Responsable |
|---|---|---|
| Al modificar el modelo de datos | Crear el archivo de migración en el mismo PR que el cambio | Desarrollador asignado |
| Nunca | Editar una migración ya mergeada a `develop` | – |

: Ciclo de vida de las migraciones.

### Tipos compartidos

| Momento | Acción | Responsable |
|---|---|---|
| Al definir un nuevo contrato entre servicios | Agregar los tipos en `shared/` en el mismo PR que los consume | Desarrollador asignado |
| Al modificar un contrato existente | PR con análisis de impacto en todos los servicios que lo usan | Desarrollador asignado |

: Ciclo de vida de los tipos compartidos.

## Artefactos en Google Drive

Estos artefactos se editan de forma colaborativa y son los que la cátedra revisa para la evaluación.

- **Documentos de Sprint 0:** Working Agreement, Plan de Proyecto, Estudio Inicial, User Story Mapping, backlog inicial y ADRs. Se crean durante el Sprint 0 y se actualizan únicamente al incorporar feedback docente.
- **Architecture Decision Records (ADRs):** una vez aceptado, un ADR no se modifica; si una decisión cambia, se crea un ADR nuevo que referencia al anterior y lo marca como *deprecated*. Los estados son `proposed` (en discusión), `accepted` (vigente) y `deprecated` (reemplazado).
- **Informes de Sprint:** un informe por sprint, redactado por el Scrum Master del sprint en curso. No se modifica una vez cerrado el sprint; las correcciones van en el informe siguiente.
- **Diagramas:** la fuente de los diagramas de estos tomos (PlantUML) vive en GitHub y el PDF exportado es la copia presentable. Cualquier actualización se hace sobre la fuente y se vuelve a exportar.
- **Registro de riesgos:** se actualiza sprint a sprint; el Scrum Master del sprint lo revisa al inicio y lo actualiza al cierre.
- **Actas de reunión:** las crea quien modera la reunión y no se modifican una vez cerradas.

## Resumen de responsabilidades

| Artefacto | Vive en | Dueño | Se actualiza cuando |
|---|---|---|---|
| Código fuente | GitHub (monorepo) | Desarrollador del issue | PR mergeado a `develop` |
| Swagger / OpenAPI | Generado automáticamente | Desarrollador del issue | Mismo PR que el endpoint |
| Docker Compose y CI | `infra/` y `.github/` | Quien agrega el servicio | PR mergeado a `develop` |
| `.env.example` | Raíz de cada servicio | Desarrollador del issue | Mismo PR que la variable |
| Migraciones de base de datos | GitHub (por servicio) | Desarrollador del issue | Mismo PR que el cambio de modelo |
| Tipos compartidos | `shared/` | Desarrollador del issue | Mismo PR que el contrato |
| ADRs | Google Drive y `docs/` | Designado en el planning | Al aceptar o deprecar una decisión |
| Informes de sprint | Google Drive | Scrum Master del sprint | Al cierre del sprint |
| Diagramas | GitHub (fuente) y PDF | Responsable del issue | Al cambiar una decisión de diseño |
| Registro de riesgos | Google Drive | Scrum Master del sprint | Inicio y cierre de cada sprint |
| Actas de reunión | Google Drive | Moderador | No se modifican |

: Resumen de responsabilidades por artefacto.

# Herramientas de Gestión

| Categoría | Herramienta | Propósito |
|---|---|---|
| Repositorio de código | GitHub | Alojamiento del monorepo; plataforma base para ramas y Pull Requests. |
| Documentación | Google Drive | Documentos no-código: diseños, recursos gráficos, actas y entregables. |
| Gestión del backlog | Linear | Seguimiento de issues, tareas, ciclos (sprints) y vinculación con el historial de Git. |
| CI/CD | GitHub Actions | Pipelines de integración, testing y despliegue a los ambientes de desarrollo y producción. |
| Registro de imágenes | GitHub Container Registry | Imágenes Docker de cada servicio, publicadas por el pipeline. |
| Infraestructura | Terraform (repositorio `movo-infra`) | Aprovisionamiento de AWS y Cloudflare como código (ADR-009). |
| Comunicación | Discord y WhatsApp | Comunicación síncrona y asíncrona; videollamadas. |

: Herramientas de gestión del proyecto.

## Pipelines de integración y despliegue

| Workflow | Disparador | Qué hace |
|---|---|---|
| `pr-checks.yml` | Pull Request hacia `develop` o `main` | Detecta qué paquetes cambiaron y corre lint, type-check y tests con Postgres y Redis reales; el check `tests-summary` bloquea el merge. |
| `ci-dev.yml` | Push a `develop` | Lint, type-check, tests, build y publicación de imágenes; despliegue automático al ambiente de desarrollo. |
| `ci-prod.yml` | Push a `main` | Igual que el anterior, con imágenes `prod` y despliegue al ambiente de producción. |
| `mobile-eas.yml` | Tag de git (`dev-*` o `v*`) | Compila `movo-mobile` en Expo Application Services: `dev-*` genera *development builds* de iOS y Android; `v*` publica en TestFlight (iOS) apuntando al ambiente de desarrollo. |
| `sync-main-to-develop.yml` | Push a `main` | Mantiene `develop` alineada con `main`. |
| `auto-assign-reviewers.yml` | Pull Request abierto o reabierto | Asigna automáticamente a los revisores del equipo. |

: Workflows de GitHub Actions del repositorio.

# Modelo de Ramas

Se utiliza *GitHub Flow* con una capa `develop`. Hay dos ramas permanentes (`main` y `develop`); el resto son ramas de trabajo efímeras.

| Rama | Ambiente | Regla |
|---|---|---|
| `main` | Producción | Solo recibe merges desde `develop` vía Pull Request. Nunca push directo. Cada merge dispara el despliegue a producción. |
| `develop` | Desarrollo (staging) | Integración continua. Todo el trabajo terminado llega acá. Cada push corre el pipeline completo. |
| `feature/*` | Local | Una rama por funcionalidad. Se crea desde `develop` y vuelve a `develop` vía PR. Se elimina tras el merge. |
| `fix/*` | Local | Igual que `feature`, para corrección de bugs. Se crea desde `develop`. |
| `hotfix/*` | Local | Corrección urgente en producción. Se crea desde `main` y se mergea a `main` y a `develop`. |

: Ramas del repositorio.

## Nomenclatura de ramas

La estructura del nombre tiene tres partes: tipo, identificador de Linear y descripción corta, con el formato `<tipo>/MOVO-<id>-<descripcion-corta>`. Por ejemplo: `feature/MOVO-142-kyc-biometric-flow`, `fix/MOVO-203-geofencing-urban-radius`, `hotfix/MOVO-211-mp-api-timeout`.

::: nota
Linear genera el nombre de la rama automáticamente: desde cualquier issue, el botón *Copy git branch name* evita errores de tipeo y garantiza el formato.
:::

| Hacer | No hacer |
|---|---|
| Crear la rama desde `develop` siempre actualizado | Trabajar directamente en `develop` o `main` |
| Usar el ID de Linear en el nombre (`MOVO-xxx`) | Nombres genéricos sin ID: `fix-bug`, `mi-feature` |
| Eliminar la rama luego del merge | Acumular semanas de trabajo en una rama |
| Una rama por issue o tarea | Una rama para múltiples issues no relacionados |
| Crear la rama desde Linear directamente | Force push a ramas compartidas |

: Buenas prácticas para ramas.

# Conventional Commits

Todos los commits siguen el estándar *Conventional Commits*, lo que permite que los pipelines lean el tipo de cambio y actúen en consecuencia. El formato es:

```
<tipo>(<scope>): <descripción corta en minúsculas>

[body opcional: qué y por qué, no cómo]

Refs: MOVO-142
```

| Tipo | Cuándo usarlo | Ejemplo |
|---|---|---|
| `feat` | Nueva funcionalidad para el usuario | `feat(payments): agregar flujo auth & capture` |
| `fix` | Corrección de un bug | `fix(geofencing): radio mínimo en entorno urbano denso` |
| `docs` | Solo documentación | `docs(handshake): documentar protocolo QR dinámico` |
| `test` | Tests nuevos o corrección de tests | `test(pricing): cubrir casos borde de distancia` |
| `refactor` | Refactoring sin cambio de comportamiento | `refactor(auth): extraer validación JWT` |
| `chore` | Mantenimiento, dependencias, configuración | `chore(deps): actualizar expo SDK` |
| `perf` | Mejora de performance | `perf(pricing): cachear distancias en Redis` |
| `ci` | Cambios en pipelines de CI/CD | `ci(deploy): agregar step de deploy a staging` |

: Tipos de commit válidos.

## Vincular commits con Linear

El *footer* `Refs:` vincula el commit al issue **sin cerrarlo**. El issue se cierra desde el Pull Request con `Closes MOVO-xxx`, nunca desde un commit individual, para que el issue no se cierre prematuramente.

| Hacer | No hacer |
|---|---|
| Commits atómicos: un cambio lógico por commit | Commits «wip», «arreglando cosas», «cambios» |
| Descripción en minúsculas, sin punto final | Más de un cambio conceptual por commit |
| Siempre incluir `Refs: MOVO-xxx` en el footer | Commits sin referencia a Linear |
| Usar el scope para indicar el dominio afectado | Mezclar `feat` y `fix` en el mismo commit |
| Body explicando el *por qué* cuando no es obvio | Commits de merge manuales (se usa squash merge) |

: Buenas prácticas para commits.

# Pull Requests

Toda integración de trabajo a `develop` o `main` pasa por un Pull Request. Es el único punto donde el código es revisado y donde Linear actualiza automáticamente el estado del issue.

**Título:** `<tipo>(<scope>): <descripción> [MOVO-<id>]`, por ejemplo `feat(kyc): flujo biométrico completo [MOVO-142]`.

**Descripción:** es la única documentación que queda del trabajo. Se completa con una plantilla (`.github/pull_request_template.md`) que pide: qué hace el PR, tipo de cambio, decisiones de diseño no obvias, un checklist (tests unitarios y de integración, Swagger actualizado, variables de entorno documentadas) y la referencia `Closes MOVO-xxx`, con la que Linear mueve el issue a *Done* cuando el PR se mergea.

**Revisión y merge:** al menos un integrante distinto del autor revisa y aprueba (los revisores se asignan automáticamente y hay un `CODEOWNERS` para todo el repositorio), junto con la auto-revisión de agentes de IA para calidad y vulnerabilidades. Al mergear se utiliza siempre **Squash and Merge**: colapsa los commits de la rama en uno solo y mantiene limpio el historial de `develop`.
