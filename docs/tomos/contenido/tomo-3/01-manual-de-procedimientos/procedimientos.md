# Propósito y Alcance

Este manual describe **cómo funciona el proceso de negocio de Movo con el sistema ya integrado**: quién hace qué en cada etapa de un envío, qué hace el sistema por su cuenta, qué plazos y reglas se aplican y cómo debe actuar el equipo de Movo ante las situaciones que requieren intervención humana. Es el complemento operativo del Estudio Inicial: allí se diagnosticó el proceso informal (AS-IS) y se propuso el proceso mejorado (TO-BE); acá se documenta cómo quedó ese proceso una vez implementado.

Los procedimientos de este manual se dividen en dos grupos:

- los **procedimientos del proceso de negocio**, que ejecutan los usuarios (emisores, receptores y transportistas) guiados por la aplicación, y
- los **procedimientos de administración**, que ejecuta el equipo de Movo desde el panel web o con las herramientas internas.

::: nota
**Lo que el sistema todavía no cubre.** Un procedimiento de administración depende de funcionalidad que no está implementada al cierre del Sprint 8: la **revisión manual de verificaciones de identidad** (MOVO-32). Además, la experiencia móvil para **abrir una disputa** (MOVO-335) quedó en el backlog: hoy el backend acepta la apertura, pero la aplicación todavía no ofrece el reclamo. Cada caso figura en este manual con el estado real y, cuando existe, el procedimiento provisorio.
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
| 6 | Reserva de fondos | Emisor | Reserva el importe en la tarjeta sin cobrarlo, según el retiro sea cercano o lejano, y compensa si el pago falla o vence. Si Mercado Pago no responde, extiende el plazo de pago 15 minutos, hasta dos veces, en vez de revertir la asignación. En un envío **en efectivo** no hay reserva: el emisor le paga al transportista en mano al retirar. | Envío asignado con fondos (o asignado, en efectivo) |
| 7 | Retiro | Emisor y transportista | Exige las fotos de evidencia, verifica la firma, la vigencia del código y la proximidad de 100 metros y registra el evento. | Envío en camino |
| 8 | Tránsito | Transportista | Calcula la ruta óptima, recibe la posición y la transmite en vivo; habilita el chat. | Seguimiento en vivo |
| 9 | Entrega | Transportista y receptor | Repite la verificación del retiro con los roles invertidos. | Envío entregado |
| 10 | Liquidación | Sistema | Captura la reserva y reparte el pago: comisión de Movo y neto al transportista; reintenta si falla (tres reintentos a los 5 minutos, 30 minutos y 2 horas) y, si persiste, escala a revisión manual. En un envío en efectivo registra la comisión de Movo como **deuda** del transportista en su cuenta corriente. | Envío completado y cobro acreditado |
| 11 | Calificación | Las tres partes | Abre una ventana de 72 horas y actualiza la reputación. | Reputación actualizada |
| 12 | Reclamos | Cualquier parte y administrador | Permite abrir una disputa dentro de los 7 días de la entrega (también la abre el sistema ante un no-retiro o un tránsito demorado). Un administrador la resuelve desde el panel (PO-11). | Disputa abierta y luego resuelta |

: Etapas del proceso de negocio.

# Plazos y Reglas de Negocio

Los plazos y umbrales son valores de configuración de los servicios (variables de entorno) o constantes del código; los de esta tabla son los vigentes al cierre del Sprint 8.

| Regla | Valor | Origen |
|--------------------------------------------|----------------------|------------------|
| Vigencia de la cotización congelada | 15 minutos | DD-028 |
| Plazo del receptor para aceptar o rechazar | 48 horas | Configuración (`RECEIVER_CONFIRMATION_TIMEOUT_HOURS`) |
| Plazo del emisor para elegir otro receptor | 48 horas | Configuración (`RECEIVER_REDESIGNATION_TIMEOUT_HOURS`) |
| Plazo del nuevo receptor ante una transferencia | 6 horas | Configuración (`RECEIVER_TRANSFER_TIMEOUT_HOURS`) |
| Retiro «cercano» (el emisor paga al aceptar) | Dentro de 3 días | Configuración (`FUNDING_NEAR_PICKUP_DAYS`) |
| Plazo para completar el pago de un retiro cercano | 30 minutos | Configuración (`FUNDING_PAYMENT_TIMEOUT_MINUTES`) |
| Extensión del plazo de pago ante una caída de Mercado Pago | 15 minutos, hasta 2 veces | DD-057 |
| Límite para pagar un retiro lejano | 24 horas antes del retiro | Configuración (`FUNDING_RELEASE_HOURS_BEFORE_PICKUP`) |
| Vigencia del código QR del handshake | 15 segundos | ADR-018 |
| Distancia máxima entre las partes del handshake | 100 metros | ADR-018 |
| Gracia tras el cierre de la ventana de retiro | 24 horas | Configuración (`PICKUP_MISSED_GRACE_HOURS`) |
| Aviso y disputa de un envío en tránsito demorado | 12 y 24 horas después de la marca de demora | Configuración (`IN_TRANSIT_ANOMALY_*`) |
| Ventana para calificar | 72 horas desde la entrega | Código |
| Ventana para abrir una disputa | 7 días desde la entrega | DD-054 |
| Cancelación del emisor sin cargo | 12 horas o más antes del retiro | DD-047 |
| Penalidad de cancelación | 25 % del precio acordado | DD-047 |
| Tope del descuento de deuda por envío | 30 % del precio | Configuración (`DEBT_COLLECTION_MAX_RATE`) |
| Deuda vencida (bloquea ofertar y declarar viajes) | Más de 14 días | Configuración (`USER_DEBT_OVERDUE_DAYS`) |
| Deuda máxima de un transportista para ofertar en efectivo | 30.000 ARS | Configuración (`CASH_SHIPMENT_MAX_CARRIER_DEBT_ARS`) |
| Reintentos de una captura fallida | 5, 30 y 120 minutos | DD-044 |
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

**Estado:** la bandeja opera sobre la API de soporte para agentes (MOVO-322). La actualización en tiempo real usa un WebSocket del panel que requiere variables de configuración por ambiente (`SUPPORT_WS_PUBLIC_URL` y `SUPPORT_WS_ALLOWED_ORIGINS`, ver el Manual de Instalación y Operación); mientras no estén cargadas, la bandeja se actualiza por consulta periódica.

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

**Estado:** completo. El panel permite aplicar y levantar sanciones desde la ficha del usuario (MOVO-299), y el efecto es inmediato en el gateway y en la aplicación del usuario sancionado.

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
4. Un envío **demorado en tránsito** se marca solo: pasa la entrega estimada más el 50 % de la duración del trayecto (o 48 horas desde el retiro si no tenía entrega estimada). La aplicación lo muestra como «Demorado». A las 12 horas de la marca se avisa al transportista y a las 24 horas se abre una **disputa automática** a la que se invita a las tres partes a cargar sus descargos (DD-045). Atenderlo por soporte con las partes.

## PO-10 Atender un pago escalado a revisión manual

**Quién:** equipo de desarrollo y administración. **Cuándo:** el sistema agotó los reintentos de una captura o detectó una causa irrecuperable (cuenta de Mercado Pago del transportista rechazada, hold cancelado por Mercado Pago).

1. El sistema deja la liquidación en estado **escalada**, con el motivo, y alerta al equipo por el canal de alertas configurado.
2. Consultar el listado de liquidaciones con problemas (endpoint interno del servicio de pagos) y revisar el motivo.
3. Resolverlo con el soporte de Mercado Pago (cuenta del transportista, hold cancelado) dentro de las **48 horas** objetivo.
4. Si corresponde compensar al usuario, hacerlo con un ajuste de la cuenta corriente (PO-06).

## PO-11 Resolver una disputa

**Quién:** administrador. **Cuándo:** hay una disputa abierta, sea porque la abrió una de las partes o porque la abrió el sistema (no-retiro o tránsito demorado). Mientras está abierta, el envío permanece en estado *disputado* y el transportista queda bloqueado.

1. Abrir **Disputas**. La bandeja se filtra por estado, ciudad de retiro y fechas, y se busca por código del envío o nombre de una parte. Un contador marca las abiertas.
2. Abrir el **expediente**: el motivo y los descargos de cada parte, lo que detectó el sistema (atribución del no-retiro por GPS), las posiciones del transportista, el handshake, las fotos del envío, el historial de las partes y las notas internas. Se puede consultar el chat del envío en solo lectura.
3. Dejar **notas internas** con lo que se habló o falta; las ven todos los administradores, con el nombre de quien las escribió.
4. Resolver con **Resolver disputa**: elegir el resultado (**a favor del emisor**, **a favor del transportista** o **parcial**), escribir el **razonamiento** (mínimo 10 caracteres; lo reciben las tres partes) y, en el parcial, elegir el reparto (25, 50 o 75 %, o un monto libre). El panel muestra antes qué ocurrirá con el dinero.
5. Confirmar. El sistema ejecuta el pago según la matriz de resolución, cierra el envío, desbloquea al transportista, avisa a las tres partes y habilita la calificación del ganador (en el parcial, de ambas partes).

| Resultado | Envío asignado (reserva ya liberada) | Envío en tránsito (reserva sin capturar) | Envío entregado o completado (ya capturado) |
|------------|---------------------|---------------------|---------------------|
| A favor del emisor | Sin movimiento de dinero | Se libera la reserva | Reembolso total |
| A favor del transportista | Crédito en su cuenta corriente | Captura total | Sin movimiento |
| Parcial | Crédito en su cuenta corriente | Captura parcial | Reembolso parcial |

: Matriz de resolución de una disputa (DD-056).

**Estado final del envío:** *cancelado* si gana el emisor y *completado* en los otros dos casos; no se agregan estados nuevos. En un envío en efectivo no hay movimiento contra Mercado Pago: la compensación se registra en la cuenta corriente.

**Si el pago falla:** la disputa queda en *Procesando pago* y el expediente ofrece **reintentar** (la operación es idempotente). Si el transportista no tiene saldo en Mercado Pago para devolver el monto, el reembolso queda en *respaldo a la cuenta corriente*: el sistema asienta la **deuda del transportista** con Movo y **alerta al equipo**, porque el emisor todavía no recibió su dinero y devolvérselo es una acción manual del equipo. Una disputa **resuelta es definitiva**: no se reabre ni se modifica.

**Restricciones:** el administrador que es parte del envío no puede resolver su disputa (conflicto de interés). Toda resolución queda en la bitácora con el administrador, el resultado y el razonamiento.

## PO-12 Revisar una verificación de identidad en revisión manual

**Estado: pendiente de implementación (MOVO-32).** Cuando Didit marca una verificación *en revisión*, el sistema la registra y avisa al usuario, pero **no hay pantalla del panel para aprobarla o rechazarla**. Hoy el usuario puede reintentar la verificación desde la aplicación.

## PO-13 Atender un pedido de baja de cuenta o de datos personales

**Cuándo:** una persona pide eliminar su cuenta o acceder a sus datos (Ley 25.326).

1. La baja la hace el propio usuario desde **Mi perfil > Cuenta y seguridad > Dar de baja la cuenta**, con su contraseña. El sistema la rechaza si hay envíos activos o disputas abiertas.
2. Al dar de baja, la cuenta queda anonimizada y se eliminan los registros de verificación y la clave del dispositivo.
3. El historial de envíos cerrados se conserva el plazo legal (5 años) y luego un proceso automático lo purga.
4. Los pedidos de acceso o rectificación se atienden por soporte, verificando la identidad de quien los pide (PO-07).

## PO-14 Cambiar el estado de un envío trabado

**Cuándo:** un envío quedó detenido por un hecho que el sistema no puede resolver solo (por ejemplo, el receptor confirmó por teléfono una entrega cuyo QR no se pudo leer). Es una acción excepcional: **no reemplaza** al handshake ni a la resolución de una disputa.

1. En el detalle del envío, elegir **Cambiar estado**. El botón está deshabilitado si el administrador es parte del envío.
2. **Elegir el destino.** El panel ofrece solo los cambios que permite la matriz de transiciones (DD-055) y muestra, para los bloqueados, el motivo.
3. **Revisar el impacto:** qué se ejecuta, en qué orden y a quién se avisa (siempre a las partes; al transportista solo si el envío tiene uno), qué conviene verificar antes y qué no se puede deshacer.
4. **Confirmar:** escribir el **motivo** (mínimo 20 caracteres), tipear el **código del envío** (desde el riesgo alto) y, si la transición es *forzada* o de riesgo *crítico*, ingresar un **código de 6 dígitos** enviado al correo del administrador, que se pide de nuevo en cada acción.
5. El cambio se ejecuta con los mismos servicios de dominio que usa el flujo normal (cancelar, retirar al transportista, confirmar fondos, capturar y completar), queda marcado como forzado en la línea de tiempo, en la bitácora y se avisa a las partes.

| Desde | Hacia | Riesgo | Qué ejecuta |
|----------------|----------------|----------|------------------------|
| Esperando al receptor, publicado o rechazado por el receptor | Cancelado | Medio | Cierra las ofertas pendientes |
| Asignación pendiente o asignado sin fondos | Publicado | Medio | Retira al transportista |
| Asignación pendiente o asignado sin fondos | Asignado | Alto | Confirma el pago |
| Asignación pendiente o asignado sin fondos | Cancelado | Alto | Libera la reserva |
| Asignado | Publicado | Alto | Retira al transportista |
| Asignado | Cancelado | Alto (forzado) | Libera la reserva, sin penalidad ni deuda |
| Entregado | Completado | Crítico | Captura el pago y completa el envío |

: Cambios de estado permitidos desde el panel (resumen de la matriz de DD-055).

**No se puede forzar:** un envío en tránsito, completado, cancelado o en disputa; tampoco se fuerza hacia *en tránsito*, *entregado* ni *en disputa*, porque el retiro y la entrega exigen la evidencia del handshake y una disputa se abre con su expediente. **Estado:** DD-055 figura como propuesta, a la espera de la revisión de dos integrantes del equipo.

## PO-15 Atender el resumen operativo de Inicio

**Quién:** administrador de turno. **Cuándo:** al comenzar la jornada y a lo largo del día.

1. Abrir **Inicio** y mirar primero el grupo **Fuera de plazo**: son las bandejas cuyo caso más viejo superó su plazo.
2. Entrar a cada bandeja y atender el caso más viejo con el procedimiento que corresponde: disputas abiertas (PO-11), conversaciones sin responder (PO-03), envíos con alerta (PO-09), pagos por revisar (PO-10), reportes de usuarios (PO-04) y sanciones que vencen hoy (PO-05).
3. Si una bandeja muestra un error, usar **Reintentar** en esa bandeja; el resto sigue disponible.
4. Para entender tendencias (por ejemplo, si crecen las disputas o las entregas tarde), consultar **Reportería > Métricas** y exportar el CSV si hace falta documentarlo.

| Bandeja | Plazo |
|--------------------------|----------------------|
| Disputas abiertas | 72 horas |
| Conversaciones sin responder | 30 minutos |
| KYC por revisar | 24 horas |
| Reportes de usuarios | 24 horas |
| Envíos con alerta | 1 hora |
| Pagos por revisar | 6 horas |
| Mensajes señalados | 12 horas |
| Sanciones que vencen hoy | Sin plazo |

: Plazos de las bandejas de Inicio (DD-058).

Las bandejas de KYC, reportes y mensajes señalados se leen desde el resumen, pero todavía no tienen una pantalla propia de atención (ver PO-04 y PO-12).

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

- **Bitácora de administración.** Se consulta en **Reportería > Bitácora**, con filtros y exportación a CSV. Toda acción de escritura del panel se registra con el administrador, el motivo, el contexto y el identificador del pedido, y puede quedar como *éxito*, *fallida* o *desconocida* (si el servicio no respondió y la acción pudo haberse aplicado). La tabla no admite modificaciones ni borrados.
- **Línea de tiempo de cada envío.** Registra cada cambio de estado, quién lo causó y el motivo.
- **Eventos de custodia.** Cada retiro y entrega guarda el hash del código, las coordenadas y la distancia.
- **Historial de sanciones** y **cuenta corriente** del usuario: solo se agregan filas.
- **Privacidad.** No se guardan documentos ni biometría de la verificación; las fotos de los reportes solo las ve el equipo; la traza de posición se conserva 30 días; el historial de envíos cerrados, 5 años.
