# Póster

El póster comunica el proyecto de forma visual en la jornada de presentación. Se elaboró en formato A0 vertical y se reproduce a continuación a página completa. Sintetiza el problema, la solución en cinco pasos, los puntos clave del producto (identidad verificada, entrega garantizada y pago seguro), las tecnologías utilizadas, y el respaldo de datos de la encuesta propia realizada durante el Estudio Inicial (N = 184).

![Póster del proyecto Movo (formato A0 vertical, reducido a página A4).](assets/poster/poster-a0.jpg){.pagina-completa}

# Ficha de Herramientas y Tecnologías

La cátedra solicitó, junto con el paper y el póster, una ficha con las herramientas y tecnologías utilizadas. Se reproduce la ficha presentada en la jornada, con una columna que indica lo que difiere en el estado final del proyecto.

| Ámbito de aplicación | Nombre y versión (ficha presentada) | Estado final |
|---|---|---|
| Entorno de desarrollo | Docker + Docker Compose (el entorno local replica producción); variables de entorno en `.env` local por desarrollador; Postman para pruebas de endpoints | Sin cambios |
| Repositorios y versionado | GitHub (monorepo): GitHub Flow + capa `develop`, Conventional Commits y Pull Requests; GitHub Actions (CI/CD) | Sin cambios |
| Programación | TypeScript/Node.js + Fastify (API Gateway, `svc-users`, `svc-shipments`, `svc-payments`, `svc-admin`); Python + FastAPI (`svc-pricing-logistics`, OR-Tools); React Native + Expo (app móvil); Next.js + TypeScript (`movo-admin`, sitio institucional) | Sin cambios |
| Base de datos | PostgreSQL 16 (datos transaccionales) y Redis 7 (sesiones, caché, estado de WebSockets); | Se incorporó Prisma como ORM (ADR-011) |
| Comunicación interna | Discord (canal principal, coordinación técnica y ceremonias) y WhatsApp (comunicación informal y urgente) | Sin cambios |
| Capacitación | Claude y GitHub Copilot como apoyo al desarrollo, la documentación y la resolución de dudas técnicas; documentación oficial de los proveedores externos | Sin cambios (política de IA en el Working Agreement) |
| Pruebas de sistema | Jest, React Native Testing Library y Pytest (unitarias); Supertest (integración); GitHub Actions (ejecución continua en CI) | Servicios Node y gateway con Vitest + `app.inject()`; `movo-admin` con Vitest; ver Plan de Testing |
| Gestión del proyecto | Linear y una plataforma desarrollada a medida (Movo-PM) para la gestión de relaciones y bloqueos entre historias | Sin cambios |
| Documentación | Google Drive (documentos no-código, ADRs, informes de sprint, actas) y Swagger/OpenAPI generado automáticamente por Fastify y FastAPI | Los ADRs también viven en `docs/` del repositorio; las fuentes de estos tomos, en `docs/tomos/` |
| Modelos | Modelo C4 (Contexto, Contenedores, Despliegue) en diagrams.net y modelos E-R en dbdiagram.io | Para esta documentación final los diagramas se redibujaron en PlantUML y el DER se mantiene en DBML |

: Ficha de herramientas y tecnologías.

# Video del Proyecto

El video demuestra el funcionamiento del producto: el recorrido de un envío desde su publicación hasta la entrega, con el seguimiento en tiempo real. Forma parte de la presentación del proyecto junto con el paper y el póster.

::: pendiente
Incluir en este apartado el enlace público del video y su código QR. El video final está en la carpeta *Paper y Poster* de Drive del equipo; falta confirmar qué versión se entrega y publicar un enlace de acceso libre (el de Drive es privado).
:::
