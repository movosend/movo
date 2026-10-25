# Declaración de Alcance

El alcance se divide en lo que el proyecto incluye en su versión MVP y lo que queda explícitamente fuera de alcance para esta instancia del Trabajo Final de Grado.

<table>
<caption>Alcance del proyecto.</caption>
<thead><tr><th style="width:55%">Incluye</th><th>No incluye (fuera de alcance)</th></tr></thead>
<tbody><tr>
<td>

- Aplicación móvil multiplataforma (iOS y Android) en React Native + Expo.
- Backend con microservicios en Node.js + Fastify y Python + FastAPI.
- Base de datos PostgreSQL 16 y caché Redis 7.
- Integración con Mercado Pago Marketplace (Auth & Capture, Split Payments).
- Integración con Didit.me para KYC biométrico y verificación documental.
- Protocolo Cryptographic Handshake con QR dinámico y validación GPS.
- Motor de precios dinámico y sistema de subastas entre transportistas.
- Algoritmo VRPTW de optimización de rutas (Google OR-Tools + Google Maps Distance Matrix API).
- Tracking en tiempo real con WebSockets (Socket.io).
- Sistema de reputación bidireccional y perfiles sociales.
- Registro de evidencia fotográfica en puntos clave del flujo (AWS S3).
- Panel de administración web (Next.js) para monitoreo y resolución de disputas.
- Chat en tiempo real entre las partes de una transacción.
- Documentación OpenAPI/Swagger generada automáticamente.

</td>
<td>

- Integración con proveedores de pago distintos de Mercado Pago.
- Seguro de carga (contemplado como funcionalidad futura).
- Aplicación web para usuarios finales (solo móvil en este alcance).
- Gestión de logística B2B/B2C o integración con ERPs empresariales.
- Blockchain pública o red distribuida para el registro de transferencias.
- Integración con operadores logísticos tradicionales (Correo Argentino, Andreani, etc.).

</td>
</tr></tbody>
</table>

::: nota
**Nota de compilación.** Dos elementos del alcance cambiaron de tecnología durante el desarrollo, sin cambiar la funcionalidad comprometida: la matriz de distancias pasó de la Distance Matrix API (declarada *Legacy* por Google) a la Routes API (ADR-015), y el canal de tiempo real pasó de Socket.io a WebSocket nativo sobre `@fastify/websocket` (ADR-019). Ambas decisiones se documentan en el Tomo II.
:::

# Equipo de Trabajo y Roles

El equipo está compuesto por cinco integrantes organizados bajo el marco Scrum. Cada integrante participa activamente en el equipo de desarrollo, independientemente de su rol de gestión, dado que se trata de un equipo pequeño con alta autonomía técnica.

| Rol | Integrante/s | Responsabilidades principales |
|---|---|---|
| Product Owner | Vergara, Tomás Ignacio | Define y prioriza el backlog. Valida que las historias reflejen la visión del producto. Interlocutor entre el equipo docente y el equipo de desarrollo. |
| Scrum Master | Ariza, Alena (rotativo cada 2 sprints) | Facilita las ceremonias Scrum. Remueve impedimentos. Vela por el cumplimiento del Working Agreement y la mejora continua del equipo. |
| Equipo de Desarrollo | Todos los integrantes | Diseña, implementa y prueba las funcionalidades comprometidas en cada sprint. Cada desarrollador es responsable de las pruebas unitarias de su propio código y de documentarlo. |

: Roles y responsabilidades.

# Propuesta Metodológica

El equipo adopta Scrum como marco metodológico principal, adaptado al contexto académico y al tamaño del equipo. La elección responde a la necesidad de entregas incrementales, visibilidad continua del avance para el equipo docente y flexibilidad para incorporar feedback entre sprints.

## Forma de Coordinación

El trabajo se organiza en sprints de dos semanas. La coordinación se apoya en tres pilares: las ceremonias Scrum, los canales de comunicación acordados y las herramientas de gestión del proyecto.

### Ceremonias

| Ceremonia | Frecuencia | Duración | Participantes | Objetivo |
|---|---|---|---|---|
| Sprint Planning | Viernes de inicio de sprint | ~2 horas | Todo el equipo | Seleccionar historias del backlog, definir el Sprint Goal y estimar mediante Planning Poker. |
| Weekly / Refinamiento | Martes | ~1 hora | Todo el equipo | Control de estado y refinamiento del backlog: desglose de historias, actualización de criterios de aceptación. |
| Daily Standup | Miércoles y viernes | ~15 minutos | Todo el equipo | Sincronizar avances, identificar impedimentos y coordinar próximos pasos. |
| Sprint Review | Fin de cada sprint | ~1 hora | Todo el equipo + docentes | Demostrar las funcionalidades completadas e incorporar feedback del equipo docente. |
| Retrospectiva | Fin de cada sprint | ~45 minutos | Todo el equipo | Identificar qué salió bien, qué mejorar e ítems de acción concretos para el próximo sprint. |

: Ceremonias Scrum del equipo.

### Canales de Comunicación

La comunicación del equipo se centraliza en dos canales complementarios:

- **Discord (canal principal):** servidor exclusivo del equipo con canales temáticos para coordinación técnica, discusiones de arquitectura y seguimiento de tareas. Incluye canales de voz para las ceremonias virtuales.
- **WhatsApp (canal informal):** comunicación rápida y urgente entre integrantes.

### Herramientas de Gestión

- **Linear:** gestión del backlog y seguimiento de issues (prefijo `MOVO-`). Permite vincular commits y pull requests a historias de usuario, y extraer las métricas de seguimiento definidas en la sección de métricas.
- **GitHub (monorepo):** versionado del código fuente con modelo de ramas GitHub Flow + capa `develop`, Conventional Commits y Pull Requests como única vía de integración.
- **Google Drive:** almacenamiento de documentación no-código (entregables académicos, actas, diseños). Convención de nombres: `[Movo] NNN-Nombre del documento`.
- **GitHub Actions:** pipelines de CI/CD para lint, tests, build y deploy automático a los ambientes dev (`develop`) y prod (`main`).

## Técnica de Estimación

El equipo utiliza **Planning Poker** como técnica de estimación de Story Points. Esta técnica fue seleccionada por las siguientes razones:

- **Estimación colectiva:** todos los integrantes votan de forma simultánea y anónima, evitando el sesgo de anclaje que ocurre cuando alguien propone un valor primero.
- **Facilita la discusión:** las divergencias entre estimaciones son una señal de que la historia necesita más claridad o descomposición, lo que mejora la calidad del backlog.
- **Velocidad:** una vez que el equipo tiene experiencia calibrada, las sesiones de estimación son eficientes y pueden combinarse con el refinamiento del backlog.

### Protocolo de sesión

Las sesiones de Planning Poker se realizan durante el Sprint Planning y opcionalmente durante el Weekly del martes cuando se refina el backlog. El flujo es el siguiente:

1. El Product Owner presenta la historia y responde preguntas de clarificación.
2. Cada integrante selecciona en silencio un valor de la secuencia de Fibonacci simplificada: 1, 2, 3, 5, 8, 13, 21, ?.
3. Se revelan todas las cartas simultáneamente.
4. Si hay convergencia (valores dentro de un rango de una posición en la escala), se adopta el valor más alto del rango.
5. Si hay divergencia significativa, los extremos argumentan su estimación. Se revota una vez. Si persiste la divergencia, se escala al siguiente valor por precaución o se descompone la historia.
6. El valor `?` indica que el integrante no tiene suficiente información para estimar; activa automáticamente una ronda de aclaraciones.

### Escala y calibración

La escala utiliza la secuencia de Fibonacci simplificada (1, 2, 3, 5, 8, 13, 21). Como referencia de calibración del equipo, una historia de complejidad 1 corresponde a una tarea de configuración o ajuste menor (por ejemplo, agregar una variable de entorno y documentarla en `.env.example`). Una historia de 8 implica integración con un servicio externo con flujo de estados no trivial. Las historias estimadas en 13 o más puntos deben ser descompuestas antes de ingresar al sprint.

## Métricas de Seguimiento

El equipo define seis métricas de seguimiento, organizadas en dos grupos: métricas de flujo (Velocity, Burndown, Lead Time y Cycle Time) y métricas de calidad y predictibilidad (Sprint Goal Achievement y Defect Rate). Todas se registran al cierre de cada sprint en el Informe de Sprint redactado por el Scrum Master.

| Métrica | Definición | Cómo se mide | Frecuencia |
|---|---|---|---|
| Velocity | Story Points completados (DoD cumplida) por sprint. | Suma de SP de historias mergeadas a `develop` al cierre del sprint. Se grafica la tendencia a lo largo de los sprints. | Por sprint |
| Sprint Burndown | SP restantes vs. SP planificados a lo largo del sprint. | Gráfico actualizado en cada standup con los SP pendientes. Permite detectar desvíos temprano. | Por standup (2 veces por semana) |
| Lead Time | Tiempo desde que una historia entra al sprint (estado *In Progress*) hasta que se mergea a `develop`. | Registro de fechas en Linear por historia. Se calcula el promedio por sprint. | Por sprint |
| Cycle Time | Tiempo desde que una tarea pasa a *In Progress* hasta *Done* dentro del sprint activo. | Linear reporta automáticamente la duración por estado. Complementa el Lead Time. | Por sprint |
| Sprint Goal Achievement | Porcentaje de historias comprometidas en el sprint que alcanzan DoD. | Al cierre del sprint: historias completadas / historias comprometidas × 100. Se registra en el informe de sprint. | Por sprint |
| Defect Rate | Cantidad de bugs introducidos por sprint, detectados en testing o revisión de PRs. | Issues de tipo *fix* en Linear creados durante o después del sprint en que se introdujo el defecto. | Por sprint |

: Métricas de seguimiento del proyecto.

### Umbrales y acciones

Las métricas son un insumo para la Retrospectiva. No se establecen umbrales rígidos en los primeros sprints, dado que el equipo necesita acumular datos para calcular una velocity de referencia. A partir del Sprint 3 se definen los siguientes criterios de alerta:

- **Velocity:** caída mayor al 30% respecto al promedio de los últimos 2 sprints → revisar capacidad del equipo y compromisos del sprint.
- **Sprint Goal Achievement < 70%** → revisar proceso de estimación y criterios de DoR antes de comprometer historias.
- **Defect Rate > 3 bugs por sprint** → revisar la cobertura de tests unitarios y el checklist de PRs.
- **Lead Time promedio > 7 días** → revisar si las historias son demasiado grandes o si hay bloqueos no resueltos.

### Herramienta de registro

Linear es la fuente de verdad para todas las métricas. Las vistas de Cycle Time y Lead Time están disponibles nativamente en el módulo de reportes de Linear. Velocity y Sprint Goal Achievement se calculan manualmente al cierre del sprint y se registran en el Informe de Sprint en Google Drive. El Scrum Master es responsable de mantener actualizado el registro en cada sprint.

::: apaisada

# Work Breakdown Structure

La WBS descompone el proyecto en sus entregables de gestión (Estudio Inicial y Gestión de Proyecto) y en un paquete de trabajo por sprint, desde el Sprint 0 hasta el Sprint 8. Cada sprint incluye las actividades recurrentes de Scrum (planning, sprint backlog, review y retrospectiva) y los módulos funcionales planificados para ese sprint. Se presenta en dos láminas para mantener la legibilidad.

![WBS (1 de 2): entregables de gestión y sprints de inicio y fundaciones (Estudio Inicial, Gestión de Proyecto, Sprint 0 a Sprint 3).](diagrama:pp-wbs-1)

![WBS (2 de 2): sprints de construcción del producto (Sprint 4 a Sprint 8).](diagrama:pp-wbs-2)

La WBS se redibujó con la notación común de la documentación a partir del diagrama original del equipo (*[Movo] WBS*), sin cambios de contenido. Refleja la planificación de junio de 2026; el orden real en que se construyó cada módulo se registra en los Informes de Sprint.

:::

::: apaisada

# Cronograma

El cronograma se alinea al calendario académico 2026 de la cátedra y a las cinco instancias de la *Guía de Documentación a Presentar*. Los sprints son de dos semanas y comienzan los lunes; sus fechas son las de los ciclos registrados en Linear (el Sprint *N* corresponde al *Cycle N+1*).

![Cronograma del proyecto alineado al calendario académico (diagrama de Gantt).](diagrama:pp-cronograma)

| Sprint | Ciclo en Linear | Desde | Hasta | Foco principal |
|---|---|---|---|---|
| Sprint 0 | (previo a Linear) | 29/06/2026 | 12/07/2026 | Bases operativas y técnicas: Working Agreement, gestión de la configuración, arquitectura y stack, plan de testing, user story mapping |
| Sprint 1 | Cycle 2 | 13/07/2026 | 26/07/2026 | Infraestructura como código (AWS y Terraform), CI/CD inicial, DER y diagramas de estados |
| Sprint 2 | Cycle 3 | 27/07/2026 | 09/08/2026 | Módulo de Identidad y Confianza: gateway, autenticación, registro con OTP, KYC y perfil |
| Sprint 3 | Cycle 4 | 10/08/2026 | 23/08/2026 | Creación de envíos (wizard con fotos y precio sugerido), aceptación del receptor, notificaciones push, cancelación e historial |
| Sprint 4 | Cycle 5 | 24/08/2026 | 06/09/2026 | Marketplace de ofertas: paquetes disponibles, viajes, ofertas y contraofertas, y reputación y calificaciones |
| Sprint 5 | Cycle 6 | 07/09/2026 | 20/09/2026 | Circuito del envío asignado: matching por desvío, envíos activos, evidencia fotográfica y base del handshake y del tracking |
| Sprint 6 | Cycle 7 | 21/09/2026 | 04/10/2026 | Handshake de retiro y entrega, tracking en vivo, ruta multi-parada y reputación |
| Sprint 7 | Cycle 8 | 05/10/2026 | 18/10/2026 | Pagos con Mercado Pago (vinculación, tarjetas, hold, captura y split), penalidades, chat y acceso al panel de administración |
| Sprint 8 | Cycle 9 | 19/10/2026 | 01/11/2026 | Panel de administración (usuarios, sanciones, soporte y envíos), disputas, atribución del no-retiro, cierre del circuito de pagos y documentación legal |

: Calendario de sprints.

:::

# Plan de Riesgos

Esta sección identifica los riesgos relevantes para el desarrollo de Movo durante los siete meses de proyecto, evalúa su probabilidad e impacto, y define estrategias de mitigación concretas para cada uno. El objetivo es anticipar los principales puntos de fricción del proyecto y dejar establecido, desde el inicio, cómo el equipo va a responder ante ellos.

## Metodología

Cada riesgo se evalúa en dos dimensiones, usando una escala cualitativa de tres niveles (Baja/Media/Alta para probabilidad y Bajo/Medio/Alto para impacto):

- **Probabilidad:** qué tan factible es que el riesgo se materialice durante el desarrollo del proyecto.
- **Impacto:** qué tan grave sería el efecto sobre el proyecto (cronograma, alcance, calidad o viabilidad técnica) si el riesgo ocurre.

La combinación de ambas dimensiones determina la prioridad del riesgo, que es la que define cuánto esfuerzo de mitigación se le dedica. La siguiente matriz resume las combinaciones posibles:

<table class="matriz">
<caption>Matriz de prioridad de riesgos (probabilidad × impacto).</caption>
<thead><tr><th></th><th>Impacto bajo</th><th>Impacto medio</th><th>Impacto alto</th></tr></thead>
<tbody>
<tr><th>Probabilidad baja</th><td>Bajo</td><td>Bajo</td><td><span class="chip">Medio</span></td></tr>
<tr><th>Probabilidad media</th><td>Bajo</td><td><span class="chip">Medio</span></td><td><span class="chip warn">Alto</span></td></tr>
<tr><th>Probabilidad alta</th><td><span class="chip">Medio</span></td><td><span class="chip warn">Alto</span></td><td><span class="chip err">Crítico</span></td></tr>
</tbody>
</table>

Para cada riesgo identificado se define además una estrategia de mitigación concreta y accionable, orientada a reducir la probabilidad de ocurrencia, acotar el impacto, o ambas. Los riesgos de prioridad Alta y Crítica son los que reciben seguimiento explícito durante las retrospectivas de cada sprint.

## Identificación y evaluación de riesgos

<table class="compacta">
<caption>Registro inicial de riesgos.</caption>
<thead><tr><th>ID</th><th style="width:28%">Riesgo</th><th>Categoría</th><th>Prob.</th><th>Impacto</th><th>Prioridad</th><th style="width:34%">Estrategia de mitigación</th></tr></thead>
<tbody>
<tr><td class="mono">R01</td><td>La disponibilidad real del equipo es menor a la estimada por compromisos laborales o académicos en paralelo.</td><td>Equipo</td><td>Alta</td><td>Alto</td><td><span class="chip err">Crítico</span></td><td>Recalibrar la capacidad por sprint usando la velocity real de los primeros dos sprints. El buffer de gestión (~60 hs) ya contemplado en la planificación actúa como colchón.</td></tr>
<tr><td class="mono">R02</td><td>Integración con Didit.me presenta demoras o comportamientos no documentados (sandbox vs. producción, costos por verificación).</td><td>Técnico</td><td>Media</td><td>Alto</td><td><span class="chip warn">Alto</span></td><td>Spike técnico en sprint 1-2 para validar el flujo completo en sandbox antes de comprometer cronograma. Plan B: revisión manual documentada si el SLA no se cumple.</td></tr>
<tr><td class="mono">R03</td><td>OR-Tools VRPTW no converge en tiempos razonables o requiere tuning extenso de parámetros.</td><td>Técnico</td><td>Media</td><td>Alto</td><td><span class="chip warn">Alto</span></td><td>Probar con datasets sintéticos chicos desde temprano y fijar un límite de tiempo de cómputo como criterio de aceptación. Fallback: heurística greedy documentada como contingencia.</td></tr>
<tr><td class="mono">R04</td><td>Subestimación de horas en historias complejas (motor de pricing, handshake criptográfico).</td><td>Cronograma</td><td>Media</td><td>Alto</td><td><span class="chip warn">Alto</span></td><td>Re-estimar al cierre de cada sprint comparando lo estimado vs. lo real. Si el desvío acumulado supera ~15%, recortar alcance del backlog del MVP.</td></tr>
<tr><td class="mono">R05</td><td>El solapamiento con parciales y finales reduce drásticamente la velocidad del equipo en semanas puntuales.</td><td>Cronograma</td><td>Alta</td><td>Medio</td><td><span class="chip warn">Alto</span></td><td>Mapear el calendario académico desde el inicio del proyecto, planificar sprints livianos en esas semanas y adelantar tareas no críticas.</td></tr>
<tr><td class="mono">R06</td><td>Conocimiento crítico concentrado en una sola persona por dominio (p. ej. pricing/logística, KYC), generando un punto único de falla.</td><td>Equipo</td><td>Media</td><td>Alto</td><td><span class="chip warn">Alto</span></td><td>Sesiones de transferencia de conocimiento en hitos clave y documentación técnica obligatoria (ADRs, READMEs) para todos los componentes críticos.</td></tr>
<tr><td class="mono">R07</td><td>Scope creep: funcionalidades no planificadas se cuelan en el desarrollo y comprometen el alcance del MVP.</td><td>Alcance</td><td>Media</td><td>Alto</td><td><span class="chip warn">Alto</span></td><td>Todo requerimiento nuevo pasa por una evaluación de impacto contra el backlog antes de incorporarse. El Product Owner es el único habilitado para reordenar prioridades.</td></tr>
<tr><td class="mono">R08</td><td>La demo o presentación falla por dependencia de servicios externos en vivo (Mercado Pago, Didit.me, Google Maps).</td><td>Externo</td><td>Media</td><td>Alto</td><td><span class="chip warn">Alto</span></td><td>Entorno de demo con datos y respuestas mockeadas pregrabadas como respaldo. Ensayo completo de la demo antes de cada presentación ante el tribunal.</td></tr>
<tr><td class="mono">R09</td><td>El handshake criptográfico con NFC presenta incompatibilidades entre dispositivos o falta hardware para testear.</td><td>Técnico</td><td>Media</td><td>Medio</td><td><span class="chip">Medio</span></td><td>El QR como fallback ya forma parte del diseño y reduce el impacto. Testear NFC en al menos dos dispositivos físicos distintos desde los sprints tempranos.</td></tr>
<tr><td class="mono">R10</td><td>Los costos de uso de APIs externas (Google Maps, Didit.me) superan lo presupuestado al escalar pruebas o usuarios.</td><td>Externo</td><td>Media</td><td>Medio</td><td><span class="chip">Medio</span></td><td>Uso de distancia euclidiana como mock en desarrollo (ya decidido) para evitar costos. Definir y monitorear un tope mensual de verificaciones reales en Didit.me.</td></tr>
<tr><td class="mono">R11</td><td>Cambios de pricing, free tier o disponibilidad de servicios de terceros (Didit.me, Mercado Pago, Google Maps) durante el desarrollo.</td><td>Externo</td><td>Baja</td><td>Alto</td><td><span class="chip">Medio</span></td><td>Implementar capas de abstracción/adaptadores para cada integración externa, de forma que un cambio de proveedor tenga impacto acotado y localizado.</td></tr>
</tbody>
</table>

Este listado se revisa al cierre de cada sprint: se actualizan probabilidad e impacto en función de la información disponible, se incorporan nuevos riesgos que surjan durante el desarrollo y se cierran aquellos que dejen de ser relevantes. La evolución del registro sprint a sprint se documenta en cada Informe de Sprint.

# Presupuesto de Desarrollo y Costo Operativo

## Presupuesto de Desarrollo

El presupuesto de desarrollo de Movo se construye sobre dos componentes: el costo de mano de obra (valorizado a precio de mercado, ya que el esfuerzo del equipo no representa una erogación real durante el Proyecto Final) y los gastos directos del proyecto (suscripciones, infraestructura y servicios contratados durante la fase de construcción).

### Costo de mano de obra (valorización nocional)

La estimación de esfuerzo proviene del Backlog Inicial (Sprint 0): 352 horas netas de desarrollo, ampliadas a 422 horas al incorporar el buffer de gestión del 20% (reuniones, code review y coordinación). Estas horas se valorizan a la tarifa de mercado de un desarrollador junior en Argentina.

**Tarifa de referencia: USD 22/hora.** El rango de mercado para perfiles junior en Argentina se ubica entre USD 18 y 25/hora. Se adopta USD 22 como valor conservador y defendible, dentro de la banda local.

| Concepto | Horas | Tarifa (USD/h) | Subtotal (USD) |
|---|--:|--:|--:|
| Desarrollo neto (backlog) | 352 | 22 | 7.744 |
| Buffer de gestión (+20%) | 70 | 22 | 1.540 |
| **Total mano de obra (valorizada)** | **422** | **22** | **9.284** |

: Costo de mano de obra valorizado.

::: nota
**Nota metodológica.** Este monto es una valorización nocional del esfuerzo a precio de mercado, no una erogación real. Durante el Proyecto Final el trabajo lo aportan los cinco integrantes del equipo sin costo laboral efectivo. Se incluye para dimensionar el valor del producto y permitir una eventual proyección comercial.
:::

| Escenario | Tarifa (USD/h) | Total mano de obra (USD) |
|---|--:|--:|
| Conservador (piso de mercado) | 18 | 7.596 |
| Base (adoptado) | 22 | 9.284 |
| Optimista (techo junior local) | 25 | 10.550 |

: Análisis de sensibilidad del costo de mano de obra (sobre 422 horas).

### Gastos directos del proyecto (fase de construcción)

Erogaciones reales o potenciales durante el desarrollo (aproximadamente 4 a 5 meses de construcción efectiva). Varios servicios operan en capa gratuita (*free tier*) en el volumen del Proyecto Final; se indican como USD 0 cuando corresponde, manteniéndolos en la tabla para trazabilidad.

| Ítem | Detalle | Mensual (USD) | Fase desarrollo (USD) |
|---|---|--:|--:|
| Dominio (.app) | Registro anual prorrateado | ~1,5 | 18 (anual) |
| Cuenta Apple Developer | Publicación en App Store (anual) | – | 99 (anual) |
| Cuenta Google Play | Pago único de registro | – | 25 (único) |
| AWS, ambiente dev | EC2 + S3 + Secrets Manager (free tier parcial) | ~15 | ~75 |
| Didit.me (KYC) | Verificaciones de prueba | Free tier | 0 |
| Google Maps Distance Matrix | Crédito mensual gratuito (USD 200) | Free tier | 0 |
| Mercado Pago (sandbox) | Ambiente de pruebas | 0 | 0 |
| Vercel (frontends) | Plan Hobby | 0 | 0 |
| GitHub | Repositorios + Actions (gratuito para el volumen) | 0 | 0 |
| Linear | Plan gratuito (equipo pequeño) | 0 | 0 |
| **Total gastos directos** | | | **~242** |

: Gastos directos de la fase de construcción.

Los servicios de pago efectivo durante la construcción son acotados: dominio, cuentas de tiendas de aplicaciones y el ambiente dev de AWS. El resto del stack opera dentro de capas gratuitas para el volumen del Proyecto Final.

### Presupuesto total de desarrollo

| Componente | Monto (USD) |
|---|--:|
| Mano de obra valorizada (nocional) | 9.284 |
| Gastos directos (caja real) | ~242 |
| **Presupuesto total de desarrollo** | **~9.526** |
| Del cual, desembolso real de caja | ~242 |

: Presupuesto total de desarrollo.

## Costo Operativo Mensual (sistema en producción)

Estructura de costos recurrentes una vez que Movo opera en producción con volumen bajo a moderado (etapa inicial post-lanzamiento). Todos los montos en USD por mes.

| Servicio | Función | USD/mes |
|---|---|--:|
| AWS EC2 (prod) | Instancia que ejecuta todos los contenedores Docker | 30–50 |
| AWS S3 | Imágenes de envíos (2 a 6 por envío activo) | 2–5 |
| AWS Secrets Manager | Gestión de secretos (por secreto/mes) | ~2 |
| Transferencia de datos AWS | Egress, presigned URLs | 3–8 |
| Dominio + certificado TLS | Prorrateo anual; TLS vía Let's Encrypt (gratuito) | ~1,5 |
| Didit.me (KYC) | Verificación biométrica por usuario nuevo | Variable |
| Google Maps Distance Matrix | Cálculo de rutas y distancias por envío | Variable |
| Mercado Pago | Comisión de procesamiento (la absorbe el flujo) | 0 fijo |
| Vercel | Hosting de frontends (Hobby/Pro según tráfico) | 0–20 |
| Push notifications (Expo) | Notificaciones a la app móvil | 0 |
| **Costo operativo fijo base** | | **~40–90** |

: Costo operativo mensual estimado.

| Servicio | Driver de costo | Costo unitario aproximado |
|---|---|---|
| Didit.me (KYC) | Por verificación de usuario nuevo | A confirmar con el proveedor; mitigado por caché y re-verificación periódica |
| Google Maps Distance Matrix | Por elemento de matriz consultado | El crédito gratuito de USD 200/mes cubre el volumen inicial |

: Costos variables que escalan con el volumen.

::: importante
**Observación clave.** Los dos costos variables relevantes (KYC y Maps) están acotados en la etapa inicial. KYC es un costo único por usuario (no recurrente), y Maps cuenta con un crédito mensual gratuito que absorbe el volumen temprano. Por eso el costo operativo fijo se mantiene en una banda baja (~40 a 90 USD/mes) hasta alcanzar escala significativa.
:::

# Flujo de Fondos y Estrategia de Monetización

## Modelo de Monetización

Movo opera bajo un modelo de comisión por transacción (*take rate*). La plataforma cobra un **15%** sobre el valor de cada envío completado exitosamente. Este porcentaje es el único ingreso que Movo procesa en sus cuentas, gracias al mecanismo de split payment de Mercado Pago.

Justificación del 15%:

- Es lo suficientemente alto para sostener los costos operativos y construir margen, y lo suficientemente bajo para mantener la propuesta de valor frente a la logística formal (Correo Argentino, Andreani, OCA), notoriamente más cara.
- Alinea los incentivos: la plataforma solo gana cuando el usuario completa exitosamente un envío. No hay suscripciones fijas ni publicidad.

El modelo no depende de ingresos recurrentes por suscripción ni de monetización por publicidad, lo que mantiene la alineación de incentivos entre Movo y sus usuarios.

## Flujo de Fondos por Transacción

El circuito de dinero aprovecha el modelo Marketplace de Mercado Pago, lo que tiene una implicancia fiscal central: Movo solo procesa en sus cuentas el porcentaje de comisión, nunca el monto total del envío. Esto evita que Movo sea considerado perceptor del total y, por lo tanto, evita la retención de Ingresos Brutos (IIBB) sobre montos que no constituyen ingreso propio.

**Circuito en modalidad de pago digital (Auth & Capture + Split):**

1. El emisor confirma al transportista → se ejecuta una autorización (*hold*) sobre la tarjeta del emisor por el monto total acordado. Los fondos quedan reservados, no debitados.
2. El transportista entrega y se completa el Cryptographic Handshake → se ejecuta la captura y el split payment en un único evento.
3. El split distribuye automáticamente: 15% a la cuenta de Movo (comisión) y 85% a la cuenta del transportista (pago neto).
4. Si el envío se cancela antes del retiro → se cancela la autorización y se liberan los fondos del emisor sin cargo.

**Circuito en modalidad de pago en efectivo:**

1. El receptor paga al transportista en efectivo al momento de la entrega.
2. Al completarse el handshake, Movo debita automáticamente su comisión (15%) de la tarjeta precargada del transportista (obligatoria para operar en efectivo).

| Concepto | Monto |
|---|--:|
| Valor del envío (paga el emisor) | USD 10,00 |
| Comisión Movo (15%) | USD 1,50 |
| Pago neto al transportista (85%) | USD 8,50 |
| Ingreso que procesa Movo | USD 1,50 |

: Ejemplo numérico de un envío de USD 10.

::: nota
**Nota de compilación.** La implementación final mantiene la comisión del 15% (`MOVO_COMMISSION_RATE=0.15`). Los Términos y Condiciones v0.2 precisan que la comisión se calcula sobre el neto que acredita Mercado Pago después de su propio costo de procesamiento (`MP_TRANSACTION_FEE_RATE`), como se detalla en el Informe del Sprint 7.
:::

## Flujo de Fondos Básico (proyección de equilibrio)

Dado que el ingreso de Movo es la comisión y el costo operativo fijo es bajo (~40 a 90 USD/mes en etapa inicial), el punto de equilibrio operativo se alcanza con un volumen modesto de transacciones.

| Concepto | Valor |
|---|--:|
| Ingreso por envío (15% sobre USD 8) | USD 1,20 |
| Costo operativo fijo mensual (escenario medio) | USD 65 |
| Envíos por mes para cubrir el costo fijo | ~54 envíos |

: Punto de equilibrio (ticket promedio de USD 8).

Con aproximadamente 54 envíos completados al mes (menos de 2 por día), la plataforma cubre su costo operativo fijo en la etapa inicial. A partir de ahí, cada envío adicional genera margen positivo, descontando únicamente el costo variable marginal (KYC solo en el primer envío de un usuario nuevo; Maps cubierto por el crédito gratuito).

| Ticket promedio | Ingreso por envío (15%) | Envíos/mes para el equilibrio (costo fijo USD 65) |
|---|--:|--:|
| USD 5 | 0,75 | ~87 |
| USD 8 | 1,20 | ~54 |
| USD 12 | 1,80 | ~36 |

: Sensibilidad del punto de equilibrio según el ticket promedio.
