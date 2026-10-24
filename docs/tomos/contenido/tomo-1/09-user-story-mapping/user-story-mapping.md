::: apaisada

# User Story Map

El User Story Map organiza las funcionalidades de Movo en función del recorrido real del usuario. El eje horizontal (*backbone*) representa las actividades de alto nivel que cualquier actor realiza en la plataforma. El eje vertical, dentro de cada actividad, muestra las tareas y las historias de usuario correspondientes, ordenadas de mayor a menor prioridad. El corte horizontal de MVP define las historias que deben estar implementadas para que la plataforma sea operacionalmente viable.

## Backbone del usuario

![User Story Map de Movo: ocho actividades del usuario, tareas por actividad y corte de MVP.](diagrama:usm)

## Recorrido del usuario

El flujo central de Movo atraviesa las ocho actividades del backbone. Un usuario comienza incorporándose a la plataforma mediante registro y verificación KYC. Según su rol, publicará un envío (emisor) o declarará un viaje y buscará paquetes (transportista). La negociación ocurre cuando los transportistas ofertan sobre envíos publicados y el emisor elige al más conveniente. Una vez asignado, el transportista ejecuta el envío navegando la ruta optimizada, registrando fotos y ejecutando el Cryptographic Handshake en el retiro y en la entrega. Al completarse la entrega, el pago se libera automáticamente vía split payment y las partes califican la experiencia. Ante cualquier incidente, cualquiera de las partes puede abrir una disputa, que resuelve un administrador.

:::

# Backlog Inicial

El backlog se organiza en siete épicas alineadas con los *bounded contexts* de la arquitectura de microservicios de Movo. Cada épica agrupa historias de usuario del mismo dominio funcional. Las historias marcadas con **MVP** forman parte del corte mínimo viable. La estimación se expresa en horas lineales de desarrollo efectivo (equipo avanzado, cinco personas, con herramientas de IA), sin overhead de gestión ni reuniones.

## Resumen por épica

| ID | Épica | Historias | MVP | Horas totales | Horas MVP | Prioridad |
|---|---|--:|--:|--:|--:|---|
| EP-01 | Identidad y Confianza | 6 | 4 | 66 | 52 | Alta |
| EP-02 | Publicación y Descubrimiento | 6 | 5 | 64 | 56 | Alta |
| EP-03 | Asignación y Negociación | 2 | 2 | 18 | 18 | Alta |
| EP-04 | Ejecución del Envío | 6 | 5 | 92 | 78 | Alta |
| EP-05 | Pagos y Economía | 4 | 2 | 42 | 28 | Alta |
| EP-06 | Reputación y Comunidad | 3 | 3 | 24 | 24 | Media |
| EP-07 | Gestión y Administración | 5 | 3 | 46 | 28 | Media |
| **Total** | | **32** | **24** | **352** | **284** | |

: Resumen del backlog inicial por épica.

## Estimación global

| Horas netas | Con buffer de gestión (+20%) | Semanas necesarias | Capacidad del equipo |
|--:|--:|--:|---|
| 352 | 422 | 17 | 25 hs/semana (5 personas × 5 hs) |

: Estimación global del backlog inicial.

Con 17 semanas de trabajo efectivo sobre aproximadamente 30 semanas disponibles hasta noviembre, el equipo contaba con margen para el testing de integración, el refinamiento de los sprints y la preparación de la defensa.

::: nota
**Nota de compilación.** Este es el backlog tal como se estimó en el Sprint 0 (32 historias). Durante el desarrollo el backlog creció y se refinó: el listado completo y vigente de épicas e historias de usuario, con sus criterios de aceptación actuales y su trazabilidad, se presenta en el **Tomo II**.
:::

## Backlog detallado por épica


### EP-01 · Identidad y Confianza

Todo lo relacionado con registro, verificación KYC, gestión de perfil e identidad digital de usuarios. (66 hs totales · 52 hs MVP)

<div class="hu"><div class="hu-cab"><span class="id">MOVO-7</span><span><span class="chip lime">MVP</span><span class="chip">High</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como usuario nuevo, quiero completar el proceso de registro para poder operar en la plataforma</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 24 horas | Alta | Integración Didit.me completa (sesión, webhook), flujo KYC embebido, validaciones email/teléfono, tokenización tarjeta con MP. |

**Criterios de aceptación**

1. El usuario puede registrarse ingresando nombre, email y número de teléfono.
2. El sistema valida que el email no esté previamente registrado.
3. El sistema valida que el número de teléfono sea válido (formato argentino).
4. Al finalizar, el sistema invoca la API de Didit.me y redirige al flujo KYC sin salir de la app.
5. Si Didit.me devuelve approved, el usuario queda habilitado.
6. Si Didit.me devuelve rejected, el usuario ve un mensaje claro.
7. Si Didit.me devuelve manual_review, el usuario ve que su verificación está pendiente.
8. El sistema no almacena imágenes de documentos ni datos biométricos en servidores de Movo.
9. El usuario puede registrar una tarjeta de crédito o débito como método de pago.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-15</span><span><span class="chip lime">MVP</span><span class="chip">Medium</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como transportista quiero verificar mi licencia de conducir y registrar una tarjeta de pago, para habilitar el cobro de comisiones y aumentar mi perfil de confianza</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 12 horas | Media | Upload de imagen con validación de legibilidad, tokenización MP, insignia en perfil. |

**Criterios de aceptación**

1. El usuario puede subir foto de su licencia de conducir desde la app (frente).
2. El sistema verifica que la imagen sea legible antes de enviarla para procesamiento.
3. Al completar la verificación, el perfil muestra la insignia Transportista verificado.
4. El usuario puede registrar una tarjeta de crédito o débito como método de pago.
5. El sistema tokeniza la tarjeta mediante MercadoPago y nunca almacena datos en texto plano.
6. El transportista puede ver y eliminar tarjetas registradas desde su perfil.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-32</span><span><span class="chip lime">MVP</span><span class="chip">High</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como administrador, quiero revisar y aprobar o rechazar los casos de KYC pendientes, para asegurar que solo usuarios verificados operen en la plataforma</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 10 horas | Media | Panel admin con lista filtrable, integración resultado Didit.me, registro de decisión, notificaciones push. |

**Criterios de aceptación**

1. El panel de admin muestra una lista de casos en estado manual_review con fecha, nombre y tipo de documento.
2. El admin puede ver el resultado del análisis de Didit.me para cada caso.
3. El admin puede aprobar o rechazar un caso, dejando registro del usuario y timestamp.
4. Al aprobar, el usuario recibe notificación push y queda habilitado para operar.
5. Al rechazar, el admin debe ingresar una razón. El usuario recibe notificación.
6. La lista permite filtrar por estado y ordenar por fecha.
7. El admin no puede acceder a imágenes biométricas almacenadas en Didit.me directamente.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-14</span><span><span class="chip lime">MVP</span><span class="chip">Medium</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como usuario registrado, quiero ver mi perfil para ver mi información</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 6 horas | Baja | UI de perfil con datos, estado KYC, badges, diferenciación público/privado. |

**Criterios de aceptación**

1. El usuario puede acceder a su perfil desde el menú principal.
2. El perfil muestra: nombre, foto, email, score de reputación, cantidad de transacciones y estado KYC.
3. El perfil diferencia lo que es visible públicamente de lo que es solo visible para el propio usuario.
4. El perfil muestra las insignias activas del usuario (KYC, licencia si aplica).

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-31</span><span><span class="chip">Low</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como usuario registrado, quiero editar mis datos personales y de contacto en mi perfil, para mantener mi información actualizada</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 6 horas | Baja | Edición de nombre/foto/teléfono, verificación OTP para cambio de teléfono. |

**Criterios de aceptación**

1. El usuario puede editar: nombre, foto de perfil, número de teléfono.
2. El usuario no puede editar el email sin pasar por un proceso de verificación.
3. El usuario no puede editar su estado de KYC directamente.
4. Al cambiar el número de teléfono, el sistema envía un código de verificación al nuevo número.
5. Los cambios se guardan con confirmación visual.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-39</span><span><span class="chip">Low</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como usuario registrado, quiero solicitar la baja de mi cuenta para ejercer mi derecho de supresión conforme a la normativa de protección de datos vigente</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 8 horas | Media | Validación de envíos/disputas activas, anonimización de datos, confirmación doble. |

**Criterios de aceptación**

1. El usuario puede solicitar la baja de su cuenta.
2. El sistema no permite la baja si el usuario tiene envíos activos o disputas abiertas.
3. El usuario debe confirmar la decisión con un paso adicional (contraseña o email).
4. Tras confirmar, el sistema elimina los datos de identificación personal.
5. Los registros de transacciones completadas se anonimizan pero no se eliminan.
6. La baja es irreversible.

</div></div>


### EP-02 · Publicación y Descubrimiento

Creación de envíos por parte del emisor, confirmación del receptor y visualización de paquetes disponibles por el transportista. (64 hs totales · 56 hs MVP)

<div class="hu"><div class="hu-cab"><span class="id">MOVO-8</span><span><span class="chip lime">MVP</span><span class="chip">High</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como emisor, quiero crear un envío para iniciar el proceso de envío de forma clara y estructurada</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 20 horas | Alta | Formulario complejo, búsqueda de receptor, motor de precios (distancia+peso+tipo), fotos requeridas, notificación al receptor, estados. |

**Criterios de aceptación**

1. El emisor puede iniciar la creación de un envío desde el tab Enviar.
2. El formulario solicita: tipo de paquete, dimensiones, peso aproximado, descripción opcional.
3. El emisor identifica al receptor buscando por nombre de usuario registrado en Movo.
4. El emisor establece la ventana temporal de retiro, pudiendo especificar una fecha puntual o determinar un rango de fechas (inicio y fin) para la recolección del paquete.
5. El emisor puede tomar 2 fotos del paquete al crear el envío (requerido para evidencia).
6. El sistema calcula y muestra el precio sugerido en ARS antes de confirmar.
7. El cálculo considera al menos distancia, peso y tipo de paquete.
8. El sistema muestra un resumen del envío antes de confirmar la publicación.
9. Al confirmar, el sistema notifica al receptor para que acepte o rechace.
10. El envío queda en estado Esperando confirmación del receptor.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-16</span><span><span class="chip lime">MVP</span><span class="chip">High</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como receptor quiero aceptar o rechazar un envío para evitar recibir paquetes indeseados</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 8 horas | Media | Notificación push, vista de perfil del emisor, lógica de expiración automática. |

**Criterios de aceptación**

1. El receptor recibe una notificación push cuando un emisor lo designa como destinatario.
2. La notificación muestra: quién es el emisor, descripción del paquete y fecha estimada de retiro.
3. El receptor puede ver el perfil y score de reputación del emisor antes de decidir.
4. El receptor puede aceptar o rechazar el envío desde la notificación o desde la app.
5. Si el receptor rechaza, el emisor recibe notificación y el envío no se publica.
6. Si el receptor no responde en un plazo definido, el envío se cancela automáticamente.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-19</span><span><span class="chip lime">MVP</span><span class="chip">High</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como transportista, quiero ver los paquetes disponibles en mi ciudad/región para encontrar oportunidades de transporte</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 10 horas | Media | Listado filtrado por región, actualización en tiempo real o polling, detalle de paquete. |

**Criterios de aceptación**

1. El transportista puede ver un listado de paquetes disponibles filtrado por su ciudad o región.
2. Cada ítem muestra: origen/destino aproximado, peso, tipo de paquete, precio ofrecido y score del emisor.
3. El listado se actualiza en tiempo real o con un botón de recarga.
4. Los paquetes expirados o ya asignados no aparecen en el listado.
5. El transportista puede ver el detalle completo de un paquete antes de ofertar.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-18</span><span><span class="chip lime">MVP</span><span class="chip">High</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como transportista quiero declarar un viaje para ver paquetes compatibles con mi ruta</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 12 horas | Alta | Formulario de viaje, matching con paquetes compatibles vía OR-Tools + Google Maps, edición/cancelación. |

**Criterios de aceptación**

1. El transportista puede declarar un viaje indicando: origen, destino, fecha y hora de salida, tipo de vehículo.
2. El sistema muestra los paquetes disponibles compatibles con la ruta declarada.
3. El transportista puede editar o cancelar un viaje declarado mientras no tenga paquetes aceptados.
4. Si cancela un viaje con paquetes aceptados, se sigue el flujo de cancelación con transportista asignado.
5. La declaración de viaje no genera obligación hasta que el transportista acepte un paquete específico.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-20</span><span><span class="chip">Medium</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como transportista, quiero filtrar los paquetes disponibles por mi ruta declarada, para encontrar rápidamente oportunidades de transporte que encajen con mis viajes</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 8 horas | Media | Lógica de desvío configurable por conductor, combinación con otros filtros, display de desvío estimado. |

**Criterios de aceptación**

1. El transportista puede activar un filtro compatibles con mi ruta que muestra solo paquetes que se ajusten a un viaje declarado activo.
2. Los paquetes compatibles deben tener un desvío menor al configurado por el conductor.
3. El filtro puede combinarse con otros filtros (tipo de paquete, precio mínimo).
4. Si el transportista no tiene un viaje declarado activo, el filtro por ruta no está disponible.
5. Los paquetes filtrados muestran el desvío estimado que implicarían en la ruta declarada.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-29</span><span><span class="chip lime">MVP</span><span class="chip">High</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como emisor, quiero cancelar un envío publicado antes de que sea asignado a un transportista, para poder corregir errores o desistir sin penalización</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 6 horas | Baja | Lógica de estados, notificación a transportistas que ofertaron, política de penalización. |

**Criterios de aceptación**

1. El emisor puede cancelar un envío mientras esté en estado en espera de transportista.
2. La cancelación antes de asignación no genera penalización.
3. Al cancelar, todos los transportistas que habían ofertado reciben notificación.
4. Si el emisor cancela un envío con transportista asignado, se aplica la política de cancelación con penalización.
5. El estado del envío cambia a cancelado y no puede ser reactivado.

</div></div>


### EP-03 · Asignación y Negociación

Oferta, contraoferta y selección de transportista para un envío. (18 hs totales · 18 hs MVP)

<div class="hu"><div class="hu-cab"><span class="id">MOVO-23</span><span><span class="chip lime">MVP</span><span class="chip">High</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como transportista, quiero aceptar el precio sugerido o enviar una contraoferta al emisor, para negociar el precio que considero justo según mi esfuerzo real</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 10 horas | Media | Lógica de ofertas/contraofertas, estados de oferta, notificaciones, restricción de una oferta por envío. |

**Criterios de aceptación**

1. El transportista puede aceptar directamente el precio publicado por el emisor.
2. El transportista puede enviar una contraoferta con un precio diferente y un mensaje opcional.
3. El emisor recibe notificación de la contraoferta y puede aceptarla, rechazarla o ignorarla.
4. Si el emisor acepta la contraoferta, el transportista queda asignado y se inicia la reserva de fondos.
5. El transportista ve el estado de sus ofertas activas (pendiente, aceptada, rechazada).
6. Un transportista no puede tener más de una oferta activa por el mismo envío.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-17</span><span><span class="chip lime">MVP</span><span class="chip">High</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como emisor quiero ver la lista de ofertas de transportistas para elegir la opción más conveniente</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 8 horas | Media | Lista ordenable por precio/reputación, vista de perfil inline, confirmación + trigger de hold. |

**Criterios de aceptación**

1. El emisor ve todas las ofertas activas sobre su envío, ordenadas por precio por defecto.
2. Cada oferta muestra: precio ofertado, nombre del transportista, score de reputación, tipo de vehículo y mensaje.
3. El emisor puede ordenar la lista por precio o por score de reputación.
4. El emisor puede ver el perfil completo de un transportista desde la lista antes de elegir.
5. Al elegir una oferta, el sistema confirma la selección y dispara la reserva de fondos.

</div></div>


### EP-04 · Ejecución del Envío

Todo lo que ocurre desde que el transportista es asignado hasta la entrega: handshake, tracking, fotos y comunicación. (92 hs totales · 78 hs MVP)

<div class="hu"><div class="hu-cab"><span class="id">MOVO-6</span><span><span class="chip lime">MVP</span><span class="chip">High</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como transportista, quiero ejecutar el Cryptographic Handshake para confirmar retiro y entrega segura</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 28 horas | Alta | Protocolo completo: generación de nonce, firma asimétrica, QR dinámico con TTL, validación de firma + geofencing GPS en backend, registro inmutable. Feature más compleja del sistema. |

**Criterios de aceptación**

1. El emisor inicia la transferencia y el sistema genera un QR dinámico con TTL de 15 segundos.
2. El QR expira visualmente en pantalla y muestra el tiempo restante.
3. El backend valida firma criptográfica y que ambos dispositivos están dentro de 100m.
4. Si todas las validaciones pasan, el estado del envío se actualiza y se dispara la liberación de fondos.
5. Si la distancia supera el umbral, el handshake falla con mensaje de error.
6. Si el TTL expiró, el cedente puede generar un nuevo QR.
7. El evento queda registrado con timestamp, coordenadas y hash del nonce (inmutable).
8. El handshake aplica para el retiro (emisor → transportista) y la entrega (transportista → receptor).

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-10</span><span><span class="chip lime">MVP</span><span class="chip">High</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como transportista, quiero ver la ruta optimizada con todos mis puntos de retiro y entrega en el mapa, para ejecutar el recorrido de forma eficiente</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 16 horas | Alta | Integración OR-Tools + Google Maps, renderizado de mapa con puntos diferenciados, actualización dinámica al completar puntos. |

**Criterios de aceptación**

1. Al iniciar el recorrido, el transportista ve un mapa con los puntos ordenados por el algoritmo de ruta.
2. El mapa diferencia visualmente los puntos de retiro de los de entrega.
3. La ruta se actualiza si el transportista completa o cancela un punto.
4. El transportista puede ver el tiempo estimado hasta cada punto.
5. Si el GPS del dispositivo no está activo, el sistema notifica que la ruta no puede calcularse.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-11</span><span><span class="chip lime">MVP</span><span class="chip">High</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como emisor o receptor, quiero ver la ubicación del transportista en tiempo real en un mapa interactivo, para saber exactamente dónde está mi paquete en cada momento del envío</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 16 horas | Alta | WebSockets para posición del transportista, actualización cada ~60s, estado según etapa del envío. |

**Criterios de aceptación**

1. Una vez iniciado el recorrido, emisor y receptor ven la ubicación del transportista actualizada en tiempo real.
2. El mapa muestra la posición del transportista y el punto de destino.
3. El mapa se actualiza con una frecuencia máxima de un minuto sin recargar la pantalla.
4. Si el transportista desactiva la ubicación, el mapa muestra la última posición conocida con timestamp.
5. El tracking en tiempo real solo está activo mientras el transportista tiene un envío en curso.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-21</span><span><span class="chip lime">MVP</span><span class="chip">High</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como transportista, quiero registrar fotografías al retirar y entregar cada paquete, para dejar evidencia visual del estado del paquete</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 8 horas | Media | Captura obligatoria en flujo, almacenamiento seguro sin URL pública, vinculación al envío. |

**Criterios de aceptación**

1. Al llegar al punto de retiro, el sistema solicita tomar al menos 1 foto del paquete.
2. Al llegar al punto de entrega, el sistema solicita al menos 1 foto antes de iniciar el handshake.
3. Las fotos quedan vinculadas al envío y son visibles para emisor, receptor y admin.
4. El transportista no puede avanzar al siguiente paso sin haber cargado las fotos requeridas.
5. Las fotos se almacenan de forma segura y no son accesibles por URL directa.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-24</span><span><span class="chip lime">MVP</span><span class="chip">Medium</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como emisor o receptor, quiero recibir notificaciones push en los eventos clave del envío, para estar informado durante el mismo</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 10 horas | Media | Configuración de Expo Notifications / FCM, 8 eventos distintos, preferencias de usuario. |

**Criterios de aceptación**

1. El sistema envía notificación push al receptor cuando es designado como destinatario.
2. El sistema envía notificación al emisor cuando el receptor acepta o rechaza el envío.
3. El sistema envía notificación al emisor cuando llega una nueva oferta de transportista.
4. El sistema envía notificación a emisor y receptor cuando el transportista es confirmado.
5. El sistema envía notificación cuando el paquete es retirado y cuando es entregado.
6. El usuario puede configurar qué notificaciones desea recibir desde ajustes.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-26</span><span><span class="chip">Medium</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como emisor, receptor o transportista, quiero chatear en tiempo real con las otras partes durante el proceso de envío, para coordinar detalles sin salir de la app</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 14 horas | Alta | WebSocket rooms por shipment_id, persistencia en PostgreSQL, ventana temporal, acceso admin en disputas. |

**Criterios de aceptación**

1. El chat está disponible desde que el transportista es asignado hasta 24 horas post-entrega.
2. El chat soporta mensajes de texto. Las imágenes son opcionales en MVP.
3. Los mensajes se entregan en tiempo real vía WebSockets.
4. El historial del chat queda vinculado al envío y es visible para el admin en caso de disputa.
5. El chat no funciona entre usuarios sin una transacción activa en común.

</div></div>


### EP-05 · Pagos y Economía

Reserva de fondos, liberación de pago, split payment y modalidad de pago en efectivo. (42 hs totales · 28 hs MVP)

<div class="hu"><div class="hu-cab"><span class="id">MOVO-12</span><span><span class="chip lime">MVP</span><span class="chip">High</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como emisor, quiero que mis fondos se reserven automáticamente al confirmar el transportista, para asegurarme de que el pago solo se ejecute efectivamente cuando el paquete sea entregado</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 14 horas | Alta | Auth & Capture con capture:false en MP, manejo de errores (tarjeta rechazada, fondos insuficientes), estados visibles en UI. |

**Criterios de aceptación**

1. Al confirmar la asignación, el sistema ejecuta un Hold & Capture con capture: false en MercadoPago.
2. La reserva se realiza por el monto total acordado.
3. El emisor recibe confirmación visual de que los fondos fueron reservados.
4. Si la reserva falla, la asignación no se confirma y ambas partes son notificadas.
5. Los fondos reservados no se debitan hasta que se complete el handshake de entrega.
6. El emisor puede ver el estado de la reserva en el detalle del envío.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-13</span><span><span class="chip lime">MVP</span><span class="chip">High</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como transportista, quiero recibir el pago automático con split payment tras confirmarse la entrega, para cobrar inmediatamente después de entregar sin gestiones adicionales</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 14 horas | Alta | Captura + split payment al completar handshake, retry automático x2, notificaciones a ambas partes, historial de transacción. |

**Criterios de aceptación**

1. Al completarse el handshake de entrega, el sistema ejecuta la captura y el split payment automáticamente.
2. El porcentaje de comisión de Movo se acredita en la cuenta de Movo.
3. El saldo restante se acredita directamente en la cuenta del transportista.
4. El transportista recibe notificación push con el monto acreditado.
5. Si el split payment falla, el sistema reintenta automáticamente al menos 2 veces.
6. Ambas partes pueden ver el detalle del pago en el historial de la transacción.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-37</span><span><span class="chip">Medium</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como emisor, quiero declarar que voy a pagar la comisión de Movo en efectivo al momento de la entrega, para poder pagar sin una tarjeta de crédito</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 8 horas | Media | Modalidad efectivo en creación de envío, débito automático de comisión de tarjeta del transportista. |

**Criterios de aceptación**

1. Al crear un envío, el emisor puede seleccionar pago en efectivo como modalidad.
2. Si selecciona efectivo, el sistema no requiere tarjeta del emisor para la reserva de fondos.
3. El transportista que acepta un envío con pago en efectivo debe tener una tarjeta precargada en Movo.
4. Al completarse el handshake de entrega, el sistema debita automáticamente la comisión de la tarjeta del transportista.
5. El emisor ve en el resumen que el pago es en efectivo y debe abonar directamente al transportista.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-28</span><span><span class="chip">Low</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como emisor, quiero ver el historial de transacciones, para llevar registro de mis gastos en envíos</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 6 horas | Baja | Listado filtrable, detalle por transacción, exportación CSV. |

**Criterios de aceptación**

1. El emisor puede acceder a un listado de todas sus transacciones de pago.
2. Cada transacción muestra: fecha, monto, estado y referencia al envío.
3. El emisor puede filtrar por estado y rango de fechas.
4. Los reembolsos aparecen vinculados a la transacción original.
5. Se puede descargar las transacciones en CSV.

</div></div>


### EP-06 · Reputación y Comunidad

Calificaciones post-entrega, score de reputación y visualización de perfiles públicos. (24 hs totales · 24 hs MVP)

<div class="hu"><div class="hu-cab"><span class="id">MOVO-22</span><span><span class="chip lime">MVP</span><span class="chip">Medium</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como usuario, quiero calificar y dejar un comentario a las otras partes post-entrega, para contribuir al sistema de confianza de la red</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 8 horas | Media | Habilitación post-handshake, 1-5 estrellas + comentario, expiración 72hs, suspensión en disputa activa. |

**Criterios de aceptación**

1. Una vez completado el handshake de entrega, las tres partes reciben habilitación para calificar.
2. La calificación es de 1 a 5 estrellas y un comentario de texto libre opcional.
3. La opción de calificar expira a las 72 horas de completada la entrega.
4. Un usuario no puede calificar a otro con quien no haya tenido una transacción completada.
5. Si hay una disputa activa, la habilitación de calificación queda suspendida hasta la resolución.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-25</span><span><span class="chip lime">MVP</span><span class="chip">Medium</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como usuario, quiero ver el score de reputación ponderado en el perfil de cualquier otro usuario, para tomar decisiones informadas</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 8 horas | Media | Promedio ponderado por recencia, diferenciado por rol, últimas 10 reseñas visibles, perfil nuevo < 3 transacciones. |

**Criterios de aceptación**

1. El perfil muestra el score de reputación promedio (1-5) y el número de transacciones calificadas.
2. El score se calcula con un promedio ponderado que da más peso a calificaciones recientes.
3. El perfil diferencia las calificaciones recibidas como emisor, transportista y receptor.
4. Los comentarios de las últimas 10 calificaciones son visibles en el perfil.
5. Un usuario con menos de 3 transacciones muestra perfil nuevo en lugar de un score.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-27</span><span><span class="chip lime">MVP</span><span class="chip">Medium</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como emisor, quiero consultar el historial de mis envíos con estados y línea de tiempo, para hacer seguimiento de todos mis envíos pasados y actuales desde un solo lugar</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 8 horas | Media | Listado con estados, timeline de cambios con timestamps, acceso a fotos de evidencia, filtros. |

**Criterios de aceptación**

1. El emisor puede acceder al historial de todos sus envíos (activos, completados, cancelados).
2. Cada envío muestra: id, origen/destino, estado actual, fecha de creación y fecha de entrega.
3. Al seleccionar un envío, el emisor ve la línea de tiempo con todos los cambios de estado y sus timestamps.
4. El historial permite filtrar por estado y ordenar por fecha.
5. El emisor puede acceder a las fotos de evidencia desde el historial.
6. El historial muestra envíos de al menos los últimos 12 meses.

</div></div>


### EP-07 · Gestión y Administración

Panel de administración para monitoreo operacional, gestión de disputas, suspensiones y métricas. (46 hs totales · 28 hs MVP)

<div class="hu"><div class="hu-cab"><span class="id">MOVO-30</span><span><span class="chip lime">MVP</span><span class="chip">Medium</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como emisor o receptor, quiero iniciar una disputa sobre un envío finalizado o en curso, para reclamar formalmente ante un problema con el paquete o con la entrega</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 8 horas | Media | Formulario de disputa con motivo + evidencia, suspensión de pago, notificaciones a todas las partes, cambio de estado. |

**Criterios de aceptación**

1. El usuario puede iniciar una disputa desde el detalle de un envío activo o en los últimos 7 días post-entrega.
2. Al iniciar la disputa, el usuario selecciona un motivo y agrega descripción.
3. El usuario puede adjuntar fotos como evidencia al abrir la disputa.
4. Al crearse la disputa, el admin es notificado para gestión.
5. Si la disputa se abre sobre un envío en curso, el pago queda suspendido hasta resolución.
6. El estado del envío cambia a en disputa.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-34</span><span><span class="chip lime">MVP</span><span class="chip">Medium</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como administrador, quiero gestionar las disputas abiertas para actuar como árbitro entre las partes</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 12 horas | Alta | Panel con historial completo (fotos, handshake, tracking, chat), tres opciones de resolución con ejecución automática de pago, notas internas. |

**Criterios de aceptación**

1. El admin ve todas las disputas abiertas con: partes involucradas, motivo, fecha y evidencia.
2. El admin puede ver el historial completo del envío en disputa: fotos, handshake, tracking, chat.
3. El admin puede resolver la disputa con tres opciones: favor del emisor, favor del transportista, resolución parcial.
4. Al resolver, el sistema ejecuta automáticamente la acción de pago correspondiente.
5. Todas las partes reciben notificación con la decisión y el razonamiento.
6. El admin puede dejar notas internas sobre la resolución (no visibles para usuarios).
7. La resolución queda registrada en el historial del envío de forma permanente.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-36</span><span><span class="chip lime">MVP</span><span class="chip">Medium</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como administrador, quiero suspender o inhabilitar una cuenta de usuario ante comportamiento fraudulento, para proteger la integridad de la red</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 8 horas | Media | Suspensión temporal o permanente, registro con motivo + admin + timestamp, notificación al usuario, levantamiento de suspensión. |

**Criterios de aceptación**

1. El admin puede suspender temporalmente o inhabilitar permanentemente una cuenta desde el perfil del usuario.
2. Al suspender, el admin debe indicar el motivo y la duración de la suspensión.
3. Un usuario suspendido no puede iniciar nuevas transacciones pero puede ver el estado de las activas.
4. El usuario suspendido recibe notificación con el motivo de la suspensión.
5. Las suspensiones quedan registradas en el historial del usuario con fecha, motivo y admin responsable.
6. El admin puede levantar una suspensión y el usuario es notificado.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-33</span><span><span class="chip">Low</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como administrador, quiero ver el listado de envíos activos con su estado en tiempo real, para monitorear la operación de la plataforma y detectar incidentes</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 8 horas | Media | Dashboard con filtros, highlight de anomalías (sin movimiento > 2hs), acceso a detalle. |

**Criterios de aceptación**

1. El panel de admin muestra todos los envíos activos con: ID, estado, partes involucradas, origen/destino y timestamp de último cambio.
2. El admin puede filtrar por estado, región y rango de fechas.
3. El admin puede acceder al detalle completo de cualquier envío activo.
4. Los envíos con anomalías (sin movimiento por más de 2 horas) se destacan visualmente.

</div></div>

<div class="hu"><div class="hu-cab"><span class="id">MOVO-35</span><span><span class="chip">Low</span></span></div><div class="hu-cuerpo"><p class="hu-enunciado">Como administrador, quiero ver métricas de oferta y demanda por ruta y región, para tomar decisiones operativas</p>

| Estimación | Complejidad | Notas de estimación |
|---|---|---|
| 10 horas | Media | Agregaciones por región/fecha, gráficos de tendencia, ratio oferta/demanda, exportación CSV. |

**Criterios de aceptación**

1. El panel muestra métricas agregadas: envíos publicados, completados, cancelados, por rango de fechas seleccionable.
2. Las métricas se pueden segmentar por región/ciudad.
3. Se visualiza la relación oferta/demanda: paquetes publicados vs transportistas disponibles por zona.
4. Las métricas se presentan con gráficos de tendencia.
5. El admin puede exportar las métricas en formato CSV.

</div></div>
