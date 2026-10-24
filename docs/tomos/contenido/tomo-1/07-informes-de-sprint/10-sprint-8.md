# Sprint 8

<table class="clave-valor compacta"><tbody>
<tr><th>Período</th><td>19/10/2026 al 01/11/2026</td></tr>
<tr><th>Ciclo en Linear</th><td>Cycle 9</td></tr>
<tr><th>Estado del informe</th><td>Sprint en curso al momento de compilar este tomo (export de Linear del 24/10/2026)</td></tr>
<tr><th>Foco del sprint</th><td>Panel de administración (usuarios, sanciones, soporte y envíos), disputas, atribución del no-retiro, cierre del circuito de pagos y documentación legal.</td></tr>
</tbody></table>

::: pendiente
El Informe del Sprint 8 se redacta al cierre del ciclo (1 de noviembre de 2026), con el mismo formato que los informes anteriores. Lo que sigue es el **estado del Sprint Backlog al 24/10/2026**, tomado del export de Linear; el objetivo del sprint, la Sprint Review, las métricas con su análisis de tendencia, la retrospectiva, el Product Backlog repriorizado y el registro de riesgos se completan al cierre. Si el equipo decide realizar un Sprint 9, se agregará su informe a continuación.
:::

## Sprint Backlog al 24/10/2026

El ciclo contiene 41 issues; a la fecha del export, 28 están en *Done* (82 de 102 SP estimados).

| ID | Historia / Tarea | Responsable | SP | Estado a la fecha |
|---|---|---|--:|---|
| MOVO-12 | Como emisor, quiero que mis fondos se reserven automáticamente antes del retiro del paquete, para que el pago solo se ejecute cuando el paquete sea entregado. | Sin asignar | – | Done |
| MOVO-13 | Como transportista, quiero recibir el pago automático con split payment tras confirmarse la entrega, para cobrar inmediatamente después de entregar sin gestiones adicionales. | Sin asignar | – | Done |
| MOVO-33 | Como administrador, quiero consultar los envíos de la plataforma con su estado y el detalle de cada uno, para monitorear la operación y detectar incidentes. | Sin asignar | – | Done |
| MOVO-36 | Como administrador, quiero suspender o inhabilitar una cuenta de usuario ante comportamiento fraudulento o violación de términos, para proteger la integridad de la red. | T. Vergara | – | En curso |
| MOVO-37 | Como emisor, quiero declarar que voy a pagar la comisión de Movo en efectivo al momento de la entrega, para poder pagar sin una tarjeta de crédito. | Sin asignar | – | Por hacer |
| MOVO-168 | [movo-mobile] Estados de carga granulares y skeletons por componente en vistas principales | P. Yorlano | – | Done |
| MOVO-169 | [movo-mobile] Tutorial interactivo de uso paso a paso con pop-ups guiados | P. Yorlano | 5 | Done |
| MOVO-213 | [svc-payments] Reintentos del split y escalado a proceso manual ante fallo persistente | J.C. Bordino B. | 5 | Done |
| MOVO-215 | [Spike] Plazo real de la reserva (hold) de MP y valor de N | A. Ariza | 5 | Done |
| MOVO-226 | Definir e implementar la mecánica de penalidad de cancelación con Transportista asignado (holds/liberación de pagos) | Sin asignar | – | En curso |
| MOVO-228 | Checkbox obligatorio de aceptación legal en el registro + "firma electrónica" en Perfil → Legal | Sin asignar | – | En revisión |
| MOVO-230 | Job automático de purga/anonimización de datos vencidos (Política de Privacidad §7) | P. Yorlano | 2 | Done |
| MOVO-240 | Notificaciones: catálogo de notificaciones faltantes | Sin asignar | – | Por hacer |
| MOVO-270 | [svc-shipments] Tracking GPS antes del retiro y atribución de responsabilidad del no-retiro; revisar conteo de oferta de ADR-025 | P. Yorlano | 8 | Done |
| MOVO-285 | svc-payments/movo-mobile: persistir el fee real de Mercado Pago y mostrar el monto cobrado exacto | L. Dalmagro | 3 | Done |
| MOVO-293 | Como administrador, quiero buscar un usuario y ver su ficha completa, para entender su actividad antes de tomar una decisión sobre su cuenta | Sin asignar | – | Done |
| MOVO-294 | [svc-admin][svc-users][svc-shipments][svc-payments] Búsqueda de usuarios y ficha: endpoints de admin e internos | A. Ariza | – | Done |
| MOVO-295 | [movo-admin] Pantallas de búsqueda de usuarios y ficha | T. Vergara | – | Done |
| MOVO-296 | [svc-users][shared] Sanciones de cuenta: suspensión e inhabilitación, historial, marca en Redis y vencimiento automático | L. Dalmagro | 3 | Done |
| MOVO-297 | [svc-shipments] Efectos de una sanción: retirar lo no comprometido, avisar a contrapartes y listar envíos en curso | L. Dalmagro | 3 | Done |
| MOVO-298 | [gateway] Aplicar suspensión e inhabilitación en cada request a partir de la marca en Redis | L. Dalmagro | 2 | Done |
| MOVO-299 | [svc-admin][movo-admin] Suspender, inhabilitar y levantar sanciones desde la ficha del usuario | A. Ariza | – | En curso |
| MOVO-300 | [movo-mobile] Experiencia de una cuenta suspendida o inhabilitada y estado en el perfil público | P. Yorlano | 3 | Done |
| MOVO-316 | [docs] Términos y Condiciones: penalidades de cancelación y cuenta corriente del usuario | T. Vergara | – | En curso |
| MOVO-317 | [movo-mobile][svc-shipments][svc-pricing] Peso y dimensiones libres en publicar envío: wizard, sin límites duros y recalibración de precio | L. Dalmagro | 3 | En curso |
| MOVO-318 | Mobile: el sheet de cancelación debe usar el monto real del hold como "reservado" | P. Yorlano | – | Por hacer |
| MOVO-320 | [svc-shipments] Conversaciones de soporte: modelo, API del usuario, tiempo real sobre el chat existente y ADR | J.C. Bordino B. | 2 | Done |
| MOVO-321 | [svc-shipments] Adjuntos de imágenes en los mensajes de soporte (S3 con presigned URLs) | A. Ariza | 3 | Done |
| MOVO-322 | [svc-admin][svc-shipments] API de la bandeja de soporte para agentes (rol ADMIN): asignar, priorizar, etiquetar, vincular, resolver, notas y contexto del usuario | A. Ariza | 5 | En curso |
| MOVO-323 | [movo-admin] Bandeja de soporte (prototipo "Movo Admin Soporte"): lista, conversación y panel de contexto del usuario | T. Vergara | 5 | Done |
| MOVO-324 | [movo-mobile] Ayuda y soporte: nueva consulta (con o sin envío), mis consultas y conversación con el equipo de Movo | T. Vergara | 5 | Done |
| MOVO-325 | [svc-shipments][svc-admin] Envíos para el panel: listado con filtros, detalle completo y chat en solo lectura | L. Dalmagro | 5 | Done |
| MOVO-326 | [movo-admin] Listado y detalle de envíos (prototipo "Movo Admin Envíos"): pestañas, tabla, línea de tiempo y chat en solo lectura | A. Ariza | 5 | Done |
| MOVO-327 | [svc-shipments][svc-admin] Seguimiento de un envío en camino para el panel: última posición, traza y métricas | P. Yorlano | 3 | Done |
| MOVO-328 | [movo-admin] Mapa de seguimiento del envío en el detalle: ruta recorrida, posición del transportista y métricas | T. Vergara | 2 | Done |
| MOVO-330 | [docs] ADR: cambio forzado de estado de un envío — matriz de transiciones, riesgos, efectos y bloqueos | J.C. Bordino B. | 2 | Por hacer |
| MOVO-331 | [svc-shipments] Transición forzada de estado: endpoint interno que ejecuta los servicios de dominio, registra el evento y avisa a las partes | J.C. Bordino B. | 5 | Done |
| MOVO-332 | [svc-admin][svc-users] Cambio de estado desde el panel: ruta /admin, re-autenticación con OTP por acción, conflicto de interés y bitácora | L. Dalmagro | 5 | Por hacer |
| MOVO-333 | [movo-admin] Modal de cambio de estado del envío (prototipo "Movo Admin Envíos"): elegir, ver impacto y confirmar | J.C. Bordino B. | 5 | Por hacer |
| MOVO-334 | [svc-shipments] Disputas: entidad, apertura, descargos, notificaciones y bloqueo del transportista | P. Yorlano | – | Done |
| MOVO-340 | [Bugs] Paquete de fixes #3: teclado con pantalla externa, hora sin unidades, doble redirect, búsqueda sin tildes, chat tras transferencia, fecha por defecto, cancelación del mismo día y búsqueda por coordenadas | P. Yorlano | 8 | Done |

: Sprint Backlog del Cycle 9 (estado al 24/10/2026).
