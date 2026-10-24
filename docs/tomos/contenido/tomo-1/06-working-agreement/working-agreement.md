# Roles del Equipo

| Rol | Integrante/s | Responsabilidad |
|---|---|---|
| Product Owner | Vergara, Tomás Ignacio | Define y prioriza el backlog; valida que las historias reflejen la visión del producto. |
| Scrum Master | Ariza, Alena (rotativo) | Se renueva cada mes (equivalente a dos sprints). Facilita las ceremonias, remueve impedimentos y vela por el cumplimiento de este acuerdo. |
| Equipo de Desarrollo | Todos los integrantes del grupo | Cada desarrollador es responsable de las pruebas unitarias y de la documentación de su propio código. La validación funcional cruzada se realiza durante la revisión del Pull Request, donde al menos un integrante distinto del autor verifica el comportamiento del cambio. |

: Roles Scrum del equipo.

# Normas de Trabajo y Ceremonias

## Duración y estructura de los sprints

Cada sprint tiene una duración de dos semanas. El Sprint 0 se utiliza para definir la forma de trabajo, la arquitectura, el backlog inicial y la estrategia de testing; los sprints siguientes construyen el producto de forma incremental.

## Ceremonias

| Ceremonia | Cuándo | Propósito |
|---|---|---|
| Planning | Viernes de fin de sprint | Se definen las historias que ingresan al siguiente sprint y se estiman sus Story Points. |
| Weekly | Martes | Control semanal de estado; se usa además para el refinamiento del backlog. |
| Standup | Miércoles y viernes | Reunión breve de seguimiento de avances, impedimentos y próximos pasos. |
| Retrospectiva | Fin de cada sprint | Análisis de cómo trabajó el equipo; identificación de mejoras e ítems de acción concretos. |

: Ceremonias del equipo.

# Canales de Comunicación

- **Servidor de Discord exclusivo del equipo:** canal principal para la coordinación técnica, las discusiones de arquitectura y el seguimiento de tareas. Los canales de voz se usan para las ceremonias cuando se realizan de forma virtual.
- **WhatsApp:** canal informal para la comunicación rápida y urgente entre integrantes.

# Estrategias de Versionado y Revisión de Código

::: nota
Esta sección resume lo acordado en el Working Agreement; el detalle completo (ramas, commits, Pull Requests) se desarrolla en el documento *Gestión de la Configuración* de este tomo.
:::

## Repositorio y documentación

El código fuente se gestiona en GitHub. La documentación del proyecto y los entregables académicos se almacenan en una carpeta compartida de Google Drive.

## Modelo de ramas

- `main`: contiene únicamente versiones estables y funcionales del proyecto. No se permiten commits directos.
- `develop`: rama principal de desarrollo e integración continua.
- `feature/*` y `fix/*`: cada nueva funcionalidad o corrección se desarrolla en una rama independiente, creada desde `develop`.

## Pull Requests y revisión de código

La integración de cambios se realiza exclusivamente mediante Pull Requests. Antes de aprobar un merge, al menos un integrante distinto del autor debe revisar el código verificando funcionamiento, legibilidad y cumplimiento de los estándares acordados por el equipo; esto incluye la validación funcional cruzada de los cambios introducidos. Además, se utilizan las funciones de auto-revisión de Pull Requests de GitHub Copilot, que emplean agentes de IA para monitorear los cambios y validar calidad del código, estándares y vulnerabilidades críticas de seguridad antes de que lleguen a las ramas `develop` y `main`.

## Convención de commits

Los mensajes de commit siguen el estándar de *Conventional Commits*:

| Tipo | Uso |
|---|---|
| `feat` | Nueva funcionalidad. |
| `fix` | Corrección de un bug. |
| `docs` | Cambios en documentación. |
| `refactor` | Reestructuración de código sin cambio de comportamiento. |
| `test` | Incorporación o corrección de pruebas. |
| `chore` | Tareas de mantenimiento, configuración o dependencias. |

: Tipos de commit acordados.

# Definition of Ready

Una Historia de Usuario está lista para ingresar al sprint cuando cumple todos los siguientes criterios:

- Tiene una descripción clara y entendible por todo el equipo.
- El objetivo de la historia es comprendido por todos los integrantes.
- Los criterios de aceptación están definidos y son verificables.
- La prioridad está definida en el backlog por el Product Owner.
- La historia fue estimada por el equipo mediante Story Points.

# Definition of Done

Una Historia de Usuario se considera terminada cuando cumple todos los siguientes criterios:

- El desarrollo fue completado.
- El código compila y funciona correctamente en el ambiente de desarrollo.
- Pasa las pruebas funcionales básicas definidas en los criterios de aceptación.
- El código fue revisado por al menos un integrante distinto del autor.
- El Pull Request fue aprobado y mergeado a la rama `develop`.
- La documentación necesaria del producto fue actualizada.
- La funcionalidad cumple los criterios de aceptación definidos en la historia.

::: importante
**Cómo se verificó en la práctica.** La Definition of Done se apoya en controles automáticos: el check `tests-summary` de la integración continua bloquea el merge a `develop` y `main` si fallan lint, type-check o tests, y el equipo exige que el *Swagger* generado y el `.env.example` estén actualizados en el mismo Pull Request.
:::

# Política de Uso de Inteligencia Artificial

El equipo utiliza herramientas de IA como apoyo al desarrollo, la documentación y la resolución de dudas técnicas. Las herramientas autorizadas son **ChatGPT, Claude, Gemini y GitHub Copilot**. El uso debe ser responsable y complementario al trabajo humano, bajo los siguientes lineamientos:

- **Revisión obligatoria:** todo contenido generado mediante IA debe ser revisado, validado y adaptado por un integrante del equipo antes de incorporarse al proyecto.
- **Tratamiento de información sensible:** no se comparten con herramientas de IA externas datos reales de usuarios, credenciales, claves de API ni información confidencial del proyecto. Si se necesita asistencia con código que involucre datos sensibles, se utilizan datos ficticios o anonimizados.
- **Responsabilidad humana:** la responsabilidad final sobre el código, la documentación y las decisiones técnicas y de diseño recae exclusivamente sobre los miembros del equipo.
