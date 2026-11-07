## Sprint 8

<table class="clave-valor compacta"><tbody>
<tr><th>Período</th><td>19/10/2026 al 01/11/2026</td></tr>
<tr><th>Ciclo en Linear</th><td>Cycle 9</td></tr>
<tr><th>Autor del informe</th><td>Ariza, Alena</td></tr>
<tr><th>Foco del sprint</th><td>Panel de administración (usuarios, sanciones, envíos, disputas, soporte y reportes), cierre del circuito de pagos y primera prueba de flujo completo con dispositivos reales.</td></tr>
</tbody></table>

### Objetivo del Sprint 8

Cerrar lo pendiente del frente de Pagos que quedó del Sprint 7 (reintentos del split, plazo real del hold y pago en efectivo) y construir el panel de administración sobre la base que dejó MOVO-286: búsqueda y ficha de usuarios, sanciones de cuenta, consulta de envíos, corrección forzada de estado, resolución de disputas y soporte desde la app. Ese era el orden de prioridad del Product Backlog repriorizado del Sprint 7, junto con los Términos y Condiciones de penalidades (MOVO-316) y la prueba con dinero real (MOVO-283).

El objetivo se cumplió en lo funcional. Se cerraron ocho historias de usuario: MOVO-12 y MOVO-13 (reserva de fondos y split, con sus pendientes), MOVO-37 (pago en efectivo), MOVO-293 (búsqueda y ficha), MOVO-36 (sanciones), MOVO-33 (envíos para el panel), MOVO-329 (cambio forzado de estado), MOVO-34 (disputas) y MOVO-319 (soporte). Además, el 25/10 se hizo la primera prueba de flujo completo con dispositivos reales contra dev, y sus hallazgos se corrigieron dentro del ciclo (MOVO-346). Quedaron fuera los Términos y Condiciones de penalidades (MOVO-316, en curso) y el catálogo de notificaciones (MOVO-240), que pasaron al Cycle 10, y la prueba con dinero real, que no se cargó al ciclo.


### Sprint Backlog y capacidad del equipo asumida

El Cycle 9 de Linear cerró con 48 issues y 160 SP de scope, todos en Done: 40 issues estimados (152 SP por suma de estimaciones) y ocho historias de usuario padre sin estimación propia. No hubo cancelaciones. Dos issues planificados sin estimación (MOVO-316 y MOVO-240), junto con la historia padre MOVO-226, no se terminaron y pasaron al Cycle 10, así que salieron del conteo del ciclo.

A diferencia del Sprint 7, la carga se hizo en el Planning: el ciclo arrancó el 19/10 con 38 issues (99 SP), y ese mismo día se crearon 16 de los issues estimados (61 SP), con los frentes del panel completos y responsables asignados. Después del Planning se crearon siete issues (33 SP).

| **Tipo** | **Issues** | **Story Points** | **Done (issues / SP)** | **Cancelados (issues / SP)** |
|---|---|---|---|---|
| Tarea | 32 | 114 | 32 / 114 | 0 / 0 |
| Bug | 2 | 16 | 2 / 16 | 0 / 0 |
| Spike | 1 | 5 | 1 / 5 | 0 / 0 |
| Improvement | 1 | 5 | 1 / 5 | 0 / 0 |
| US con estimación (MOVO-37) | 1 | 5 | 1 / 5 | 0 / 0 |
| Pago sin tipo (MOVO-285) | 1 | 3 | 1 / 3 | 0 / 0 |
| Sin label (MOVO-168, 230) | 2 | 4 | 2 / 4 | 0 / 0 |
| US padre sin estimación | 8 | — | 8 / — | 0 / 0 |
| **Total** | **48** | **152** | **48 / 152** | **0 / 0** |

Linear informa 160 SP completados; la suma de estimaciones por issue da 152 SP. La diferencia de 8 SP no se pudo atribuir a ningún issue del listado actual, como en los dos sprints anteriores. Del total, 25 issues (86 SP, 57%) llevan el label "Admin" y 6 (22 SP) el label "Pago".


#### Capacidad del equipo asumida

El Plan de Proyecto define la capacidad en horas (5 personas × 5 hs/semana), sin conversión documentada a Story Points. La referencia histórica de velocity suma un séptimo punto: 95 SP (Cycle 3), 121 SP (Cycle 4), 106 SP (Cycle 5), 80 SP (Cycle 6), 135 SP (Cycle 7), 150 SP (Cycle 8) y 160 SP (Cycle 9), el valor más alto de la serie.


#### Sprint Backlog estimado (Cycle 9)

| ID | Historia o tarea | SP | Estado |
|---|---|---:|---|
| MOVO-213 | [svc-payments] Reintentos del split y escalado a proceso manual ante fallo persistente | 5 | Done |
| MOVO-215 | [Spike] Plazo real de la reserva (hold) de MP y valor de N | 5 | Done |
| MOVO-285 | svc-payments/movo-mobile: persistir el fee real de Mercado Pago y mostrar el monto… | 3 | Done |
| MOVO-318 | Mobile: el sheet de cancelación debe usar el monto real del hold como "reservado" | 1 | Done |
| MOVO-37 | Como emisor, quiero pagarle el envío en efectivo al transportista al momento del retiro | 5 | Done |
| MOVO-294 | [svc-admin][svc-users][svc-shipments][svc-payments] Búsqueda de usuarios y ficha:… | 2 | Done |
| MOVO-295 | [movo-admin] Pantallas de búsqueda de usuarios y ficha | 3 | Done |
| MOVO-296 | [svc-users][shared] Sanciones de cuenta: suspensión e inhabilitación, historial, marca en… | 3 | Done |
| MOVO-297 | [svc-shipments] Efectos de una sanción: retirar lo no comprometido, avisar a contrapartes… | 3 | Done |
| MOVO-298 | [gateway] Aplicar suspensión e inhabilitación en cada request a partir de la marca en… | 2 | Done |
| MOVO-299 | [svc-admin][movo-admin] Suspender, inhabilitar y levantar sanciones desde la ficha del… | 3 | Done |
| MOVO-300 | [movo-mobile] Experiencia de una cuenta suspendida o inhabilitada y estado en el perfil… | 3 | Done |
| MOVO-325 | [svc-shipments][svc-admin] Envíos para el panel: listado con filtros, detalle completo y… | 5 | Done |
| MOVO-326 | [movo-admin] Listado y detalle de envíos: pestañas, tabla, línea de tiempo y chat en solo… | 5 | Done |
| MOVO-327 | [svc-shipments][svc-admin] Seguimiento de un envío en camino para el panel: última… | 3 | Done |
| MOVO-328 | [movo-admin] Mapa de seguimiento del envío en el detalle: ruta recorrida, posición del… | 2 | Done |
| MOVO-331 | [svc-shipments] Transición forzada de estado: endpoint interno que ejecuta los servicios… | 5 | Done |
| MOVO-332 | [svc-admin][svc-users] Cambio de estado desde el panel: re-autenticación con OTP por… | 5 | Done |
| MOVO-333 | [movo-admin] Modal de cambio de estado del envío: elegir, ver impacto y confirmar | 5 | Done |
| MOVO-334 | [svc-shipments] Disputas: entidad, apertura, descargos, notificaciones y bloqueo del… | 3 | Done |
| MOVO-336 | [svc-payments] Reembolsos total y parcial de un pago capturado, con fallback a la cuenta… | 3 | Done |
| MOVO-337 | [svc-admin][svc-shipments] Resolución de disputas: matriz de resolución, estado final del… | 3 | Done |
| MOVO-341 | [svc-admin][svc-shipments][@movo/shared] Lectura de disputas para el panel: listado,… | 3 | Done |
| MOVO-338 | [movo-admin] Bandeja de disputas, expediente y pantalla de resolución | 2 | Done |
| MOVO-343 | [movo-admin] Bandeja y expediente de disputas (solo lectura), notas internas y entradas… | 3 | Done |
| MOVO-320 | [svc-shipments] Conversaciones de soporte: modelo, API del usuario, tiempo real sobre el… | 2 | Done |
| MOVO-321 | [svc-shipments] Adjuntos de imágenes en los mensajes de soporte (S3 con presigned URLs) | 3 | Done |
| MOVO-322 | [svc-admin][svc-shipments] API de la bandeja de soporte para agentes: asignar, priorizar,… | 5 | Done |
| MOVO-323 | [movo-admin] Bandeja de soporte: lista, conversación y panel de contexto del usuario | 5 | Done |
| MOVO-324 | [movo-mobile] Ayuda y soporte: nueva consulta, mis consultas y conversación con el equipo… | 5 | Done |
| MOVO-342 | [svc-admin][svc-shipments][@movo/shared] Base de reportes: rango de fechas, helper de… | 3 | Done |
| MOVO-344 | [svc-admin][svc-shipments] Reporte de disputas: agregados, series temporales y CSV | 3 | Done |
| MOVO-345 | [movo-admin] Pantalla de bitácora, home con resumen operativo y reporte de disputas | 5 | Done |
| MOVO-270 | [svc-shipments] Tracking GPS antes del retiro y atribución de responsabilidad del… | 8 | Done |
| MOVO-317 | [movo-mobile][svc-shipments][svc-pricing] Peso y dimensiones libres en publicar envío:… | 3 | Done |
| MOVO-168 | [movo-mobile] Estados de carga granulares y skeletons por componente en vistas principales | 2 | Done |
| MOVO-169 | [movo-mobile] Tutorial interactivo de uso paso a paso con pop-ups guiados | 5 | Done |
| MOVO-230 | Job automático de purga/anonimización de datos vencidos (Política de Privacidad §7) | 2 | Done |
| MOVO-340 | [Bugs] Paquete de fixes #3: teclado, hora sin unidades, doble redirect, búsqueda sin… | 8 | Done |
| MOVO-346 | Hallazgos de la primera prueba de flujo completo (25/10/2026) | 8 | Done |


Historias de usuario padre cerradas en el ciclo (sin SP propios): MOVO-12, MOVO-13, MOVO-33, MOVO-34, MOVO-36, MOVO-293, MOVO-319 y MOVO-329. MOVO-334 (disputas: entidad y apertura) se cerró, pero su historia padre, MOVO-30, sigue en Backlog. MOVO-226 (penalidades) sigue In Progress hasta que se cierre MOVO-316.


### Resultado de la Sprint Review

La Sprint Review se realiza siempre, con los 5 desarrolladores presentes, como una reflexión interna del equipo sobre qué se logró en el sprint. Los docentes no participan de esa instancia y no dan feedback en ese momento — el feedback de la cátedra llega por otros canales de la materia. No se lleva un registro escrito (acta) de esta reunión; lo que sigue es un resumen de lo demostrable al cierre del sprint, no una transcripción de la reunión.

Con lo completado, el sprint deja en condiciones de demostrarse (pagos en sandbox de Mercado Pago, el resto en dev):

- **Pagos.** Si la captura y el split fallan, svc-payments reintenta tres veces (a los 5 min, 30 min y 2 h) y, si sigue fallando, escala la liquidación a proceso manual con una alerta al equipo y un aviso al transportista (MOVO-213, cierra MOVO-13). El spike del plazo del hold fijó 5 días de validez y N = 3 días para pedir el pago antes del retiro (MOVO-215, cierra MOVO-12). Se guarda el fee real de Mercado Pago y la app muestra el monto cobrado exacto (MOVO-285, 318), y el emisor puede pagarle el envío en efectivo al transportista en el retiro, con la comisión de Movo registrada como deuda del transportista (MOVO-37).
- **Usuarios y sanciones en el panel.** El administrador busca un usuario, ve su ficha completa (MOVO-294, 295, cierra MOVO-293) y lo suspende, inhabilita o levanta la sanción desde ahí. La sanción se aplica en cada request desde el gateway, retira lo que el usuario no tenía comprometido, avisa a las contrapartes y vence sola; la app le muestra al usuario sancionado su estado (MOVO-296 a 300, cierra MOVO-36).
- **Envíos en el panel.** Listado con filtros, detalle con línea de tiempo, chat en solo lectura y mapa con la ruta recorrida y la posición del transportista (MOVO-325 a 328, cierra MOVO-33). Para envíos trabados, el administrador puede forzar un cambio de estado: elige el destino, ve el impacto y confirma con un OTP por acción; el cambio pasa por los servicios de dominio, queda en la bitácora y se avisa a las partes (MOVO-331 a 333, cierra MOVO-329).
- **Disputas.** Una parte abre la disputa, la otra presenta su descargo y el transportista queda bloqueado mientras siga abierta (MOVO-334). El administrador la gestiona desde una bandeja con expediente y notas internas, y la resuelve a favor del emisor, del transportista o de forma parcial, con reembolso total o parcial del pago capturado y desbloqueo del transportista (MOVO-336, 337, 338, 341, 343, cierra MOVO-34).
- **Soporte.** El usuario escribe al equipo de Movo desde la app, con o sin un envío asociado y con fotos adjuntas, y recibe las respuestas en tiempo real; los administradores atienden desde una bandeja con el contexto del usuario (MOVO-320 a 324, cierra MOVO-319).
- **Reportes.** Home del panel con resumen operativo, pantalla de bitácora con exportación a CSV y reporte de disputas con series temporales (MOVO-342, 344, 345). Las siete pestañas de métricas del panel (cashflow, precio y volumen, entregas, transportistas, distancias, soporte y disputas) estaban armadas contra datos de prueba al cierre del sprint; sus endpoints y la pantalla se integraron a `develop` el 04/11 (MOVO-344 y MOVO-345; las reglas de cada métrica están en la DD-059, propuesta en el repositorio).
- **Operación del envío.** Seguimiento GPS antes del retiro y atribución de responsabilidad cuando el paquete no se retira: si el transportista llegó y no hubo handshake, se abre una disputa en vez de culpar a una de las partes (MOVO-270). Peso y dimensiones libres al publicar, sin los límites duros del Sprint 7 y con el precio recalibrado (MOVO-317).
- **Otros.** Tutorial interactivo de primer uso (MOVO-169), estados de carga por componente (MOVO-168), job de purga y anonimización de datos vencidos según la Política de Privacidad (MOVO-230) y el paquete de fixes #3 (MOVO-340).

**Todavía no demostrable de punta a punta:** cualquier cobro con dinero real (MOVO-283 sigue en Todo y quedó en el Cycle 8, ya cerrado), el vencimiento real de un hold (el sandbox no lo simula: los dos holds de prueba siguieron autorizados más de 188 h), los Términos y Condiciones con penalidades y cuenta corriente (MOVO-316), la verificación de las métricas de oferta y demanda por ruta (MOVO-35, cuyo backend y pantallas entraron a `develop` el 04/11) y la revisión de casos de KYC desde el panel (MOVO-32).


#### Nota: Primera prueba de flujo completo con dispositivos reales (25/10)

El 25/10 el equipo hizo la primera prueba de punta a punta contra el entorno de dev, con dispositivos reales: un envío creado, ofertado, pagado, retirado y entregado con QR. La prueba dejó 18 hallazgos, cada uno investigado con evidencia de base de datos, logs y Redis, y documentados en docs/pruebas/ del repositorio junto con una referencia del flujo esperado para repetir la comparación (MOVO-346). El crítico fue que la app cerraba la sesión del transportista a mitad del viaje y el tracking se cortaba 26 minutos, porque el token nuevo no se podía guardar con el teléfono bloqueado. También aparecieron una llegada estimada corrida 3 horas, un timeout casi permanente del optimizador de rutas y una caída del sandbox de Mercado Pago que revirtió la asignación. Todo lo que dependía del código se corrigió en dos PRs (#322 de backend y #324 de frontend). Quedan pendientes, fuera del código, la configuración del WebSocket de soporte en Secrets Manager, la limpieza de envíos de pruebas anteriores en la base de dev y el paso de DD-057 al registro de decisiones de diseño.


### Métricas y análisis de tendencia

| **Métrica** | **Sprint 5 (Cycle 6)** | **Sprint 6 (Cycle 7)** | **Sprint 7 (Cycle 8)** | **Sprint 8 (Cycle 9)** |
|---|---|---|---|---|
| **Velocity (SP completados)** | 80 SP (Linear) / 80 SP por issue | 135 SP (Linear) / 128 SP por issue (118 sin registros de horas) | 150 SP (Linear) / 144 SP por issue | **160 SP (Linear) / 152 SP por issue** |
| **Scope al inicio del sprint** | 35 SP (15 issues) | 64 SP (28 issues) | 11 SP (6 issues) el 5/10; 54 SP (30 issues) tras la carga del 7/10 | 99 SP (38 issues) el 19/10, día del Planning |
| **Scope al cierre del sprint** | 118 SP (+237%) · 43 issues | 135 SP (+111%) · 48 issues | 150 SP (+178% sobre 54 SP) · 59 issues | 160 SP (+62%) · 48 issues |
| **Sprint Goal Achievement** | 68% en SP · 74% en issues | 100% (48/48) | 100% del scope final en SP e issues (59/59); 6 US padre cerradas | **100%** del scope final (48/48); 8 US padre cerradas; MOVO-316 y 240, sin estimación, pasan al Cycle 10 |
| **Cycle Time (mediana / promedio)** | ≈1.0 / ≈1.0 día | ≈0.95 / ≈1.55 días | ≈0.8 / ≈1.4 días (53 issues) | ≈0.6 / ≈1.4 días (40 issues) |
| **Defect Rate (label "Bug")** | 0 por label; 2 corregidos inline | 3 + 1 batch sin label | 2 (MOVO-277, 278) + 1 corregido inline en MOVO-307 | 2 paquetes de fixes (MOVO-340 y 346, 16 SP); 1 bug sumado dentro de MOVO-340 |
| **PRs mergeados en GitHub** | No relevado | No relevado | No relevado; citados en Linear: #219, #250, #265 | No relevado; citados en Linear: #291, #322, #324 |
| **Suite de tests automatizados** | svc-shipments 756/756 | svc-shipments 1118, cobertura 92% | Sin número consolidado; tests de sandbox contra Mercado Pago real en verde | Sin número consolidado en los tickets; la corrida completa sobre develop del 04/11 dio 8.518 casos aprobados y 33 omitidos (ver el Plan de Testing); en MOVO-346 pasan pytest, ruff, mypy, tsc, lint y unitarios; los de integración corren en el CI del PR |


#### Análisis

**Velocity y Sprint Goal Achievement.** El sprint cerró con 160 SP según Linear (152 por suma de estimaciones), la velocity más alta de la serie por tercer sprint consecutivo: +7% respecto del Sprint 7. No quedó ningún issue estimado abierto. El 100% se calcula sobre el scope final: MOVO-316 y MOVO-240 estaban cargados desde el inicio, no tenían estimación y pasaron al Cycle 10, así que no se ven en el porcentaje.

**Scope.** El scope creció de 99 SP a 160 SP (+62%), mucho menos que el +178% del Sprint 7. De los siete issues creados después del Planning (33 SP), dos son paquetes de bugs (MOVO-340 y 346, 16 SP) y dos derivan de una historia en curso (MOVO-341 y 343, disputas), lo que el action item del Sprint 7 permitía. Los otros tres (MOVO-342, 344 y 345, 11 SP) son un frente nuevo de reportes, creado el 25/10 sin historia padre. El resto del crecimiento corresponde a issues del backlog que se sumaron al ciclo y a la diferencia de 8 SP entre Linear y la suma por issue.

**Cycle Time.** La mediana bajó a 0,6 días y el promedio quedó en 1,4. El valor más alto es MOVO-215 (10,3 días), un spike que empezó en el Cycle 8 y tuvo que esperar a que pasaran los días de vigencia del hold. Le siguen MOVO-338 y 343 (5,6 días), las pantallas de disputas, que esperaron al backend de resolución. El cierre volvió a concentrarse: el pico fue el 24/10 (11 issues, 45 SP); entre el 26 y el 31/10, semana de parciales, se cerraron solo tres issues (11 SP), y el último día se cerraron seis (24 SP).

**Defect Rate.** Dos issues con label "Bug" (16 SP), los dos como paquetes. MOVO-340 juntó ocho correcciones de uso (teclado, hora sin unidades, búsqueda sin tildes, chat después de transferir el receptor, entre otras) y sumó un bug de registro: los nombres compuestos se cortaban en el primer espacio. MOVO-346 reúne los 18 hallazgos de la prueba de flujo completo, de los que unos diez son bugs; el resto son decisiones de diseño, infraestructura y mejoras de UX. El número de issues con label ya no representa la cantidad de defectos: conviene contar los puntos de cada paquete.

**Tests.** La única corrida informada en los comentarios de cierre es la del backend de MOVO-346: pasan pytest, ruff y mypy en pricing, y tsc, lint y los tests unitarios en svc-shipments y svc-payments. Los tests de integración nuevos no se corrieron en local y quedaron para el CI del PR, y el template de nginx no se validó con nginx -t. Los reintentos de MOVO-213 ante un hold vencido se probaron con un test sintético, porque el sandbox no vence holds. Los tickets no traen un número de suite comparable con sprints anteriores; el número consolidado del cierre surge de la corrida completa del 04/11 sobre develop (8.518 casos aprobados, ninguno fallido y 33 omitidos), descripta en el Plan de Testing.

**Distribución de la carga.** La diferencia entre el máximo y el mínimo subió a 26 SP (22 en el Sprint 7). Pedro Yorlano concentró el 32% del scope, la mitad en los dos paquetes de bugs y en el tracking antes del retiro (MOVO-270, 8 SP). El panel de administración, que sumó 97 SP entre usuarios, envíos, disputas, soporte y reportes, quedó repartido entre los cinco integrantes.

| **Integrante** | **SP completados** | **SP cancelados** | **SP totales del ciclo** |
|---|---|---|---|
| Ariza, Alena | 29 | 0 | 29 |
| Bordino Blanche, Juan Cruz | 22 | 0 | 22 |
| Dalmagro, Lucas | 28 | 0 | 28 |
| Yorlano, Pedro | 48 | 0 | 48 (32% del scope) |
| Vergara, Tomás Ignacio | 25 | 0 | 25 |
| **Total** | **152** | **0** | **152** |


### Retrospectiva


#### Estado de los action items del sprint anterior

| **Acción (Sprint 7)** | **Responsable** | **Estado** |
|---|---|---|
| Actualizar los ADRs en el doc de Sprint 0 y revisar su numeración | Alena Ariza | **CUMPLIDO** — el 24/10 se reorganizó el registro: Sprint 0 quedó con los ADR 001 a 023, alineados con docs/adr del repositorio, y las decisiones de alcance acotado pasaron como DD- al nuevo [Movo] 011-Registro de Decisiones de Diseño. Después se sumaron los ADR 024 y 025 y, el 02/11, las DD-056 a DD-058, de modo que el registro quedó con 25 ADR y las DD-016 a DD-058. |
| Abrir un ticket de verificación en dispositivo y entorno real (pago con tarjeta en dev build, webhook por túnel, deep-links, mapa en Android y handshake entre dos dispositivos) | Juan Cruz Bordino Blanche; Tomás Vergara; Pedro Yorlano; Alena Ariza | **PARCIAL** (límite 28/10) — no se abrió el ticket, pero la prueba de flujo completo del 25/10 cubrió con dispositivos reales el pago, el handshake por QR y el tracking. Deep-links, mapa en Android, rechazos de tarjeta y webhook real siguen sin registro. |
| Planificar en el Planning cualquier frente nuevo; a mitad de ciclo solo entran bugs y derivados directos | Todo el equipo | **PARCIAL** — el panel completo se cargó en el Planning del 19/10. Entró a mitad de ciclo un solo frente nuevo, el de reportes (MOVO-342, 344, 345; 11 SP), sin historia padre. |
| Registrar con label "Bug" los defectos corregidos dentro de otro ticket | Todo el equipo | **CUMPLIDO** — los dos paquetes de correcciones llevan label "Bug". El bug de nombres compuestos se corrigió dentro de MOVO-340, que ya es un paquete de bugs, y quedó documentado en su comentario de cierre. |


#### Insights

**Qué funcionó bien**

- El panel de administración pasó de la base del Sprint 7 a seis historias cerradas en un solo ciclo, cargado completo en el Planning y repartido entre los cinco integrantes.
- La primera prueba de flujo completo con dispositivos reales encontró problemas que las pruebas locales no mostraban, entre ellos el bloqueante del cierre de sesión. Cada hallazgo se investigó con evidencia y se corrigió dentro del mismo ciclo.
- Los contratos entre mobile, panel y backend se acordaron en Linear antes de construir (soporte en MOVO-320 y 324, métricas en MOVO-344 y 345), y el frontend avanzó contra mocks sin bloquear al backend.
- El registro de decisiones quedó ordenado: ADRs de arquitectura en Sprint 0 y decisiones acotadas en un registro propio, con la numeración vieja conservada para no romper referencias.
- Los comentarios de cierre siguen documentando decisiones que no salen del diff, desvíos y pendientes (MOVO-213, 215, 270, 331, 337, 340, 346).

**Qué no funcionó / puntos a mejorar**

- El cierre se concentró de nuevo: por los parciales, entre el 26 y el 31/10 se cerraron solo tres issues y el último día seis. Conviene tener en cuenta las fechas de parciales en el Planning.
- La numeración de decisiones sigue chocando en el repositorio: MOVO-270, 320 y 331 tuvieron que cambiar el número de su ADR porque ya estaba usado en develop.
- Lo que queda fuera del código no se cierra junto con el ticket: los pendientes de configuración y datos de MOVO-346, las DD-056 y DD-057, que llegaron al registro recién el 02/11, ya con el sprint cerrado, y MOVO-283 olvidado en un ciclo ya cerrado.

**Qué aprendimos**

- Una prueba de punta a punta con dispositivos reales vale más que varias verificaciones sueltas: en un día encontró 18 problemas, y conviene repetirla después de cada frente grande.
- Un sandbox no reproduce todo lo que pasa en producción: Mercado Pago nunca venció un hold, así que el plazo de diseño quedó en el mínimo documentado y el vencimiento real se sigue suponiendo.
- Trabajar contra mocks funciona si el contrato vive en un solo lugar: en soporte hubo que corregir nombres de tipos y agregar una ruta, pero como el contrato estaba en @movo/shared el ajuste se hizo antes del merge.

#### Action items


Responsables y fechas propuestos a partir de este relevamiento; se confirman en la retro del equipo.

| **Acción** | **Responsable** | **Fecha límite** |
|---|---|---|
| Reservar el número de cada decisión de diseño en el Registro de Decisiones de Diseño antes de crear su archivo en el repositorio, para que la numeración no vuelva a chocar (DD-056, DD-057 y DD-058 ya están registradas desde el 02/11) | Todo el equipo | 08/11/2026 |
| Cerrar los pendientes fuera del código de MOVO-346: variables SUPPORT_WS_* en Secrets Manager, limpieza de los envíos de prueba en dev y checklist post-merge de #322 (nginx con 429, polyline y hora con offset, logs antes del deploy) | Pedro Yorlano | 06/11/2026 |
| Repetir la prueba de flujo completo con dispositivos reales después de los fixes, sumando deep-links, mapa en Android, rechazos de tarjeta y la notificación real del webhook | Todo el equipo | 13/11/2026 |
| Darle historia padre al frente de reportes (vincular MOVO-342, 344 y 345 a MOVO-35 o abrir una US) y mover MOVO-283 a un ciclo activo | Alena Ariza | Planning del Sprint 9 |


### Product Backlog repriorizado

Con el panel de administración funcionando, lo prioritario para el Sprint 9 (Cycle 10, 2/11 al 15/11) es preparar el cobro con dinero real y estabilizar el flujo completo antes de sumar funcionalidad. El Cycle 10 ya tiene cargados MOVO-316, 226 y 240.

| **ID** | **Historia / Tarea** | **Prioridad sugerida** | **Nota** |
|---|---|---|---|
| **MOVO-316 (cierra MOVO-226)** | Términos y Condiciones: penalidades de cancelación y cuenta corriente | Alta | Ya en el Cycle 10, In Progress. Tiene que incluir la disputa automática por demora y el bloqueo del transportista (comentario de MOVO-278). |
| **MOVO-283 y prueba en producción** | Tarjeta guardada en la cuenta de Movo: segundo transportista, producción y débito sin CVV; homologación Marketplace | Alta | Sigue en Todo en el Cycle 8. Condición para dar por aceptada DD-039 y para cualquier cobro real. |
| **Sin ticket** | Discontinuación de la Payments API de Mercado Pago | Alta | El panel de Mercado Pago avisa que la API de Payments, la que usa el hold, "será descontinuada pronto" (comentario de MOVO-215, 11/10). Falta un ticket propio. |
| **Segunda prueba de flujo completo** | Repetir la prueba del 25/10 con los fixes de MOVO-346 | Alta | Ver action items. |
| **MOVO-30** | Iniciar una disputa sobre un envío finalizado o en curso (US padre) | Media | Su sub-issue MOVO-334 se cerró; revisar si queda alcance o cerrarla. |
| **MOVO-35** | Métricas de oferta y demanda por ruta y región | Media | Se solapa con los reportes de MOVO-344 y 345. La distancia del envío y el desglose de la cotización se persisten desde el 04/11 (DD-059), por lo que queda la verificación de la historia. |
| **MOVO-32** | Revisar y aprobar o rechazar casos de KYC pendientes desde el panel | Media | Última historia del panel en Backlog. |
| **MOVO-240** | Catálogo de notificaciones faltantes | Media | Ya en el Cycle 10, sin estimación. |
| **MOVO-233** | Comparación automática de fotos entre creación y retiro | Baja | Historia futura. |


### Registro de riesgos actualizado

El Plan de Proyecto define cada riesgo y su respuesta de base. Esta tabla deja el estado y los cambios observados en el Sprint 8; el registro íntegro de la fecha está en el anexo digital.

| ID | Riesgo | Actualización del sprint |
|---|---|---|
| R01 | Disponibilidad real del equipo menor a la estimada. | Sin señal en la velocity (160 SP). La baja de cierres del 26 al 31/10 se debió a los parciales (ver R05). |
| R02 | Didit.me presenta demoras o comportamientos no documentados. | Sin nueva materialización. |
| R03 | OR-Tools VRPTW no converge en tiempos razonables. | En la prueba del 25/10 el optimizador daba timeout casi siempre: el cliente esperaba 1 s. Se llevó a 5 s (MOVO-346). Sigue sin medición con volumen real. |
| R04 | Subestimación de horas/SP en historias complejas. | Scope +62%, sin arrastre de issues estimados. |
| R05 | Solapamiento con parciales/finales reduce la velocidad del equipo. | Se materializó: por los parciales, del 26 al 31/10 se cerraron solo tres issues (11 SP) y el cierre se concentró en el último día. Mitigación: tener en cuenta las fechas de parciales en el Planning. |
| R06 | Conocimiento crítico concentrado en una sola persona por dominio. | El panel quedó repartido entre los cinco; Pedro Yorlano concentró el 32% del scope. |
| R07 | Los ADRs se documentan en dos fuentes sin un paso de sincronización obligatorio. | Mejoró: registro reorganizado el 24/10 (Sprint 0 + Registro de Decisiones de Diseño). El 02/11 se registraron las DD-056 a DD-058 y los ADR 024 y 025; la numeración sigue chocando en el repositorio. Baja de Alto a Medio. |
| R08 | Defect Rate no captura bugs reales corregidos inline. | Los bugs se agrupan en paquetes con label; el conteo por issue subestima la cantidad de defectos. |
| R10 | Las historias padre no se cierran cuando todas sus hijas están Done. | 8 historias padre cerradas; MOVO-30 sigue en Backlog con su única sub-issue cerrada. |
| R11 | Cierre concentrado y acumulación de issues en In Review al final del sprint. | Reaparece: 6 issues (24 SP) el último día, después de la semana de parciales casi sin cierres. |
| R12 | Canal en tiempo real y custodia validados solo en entorno local. | Mitigado: primera prueba con dispositivos reales contra dev (25/10). Encontró el corte de sesión y de tracking, ya corregido. Baja de Medio a Bajo. |
| R13 | Divergencia de contratos mobile/backend por trabajar contra mocks. | Aparecieron diferencias en soporte (nombres de tipos y una ruta nueva) y se corrigieron antes del merge. |
| R15 | Concentración de un frente nuevo y grande (Pagos) en un único sprint. | Cerrado: el frente de Pagos se completó en el Sprint 7 y sus pendientes en este sprint. |
| R16 | Indisponibilidad del sandbox de Mercado Pago. | Se repitió en la prueba del 25/10 (cuatro pedidos con 502). Mitigación: alerta cuando Mercado Pago falla tres veces en 10 min y extensión del plazo de pago (DD-057). |
| R17 | El cobro solo está validado en sandbox. | Sin cambios: MOVO-283 no se trabajó y el vencimiento real del hold sigue sin confirmar. |
| R18 | **Nuevo.** Mercado Pago discontinúa la Payments API que usa el hold. | Aviso del panel de Mercado Pago (11/10). Sin fecha confirmada ni ticket propio. |


### Artefactos de trazabilidad

Los DTE, el DER, los ADR y DD y los casos de prueba vigentes se presentan en el Tomo II. El informe íntegro del Sprint 8, con los cambios de modelo y los resultados por caso, se conserva en el anexo digital. Durante este ciclo la prueba completa con dispositivos reales terminó con 18 hallazgos; el corte de sesión y tracking se corrigió en el PR #324. El vencimiento de un hold no pudo observarse en el sandbox de Mercado Pago, por lo que la regla de 5 días permanece como límite de diseño. Los casos sintéticos y los resultados aún no reportados quedan identificados en el informe íntegro.
