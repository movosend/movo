# Propósito y Alcance

Este manual describe **cómo funciona el proceso de negocio de Movo con el sistema ya integrado**: quién hace qué en cada etapa de un envío, qué hace el sistema por su cuenta, qué plazos y reglas se aplican y cómo debe actuar el equipo de Movo ante las situaciones que requieren intervención humana. Es el complemento operativo del Estudio Inicial: allí se diagnosticó el proceso informal (AS-IS) y se propuso el proceso mejorado (TO-BE); acá se documenta cómo quedó ese proceso una vez implementado.

Los procedimientos de este manual se dividen en dos grupos:

- los **procedimientos del proceso de negocio**, que ejecutan los usuarios (emisores, receptores y transportistas) guiados por la aplicación, y
- los **procedimientos de administración**, que ejecuta el equipo de Movo desde el panel web o con las herramientas internas.

::: nota
**Lo que el sistema todavía no cubre.** Tres procedimientos de administración dependen de funcionalidad que no está implementada al cierre del Sprint 8: la **resolución de disputas con reembolsos** (MOVO-34), la **revisión manual de verificaciones de identidad** (MOVO-32) y las **métricas de oferta y demanda** (MOVO-35). Cada uno figura en este manual con el estado real y, cuando existe, el procedimiento provisorio.
:::

# Roles y Responsabilidades

| Rol | Responsabilidades en el proceso |
|----------------|-----------------------------------------------------------------|
| **Emisor** | Publicar el envío con datos veraces y fotos, elegir al transportista, reservar el pago, entregar el paquete en el retiro y calificar. |
| **Receptor** | Aceptar o rechazar el envío en plazo, estar presente en la entrega, confirmarla y calificar. Puede transferir la recepción. |
| **Transportista** | Mantener verificadas su identidad y licencia y vinculada su cuenta de cobro, declarar y ejecutar sus viajes, retirar y entregar con la evidencia requerida, y mantener al día su deuda. |
| **Sistema Movo** | Verificar, calcular, reservar, firmar, registrar, notificar, vencer y reintentar de forma automática. Es quien aplica los plazos y las reglas de este manual. |
| **Administrador** | Operar el panel: atender soporte, revisar reportes, sancionar cuentas, ajustar la cuenta corriente, monitorear envíos y gestionar a otros administradores. Cada acción de escritura exige un motivo y queda registrada. |
| **Equipo de desarrollo** | Mantener la plataforma, atender las alertas del sistema (por ejemplo, un pago escalado) y ejecutar las tareas de operación técnica del Manual de Instalación y Operación. |

: Roles y responsabilidades.

# El Proceso de Negocio con el Sistema Integrado

El proceso completo de un envío tiene dos tramos. El primero, desde el registro hasta la asignación del transportista con los fondos reservados; el segundo, desde el retiro hasta el cierre del envío con el pago acreditado y las calificaciones. Los diagramas muestran quién actúa en cada paso (carriles) y dónde interviene el sistema.

## De la publicación a la asignación

![Proceso de negocio, parte 1: del registro a la asignación del transportista.](diagrama:proc-publicacion){.borde .sin-corte}

## De la ejecución al cierre

![Proceso de negocio, parte 2: del retiro al cierre y la calificación.](diagrama:proc-ejecucion){.borde .sin-corte}

## Etapas del proceso

| N° | Etapa | Responsable | Qué hace el sistema | Resultado |
|----|--------------|--------------|--------------------------------------------|--------------------|
| 1 | Alta y verificación | Todos | Verifica el teléfono con un código, delega la verificación de identidad en Didit.me y, para transportistas, la de la licencia. No almacena documentos ni biometría. | Cuenta verificada |
| 2 | Cotización y publicación | Emisor | Calcula el precio sugerido y lo congela 15 minutos; valida los límites del paquete y que el receptor esté verificado. | Envío en espera del receptor |
| 3 | Confirmación del receptor | Receptor | Avisa al receptor y vence el plazo (48 horas) si no responde. | Envío publicado, rechazado o cancelado |
| 4 | Declaración y oferta | Transportista | Muestra el feed según la cercanía, calcula el neto y el bruto de la oferta y la vence si no se atiende. | Ofertas sobre el envío |
| 5 | Selección y asignación | Emisor | Revalida al transportista y asigna el envío de forma atómica. | Envío asignado (a la espera del pago) |
| 6 | Reserva de fondos | Emisor | Reserva el importe en la tarjeta sin cobrarlo, según el retiro sea cercano o lejano, y compensa si el pago falla o vence. | Envío asignado con fondos |
| 7 | Retiro | Emisor y transportista | Exige las fotos de evidencia, verifica la firma, la vigencia del código y la proximidad de 100 metros y registra el evento. | Envío en camino |
| 8 | Tránsito | Transportista | Calcula la ruta óptima, recibe la posición y la transmite en vivo; habilita el chat. | Seguimiento en vivo |
| 9 | Entrega | Transportista y receptor | Repite la verificación del retiro con los roles invertidos. | Envío entregado |
| 10 | Liquidación | Sistema | Captura la reserva y reparte el pago: comisión de Movo y neto al transportista; reintenta si falla. | Envío completado y cobro acreditado |
| 11 | Calificación | Las tres partes | Abre una ventana de 72 horas y actualiza la reputación. | Reputación actualizada |
| 12 | Reclamos | Cualquier parte | Permite abrir una disputa dentro de los 7 días de la entrega. | Disputa abierta |

: Etapas del proceso de negocio.

# Plazos y Reglas de Negocio

Los plazos y umbrales son valores de configuración de los servicios (variables de entorno) o constantes del código; los de esta tabla son los vigentes al cierre del Sprint 8.

| Regla | Valor | Origen |
|--------------------------------------------|----------------------|------------------|
| Vigencia de la cotización congelada | 15 minutos | ADR-028 |
| Plazo del receptor para aceptar o rechazar | 48 horas | Configuración (`RECEIVER_CONFIRMATION_TIMEOUT_HOURS`) |
| Plazo del emisor para elegir otro receptor | 48 horas | Configuración (`RECEIVER_REDESIGNATION_TIMEOUT_HOURS`) |
| Plazo del nuevo receptor ante una transferencia | 6 horas | Configuración (`RECEIVER_TRANSFER_TIMEOUT_HOURS`) |
| Retiro «cercano» (el emisor paga al aceptar) | Dentro de 3 días | Configuración (`FUNDING_NEAR_PICKUP_DAYS`) |
| Plazo para completar el pago de un retiro cercano | 30 minutos | Configuración (`FUNDING_PAYMENT_TIMEOUT_MINUTES`) |
| Límite para pagar un retiro lejano | 24 horas antes del retiro | Configuración (`FUNDING_RELEASE_HOURS_BEFORE_PICKUP`) |
| Vigencia del código QR del handshake | 15 segundos | ADR-020 |
| Distancia máxima entre las partes del handshake | 100 metros | ADR-020 |
| Gracia tras el cierre de la ventana de retiro | 24 horas | Configuración (`PICKUP_MISSED_GRACE_HOURS`) |
| Aviso y disputa de un envío en tránsito demorado | 12 y 24 horas después de la marca de demora | Configuración (`IN_TRANSIT_ANOMALY_*`) |
| Ventana para calificar | 72 horas desde la entrega | Código |
| Ventana para abrir una disputa | 7 días desde la entrega | ADR-054 |
| Cancelación del emisor sin cargo | 12 horas o más antes del retiro | ADR-047 |
| Penalidad de cancelación | 25 % del precio acordado | ADR-047 |
| Tope del descuento de deuda por envío | 30 % del precio | Configuración (`DEBT_COLLECTION_MAX_RATE`) |
| Deuda vencida (bloquea ofertar y declarar viajes) | Más de 14 días | Configuración (`USER_DEBT_OVERDUE_DAYS`) |
| Reintentos de una captura fallida | 5, 30 y 120 minutos | ADR-044 |
| Revisión manual de una liquidación escalada | 48 horas | Configuración (`SETTLEMENT_REVIEW_SLA_HOURS`) |
| Vigencia de un hold en Mercado Pago | 5 días | Configuración (`MP_HOLD_VALIDITY_DAYS`) |
| Límites del paquete | 30 kg, 150 cm por lado, 300 cm de suma | Configuración |
| Vigencia del token de acceso y del refresh | 60 minutos y 90 días | ADR-004, ADR-013 |
| Sesión del panel de administración | 8 horas como máximo | Código |
| Retención de la traza de posición | 30 días | Configuración (`CARRIER_POSITION_RETENTION_DAYS`) |
| Retención del historial de envíos cerrados | 5 años | Configuración (`SHIPMENT_HISTORY_RETENTION_YEARS`) |
| Tope de un ajuste manual de la cuenta corriente | 500.000 ARS | Configuración (`ADMIN_LEDGER_ADJUSTMENT_MAX_ARS`) |
| Tasa de la comisión de Mercado Pago considerada | 4,99 % | Configuración (`MP_TRANSACTION_FEE_RATE`) |

: Plazos, umbrales y reglas vigentes.

# Procedimientos de Administración

Cada procedimiento indica quién lo ejecuta, cuándo se dispara, los pasos y el resultado esperado. Salvo indicación contraria, los realiza un administrador desde el panel web (`admin.movosend.app`).

## PO-01 Alta de un administrador

**Quién:** un administrador existente (o el equipo de desarrollo para el primer administrador). **Cuándo:** se incorpora una persona al equipo de operaciones.

1. La persona debe tener una cuenta en la aplicación, con el **correo electrónico verificado** (Mi perfil > verificar correo) y la cuenta **activa**.
2. Un administrador entra al panel, abre **Admins** y toca **Agregar administrador**.
3. Busca a la persona por nombre o correo, escribe el **motivo**, y confirma con su contraseña y el código de verificación.
4. El sistema otorga el rol, deja la acción en la bitácora y le envía un aviso por correo a la persona.
5. **Primer administrador del sistema:** como todavía no hay quien lo otorgue desde el panel, el equipo de desarrollo ejecuta el script `admin:grant` en el servicio de usuarios (ver el Manual de Instalación y Operación).

**Resultado:** la persona puede ingresar al panel con contraseña y código por correo. El sistema nunca permite quedarse sin administradores ni que un administrador se revoque a sí mismo.

## PO-02 Revocar un administrador

**Cuándo:** una persona deja el equipo o se compromete su cuenta.

1. En **Admins**, tocar **Revocar acceso** en la fila de la persona.
2. Escribir el **motivo** y confirmar.
3. Las sesiones del panel de esa persona se cortan de inmediato; sus sesiones de la aplicación móvil no se afectan.

## PO-03 Atender una consulta de soporte

**Quién:** administrador de soporte. **Cuándo:** un usuario escribe desde **Ayuda y soporte**.

1. Abrir **Soporte** y revisar la bandeja (filtros **Todos**, **Míos**, **Sin asignar**).
2. Abrir la consulta, **tomarla** (asignársela) y leer el contexto del usuario: verificaciones, reputación, envíos recientes y consultas anteriores.
3. Si se refiere a un envío, **vincularlo** a la consulta y revisar su detalle en **Envíos** (partes, línea de tiempo, pago, chat).
4. Responder. Las **notas internas** no las ve nunca el usuario.
5. Marcar la consulta como resuelta. Si el usuario escribe de nuevo, se reabre sola.

**Estado:** la interfaz de la bandeja está construida, pero la API de soporte para agentes (MOVO-322) sigue en desarrollo; hasta entonces el panel opera con datos de prueba.

## PO-04 Revisar un reporte de usuario

**Cuándo:** un usuario reporta a otro (acoso, no se presentó, paquete dañado, problema con el pago u otro).

1. Abrir la **ficha del usuario reportado** y revisar la sección **Moderación**: reportes recibidos y hechos, y bloqueos.
2. Leer el detalle, las entradas adicionales y las fotos del reporte (solo las ve el equipo).
3. Revisar la **actividad** reciente del usuario (envíos, calificaciones) y, si hace falta, el **chat** del envío involucrado (solo lectura).
4. Decidir: sin acción, escribir al usuario por soporte, o aplicar una sanción (PO-05). Dejar una **nota interna** con la conclusión.

**Estado:** los estados *revisado* y *descartado* del reporte existen en el modelo, pero todavía no hay una pantalla del panel para marcarlos.

## PO-05 Suspender, inhabilitar o levantar una sanción

**Cuándo:** comportamiento fraudulento o violación reiterada de los Términos.

1. En la ficha del usuario, menú **Acciones > Suspender o inhabilitar**.
2. Elegir el tipo: **suspensión** (con fecha de fin o indefinida) o **inhabilitación**. Escribir el **motivo** (obligatorio, lo recibe el usuario) y, si hace falta, una **nota interna** (nunca se muestra al usuario).
3. El sistema aplica la sanción de inmediato y de forma verificable en cada pedido: una cuenta suspendida no puede iniciar nada nuevo; una inhabilitada no puede ingresar ni usar un token ya emitido.
4. Se retiran las publicaciones, las ofertas pendientes y los viajes sin paquetes del usuario, se avisa a las contrapartes de sus envíos en curso (sin el motivo) y se notifica al sancionado por push y correo.
5. Inhabilitar a quien tiene envíos en curso se rechaza con la lista de envíos; hay que resolverlos antes.
6. Para **levantar** una sanción, usar la misma ficha, con motivo. Una suspensión con fecha de fin se levanta sola y se avisa al usuario.

**Restricciones:** un administrador no puede sancionarse a sí mismo ni levantar su propia sanción; no se puede sancionar al último administrador elegible.

**Estado:** el backend y la experiencia del usuario sancionado están completos; la pantalla del panel para aplicar y levantar sanciones (MOVO-299) está en curso.

## PO-06 Ajustar la cuenta corriente de un usuario

**Cuándo:** hay que corregir o compensar un movimiento (por ejemplo, anular una penalidad cobrada por error).

1. En la ficha, **Acciones > Ajustar el saldo**.
2. Indicar el **monto** (hasta 500.000 ARS por ajuste), el sentido y el **motivo**.
3. Revisar la vista previa **Antes / Después**, tildar la confirmación y aceptar.
4. El ajuste queda como movimiento manual de la cuenta corriente, con el nombre del administrador, y en la bitácora.

## PO-07 Cambiar el correo o el teléfono de un usuario

**Cuándo:** el usuario perdió acceso a su correo o teléfono y lo pide por soporte.

1. **Verificar la identidad** del usuario por el canal de soporte antes de cualquier cambio (por ejemplo, pidiendo datos que solo el titular conoce).
2. En la ficha, **Acciones > Cambiar el email** (o **el teléfono**), con el **motivo** (por ejemplo, «pidió el cambio por soporte tras validar identidad»).
3. Revisar el *antes* y el *después* y confirmar.

## PO-08 Cerrar todas las sesiones de un usuario

**Cuándo:** se sospecha que la cuenta está comprometida (teléfono robado, accesos extraños).

1. En la ficha, **Acciones > Cerrar todas las sesiones**, con el **motivo**.
2. Las sesiones de la aplicación se revocan; el usuario debe ingresar de nuevo. Se recomienda indicarle que cambie su contraseña.

## PO-09 Monitorear envíos y detectar anomalías

**Cuándo:** de forma rutinaria o ante un reclamo.

1. En **Envíos**, revisar la pestaña de activos y filtrar por ciudad de retiro o por fecha del último cambio.
2. Abrir el detalle: línea de tiempo (cada cambio de estado con su motivo), ofertas, pago y chat.
3. Para un envío en camino, usar el **mapa de seguimiento**.
4. Un envío **demorado en tránsito** se marca solo: pasa la entrega estimada más el 50 % de la duración del trayecto (o 48 horas desde el retiro si no tenía entrega estimada). La aplicación lo muestra como «Demorado». A las 12 horas de la marca se avisa al transportista y a las 24 horas se abre una **disputa automática** a la que se invita a las tres partes a cargar sus descargos (ADR-045). Atenderlo por soporte con las partes.

## PO-10 Atender un pago escalado a revisión manual

**Quién:** equipo de desarrollo y administración. **Cuándo:** el sistema agotó los reintentos de una captura o detectó una causa irrecuperable (cuenta de Mercado Pago del transportista rechazada, hold cancelado por Mercado Pago).

1. El sistema deja la liquidación en estado **escalada**, con el motivo, y alerta al equipo por el canal de alertas configurado.
2. Consultar el listado de liquidaciones con problemas (endpoint interno del servicio de pagos) y revisar el motivo.
3. Resolverlo con el soporte de Mercado Pago (cuenta del transportista, hold cancelado) dentro de las **48 horas** objetivo.
4. Si corresponde compensar al usuario, hacerlo con un ajuste de la cuenta corriente (PO-06).

## PO-11 Resolver una disputa

**Estado: pendiente de implementación (MOVO-34).** Hoy el sistema permite abrir la disputa, cargar los descargos de las partes y bloquear al transportista, pero **no existe todavía la pantalla de resolución ni los reembolsos** automáticos. Mientras tanto:

1. Revisar la disputa y los descargos en la línea de tiempo del envío y, si hace falta, el chat y las fotos de evidencia.
2. Contactar a las partes por soporte.
3. Registrar la decisión como nota interna y, si hay que compensar a alguna parte, usar un ajuste de la cuenta corriente (PO-06). Los envíos en disputa permanecen en ese estado hasta que se implemente la resolución.

## PO-12 Revisar una verificación de identidad en revisión manual

**Estado: pendiente de implementación (MOVO-32).** Cuando Didit marca una verificación *en revisión*, el sistema la registra y avisa al usuario, pero **no hay pantalla del panel para aprobarla o rechazarla**. Hoy el usuario puede reintentar la verificación desde la aplicación.

## PO-13 Atender un pedido de baja de cuenta o de datos personales

**Cuándo:** una persona pide eliminar su cuenta o acceder a sus datos (Ley 25.326).

1. La baja la hace el propio usuario desde **Mi perfil > Cuenta y seguridad > Dar de baja la cuenta**, con su contraseña. El sistema la rechaza si hay envíos activos o disputas abiertas.
2. Al dar de baja, la cuenta queda anonimizada y se eliminan los registros de verificación y la clave del dispositivo.
3. El historial de envíos cerrados se conserva el plazo legal (5 años) y luego un proceso automático lo purga.
4. Los pedidos de acceso o rectificación se atienden por soporte, verificando la identidad de quien los pide (PO-07).

# Contingencias

Cuando un servicio externo falla, el sistema está diseñado para degradar de forma controlada. Esta tabla resume qué ve el usuario y qué debe hacer el equipo.

| Falla | Qué ocurre | Acción del equipo |
|-------------------|---------------------------------------------|-------------------------------|
| Mercado Pago no responde | El pago no se reserva y no se cobra nada; el usuario puede reintentar. Las capturas fallidas se reintentan solas. | Verificar el estado de Mercado Pago; vigilar las liquidaciones escaladas (PO-10). |
| Didit no responde | El usuario ve un error de verificación y puede reintentar más tarde. | Verificar el estado del proveedor; los webhooks se reintentan. |
| Google Maps no responde | El precio sugerido se calcula con una distancia aproximada; el mapa y las rutas pueden mostrarse degradados. | Revisar la cuota diaria y la clave de API. |
| Servicio de precios caído | El envío se crea con «precio a estimar». | Reiniciar el servicio de precios. |
| Redis no responde | El gateway deja pasar los pedidos sin consultar las restricciones de cuenta (falla abierta). | Restablecer Redis; el servicio de usuarios reescribe las marcas de sanciones al reiniciar. |
| Proveedor de SMS o correo caído | No llegan los códigos. | Verificar el proveedor; pedir al usuario que reintente. |
| Caída de la instancia | La plataforma completa queda fuera de servicio (no hay alta disponibilidad). | Seguir el procedimiento de recuperación del Manual de Instalación y Operación. |

: Contingencias por falla de servicios externos.

# Registro y Auditoría

- **Bitácora de administración.** Toda acción de escritura del panel se registra con el administrador, el motivo, el contexto y el identificador del pedido, y puede quedar como *éxito*, *fallida* o *desconocida* (si el servicio no respondió y la acción pudo haberse aplicado). La tabla no admite modificaciones ni borrados.
- **Línea de tiempo de cada envío.** Registra cada cambio de estado, quién lo causó y el motivo.
- **Eventos de custodia.** Cada retiro y entrega guarda el hash del código, las coordenadas y la distancia.
- **Historial de sanciones** y **cuenta corriente** del usuario: solo se agregan filas.
- **Privacidad.** No se guardan documentos ni biometría de la verificación; las fotos de los reportes solo las ve el equipo; la traza de posición se conserva 30 días; el historial de envíos cerrados, 5 años.
