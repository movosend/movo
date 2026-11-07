# User Story Map

El User Story Map organiza las funcionalidades de Movo en función del recorrido real del usuario. El eje horizontal (*backbone*) representa las actividades de alto nivel que cualquier actor realiza en la plataforma. El eje vertical, dentro de cada actividad, muestra las tareas y las historias de usuario correspondientes, ordenadas de mayor a menor prioridad. El corte horizontal de MVP define las historias que deben estar implementadas para que la plataforma sea operacionalmente viable.

## Recorrido del usuario

El flujo central de Movo atraviesa las ocho actividades del backbone. Un usuario comienza incorporándose a la plataforma mediante registro y verificación KYC. Según su rol, publicará un envío (emisor) o declarará un viaje y buscará paquetes (transportista). La negociación ocurre cuando los transportistas ofertan sobre envíos publicados y el emisor elige al más conveniente. Una vez asignado, el transportista ejecuta el envío navegando la ruta optimizada, registrando fotos y ejecutando el Cryptographic Handshake en el retiro y en la entrega. Al completarse la entrega, el pago se libera automáticamente vía split payment y las partes califican la experiencia. Ante cualquier incidente, cualquiera de las partes puede abrir una disputa, que resuelve un administrador.


::: apaisada

## Backbone del usuario

![User Story Map de Movo: ocho actividades del usuario, tareas por actividad y corte de MVP.](diagrama:usm)

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

## Backlog inicial por épica

Las 32 historias de esta sección son la foto de planificación del Sprint 0. Se muestran con su prioridad, estimación y pertenencia al MVP de ese momento. Sus criterios originales se refinaron durante el desarrollo y se conservan íntegros en el anexo digital `docs/tomos/anexos/backlog-inicial-completo.md`; la descripción detallada y trazabilidad **vigentes** de las 50 historias del producto están en los siete temas del Tomo II.

### EP-01 · Identidad y Confianza

Todo lo relacionado con registro, verificación KYC, gestión de perfil e identidad digital de usuarios. (66 hs totales · 52 hs MVP)

::: {.tabla-backlog-inicial}

| ID | Historia inicial | Prioridad | MVP | Estimación |
|---|---|---|:---:|---:|
| `MOVO-7` | Como usuario nuevo, quiero completar el proceso de registro para poder operar en la plataforma | Alta | Sí | 24 h |
| `MOVO-15` | Como transportista quiero verificar mi licencia de conducir y registrar una tarjeta de pago, para habilitar el cobro de comisiones y aumentar mi perfil de confianza | Media | Sí | 12 h |
| `MOVO-32` | Como administrador, quiero revisar y aprobar o rechazar los casos de KYC pendientes, para asegurar que solo usuarios verificados operen en la plataforma | Alta | Sí | 10 h |
| `MOVO-14` | Como usuario registrado, quiero ver mi perfil para ver mi información | Media | Sí | 6 h |
| `MOVO-31` | Como usuario registrado, quiero editar mis datos personales y de contacto en mi perfil, para mantener mi información actualizada | Baja | No | 6 h |
| `MOVO-39` | Como usuario registrado, quiero solicitar la baja de mi cuenta para ejercer mi derecho de supresión conforme a la normativa de protección de datos vigente | Baja | No | 8 h |

: Historias iniciales de EP-01.

:::

### EP-02 · Publicación y Descubrimiento

Creación de envíos por parte del emisor, confirmación del receptor y visualización de paquetes disponibles por el transportista. (64 hs totales · 56 hs MVP)

::: {.tabla-backlog-inicial}

| ID | Historia inicial | Prioridad | MVP | Estimación |
|---|---|---|:---:|---:|
| `MOVO-8` | Como emisor, quiero crear un envío para iniciar el proceso de envío de forma clara y estructurada | Alta | Sí | 20 h |
| `MOVO-16` | Como receptor quiero aceptar o rechazar un envío para evitar recibir paquetes indeseados | Alta | Sí | 8 h |
| `MOVO-19` | Como transportista, quiero ver los paquetes disponibles en mi ciudad/región para encontrar oportunidades de transporte | Alta | Sí | 10 h |
| `MOVO-18` | Como transportista quiero declarar un viaje para ver paquetes compatibles con mi ruta | Alta | Sí | 12 h |
| `MOVO-20` | Como transportista, quiero filtrar los paquetes disponibles por mi ruta declarada, para encontrar rápidamente oportunidades de transporte que encajen con mis viajes | Media | No | 8 h |
| `MOVO-29` | Como emisor, quiero cancelar un envío publicado antes de que sea asignado a un transportista, para poder corregir errores o desistir sin penalización | Alta | Sí | 6 h |

: Historias iniciales de EP-02.

:::

### EP-03 · Asignación y Negociación

Oferta, contraoferta y selección de transportista para un envío. (18 hs totales · 18 hs MVP)

::: {.tabla-backlog-inicial}

| ID | Historia inicial | Prioridad | MVP | Estimación |
|---|---|---|:---:|---:|
| `MOVO-23` | Como transportista, quiero aceptar el precio sugerido o enviar una contraoferta al emisor, para negociar el precio que considero justo según mi esfuerzo real | Alta | Sí | 10 h |
| `MOVO-17` | Como emisor quiero ver la lista de ofertas de transportistas para elegir la opción más conveniente | Alta | Sí | 8 h |

: Historias iniciales de EP-03.

:::

### EP-04 · Ejecución del Envío

Todo lo que ocurre desde que el transportista es asignado hasta la entrega: handshake, tracking, fotos y comunicación. (92 hs totales · 78 hs MVP)

::: {.tabla-backlog-inicial}

| ID | Historia inicial | Prioridad | MVP | Estimación |
|---|---|---|:---:|---:|
| `MOVO-6` | Como transportista, quiero ejecutar el Cryptographic Handshake para confirmar retiro y entrega segura | Alta | Sí | 28 h |
| `MOVO-10` | Como transportista, quiero ver la ruta optimizada con todos mis puntos de retiro y entrega en el mapa, para ejecutar el recorrido de forma eficiente | Alta | Sí | 16 h |
| `MOVO-11` | Como emisor o receptor, quiero ver la ubicación del transportista en tiempo real en un mapa interactivo, para saber exactamente dónde está mi paquete en cada momento del envío | Alta | Sí | 16 h |
| `MOVO-21` | Como transportista, quiero registrar fotografías al retirar y entregar cada paquete, para dejar evidencia visual del estado del paquete | Alta | Sí | 8 h |
| `MOVO-24` | Como emisor o receptor, quiero recibir notificaciones push en los eventos clave del envío, para estar informado durante el mismo | Media | Sí | 10 h |
| `MOVO-26` | Como emisor, receptor o transportista, quiero chatear en tiempo real con las otras partes durante el proceso de envío, para coordinar detalles sin salir de la app | Media | No | 14 h |

: Historias iniciales de EP-04.

:::

### EP-05 · Pagos y Economía

Reserva de fondos, liberación de pago, split payment y modalidad de pago en efectivo. (42 hs totales · 28 hs MVP)

::: {.tabla-backlog-inicial}

| ID | Historia inicial | Prioridad | MVP | Estimación |
|---|---|---|:---:|---:|
| `MOVO-12` | Como emisor, quiero que mis fondos se reserven automáticamente al confirmar el transportista, para asegurarme de que el pago solo se ejecute efectivamente cuando el paquete sea entregado | Alta | Sí | 14 h |
| `MOVO-13` | Como transportista, quiero recibir el pago automático con split payment tras confirmarse la entrega, para cobrar inmediatamente después de entregar sin gestiones adicionales | Alta | Sí | 14 h |
| `MOVO-37` | Como emisor, quiero declarar que voy a pagar la comisión de Movo en efectivo al momento de la entrega, para poder pagar sin una tarjeta de crédito | Media | No | 8 h |
| `MOVO-28` | Como emisor, quiero ver el historial de transacciones, para llevar registro de mis gastos en envíos | Baja | No | 6 h |

: Historias iniciales de EP-05.

:::

### EP-06 · Reputación y Comunidad

Calificaciones post-entrega, score de reputación y visualización de perfiles públicos. (24 hs totales · 24 hs MVP)

::: {.tabla-backlog-inicial}

| ID | Historia inicial | Prioridad | MVP | Estimación |
|---|---|---|:---:|---:|
| `MOVO-22` | Como usuario, quiero calificar y dejar un comentario a las otras partes post-entrega, para contribuir al sistema de confianza de la red | Media | Sí | 8 h |
| `MOVO-25` | Como usuario, quiero ver el score de reputación ponderado en el perfil de cualquier otro usuario, para tomar decisiones informadas | Media | Sí | 8 h |
| `MOVO-27` | Como emisor, quiero consultar el historial de mis envíos con estados y línea de tiempo, para hacer seguimiento de todos mis envíos pasados y actuales desde un solo lugar | Media | Sí | 8 h |

: Historias iniciales de EP-06.

:::

### EP-07 · Gestión y Administración

Panel de administración para monitoreo operacional, gestión de disputas, suspensiones y métricas. (46 hs totales · 28 hs MVP)

::: {.tabla-backlog-inicial}

| ID | Historia inicial | Prioridad | MVP | Estimación |
|---|---|---|:---:|---:|
| `MOVO-30` | Como emisor o receptor, quiero iniciar una disputa sobre un envío finalizado o en curso, para reclamar formalmente ante un problema con el paquete o con la entrega | Media | Sí | 8 h |
| `MOVO-34` | Como administrador, quiero gestionar las disputas abiertas para actuar como árbitro entre las partes | Media | Sí | 12 h |
| `MOVO-36` | Como administrador, quiero suspender o inhabilitar una cuenta de usuario ante comportamiento fraudulento, para proteger la integridad de la red | Media | Sí | 8 h |
| `MOVO-33` | Como administrador, quiero ver el listado de envíos activos con su estado en tiempo real, para monitorear la operación de la plataforma y detectar incidentes | Baja | No | 8 h |
| `MOVO-35` | Como administrador, quiero ver métricas de oferta y demanda por ruta y región, para tomar decisiones operativas | Baja | No | 10 h |

: Historias iniciales de EP-07.

:::

## Evolución del backlog

El Sprint 0 estimó **32 historias y 352 horas netas**. Al refinar los flujos, algunas historias se dividieron y se incorporaron necesidades no previstas, como chat, transferencia de receptor, soporte, sanciones y acceso seguro al panel. El Tomo II distingue las historias vigentes de los tickets técnicos y documenta criterios de aceptación, secuencias y pruebas. Los informes de sprint registran cuándo cambió la prioridad o ingresó trabajo nuevo.
