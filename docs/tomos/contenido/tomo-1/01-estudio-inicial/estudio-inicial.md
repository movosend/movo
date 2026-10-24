# Objetivo del Proyecto

Desarrollar una plataforma integral de logística distribuida P2P (peer-to-peer) que elimine la dependencia de intermediarios centralizados, permitiendo a cualquier persona enviar paquetes a través de otras personas que ya realizan ese recorrido. La plataforma garantiza la seguridad de los activos mediante criptografía asimétrica y protocolos de verificación de custodia, y optimiza la formación de precios a través de algoritmos dinámicos y mecanismos de subasta.

## Objetivos Específicos

-   Implementar un sistema de verificación de identidad (KYC) que garantice la confiabilidad de todos los participantes de la red.

-   Diseñar un protocolo criptográfico de transferencia de custodia (Cryptographic Handshake) que asegure que el cambio de posesión de un paquete ocurra de forma verificable e inmutable.

-   Desarrollar un motor de precios dinámico que calcule tarifas en función de distancia, demanda, urgencia y perfil del transportista.

-   Implementar un algoritmo de optimización de rutas que maximice el número de paquetes entregados, minimizando el desvío total del transportista respecto a su ruta original.

-   Integrar un sistema de pagos con reserva de fondos (hold/capture) y split payment mediante la API de Mercado Pago, asegurando la correcta distribución de comisiones sin procesar totales ajenos al negocio.

-   Implementar seguimiento en tiempo real del estado de los envíos con actualizaciones de baja latencia con mapas interactivos.

-   Diseñar un sistema de reputación bidireccional que permita a los usuarios calificar y ser calificados, construyendo un score de confianza a lo largo del tiempo.

-   Implementar un sistema de chat en vivo entre usuarios de la app durante la transacción.

## Declaración de Propósito

Movo no es simplemente una aplicación de mensajería logística. Es un protocolo de confianza digital aplicado a la economía colaborativa del transporte. El problema central de la logística P2P es la asimetría de información y el riesgo inherente de operar con desconocidos: ¿quién es la persona que transporta mi paquete?, ¿cómo aseguro que fue entregado en condiciones? Movo resuelve este problema mediante tecnología, no mediante la intervención de una empresa centralizada que actúa como garante.

# Ámbito de Aplicación e Impulsos del Proyecto

## Contexto y Ámbito de Aplicación

Movo está concebido para operar en el mercado argentino, con potencial de expansión regional. El contexto es una economía donde la logística formal resulta costosa, fragmentada y geográficamente concentrada en centros urbanos, dejando fuera a poblaciones de zonas periféricas y del interior del país. A su vez, existe una creciente cultura de economía colaborativa (Uber, Airbnb, Rappi) que ha demostrado la disposición del usuario argentino a interactuar con desconocidos mediante una plataforma tecnológica.

La plataforma aplica en escenarios donde dos usuarios deben intercambiar un objeto físico sin que exista infraestructura logística formal, o donde esa infraestructura es significativamente más costosa que el objeto mismo. Ejemplos representativos incluyen: envíos entre ciudades/pueblos del interior, documentos urgentes, repuestos, regalos, llaves, cargadores, medicamentos, entre otros.

## Diagnóstico: Necesidades y Problemas Identificados

### Problema 1 - Cobertura Logística Desigual

Los grandes operadores logísticos (Correo Argentino, Andreani, OCA) concentran su infraestructura en zonas de alta densidad poblacional. La cobertura en localidades pequeñas es limitada, intermitente o directamente inexistente. Esto genera exclusión logística para millones de ciudadanos.

### Problema 2 - Costos Desproporcionados

El costo de envío de un objeto pequeño entre dos ciudades de la provincia de Córdoba puede superar el valor del mismo cuando se utilizan servicios formales. Esto es económicamente inviable para gran parte de la población, especialmente en contextos de alta inflación.

### Problema 3 - Falta de Confianza en la Logística P2P Informal

Actualmente existen soluciones informales y parciales (grupos de WhatsApp de \"¿alguien viaja a X?\", publicaciones en Facebook Marketplace), pero carecen de mecanismos de confianza, trazabilidad y resolución de conflictos. No hay garantía de que el paquete llegue, de que no sea abierto, ni de que se paguen los acuerdos.

### Problema 4 - Ausencia de Mecanismos de Pago Seguros en Transacciones P2P

Las transacciones informales se realizan en efectivo con acuerdos verbales, sin respaldo contractual. Ante un incumplimiento, no existe mecanismo de compensación ni arbitraje.

### Problema 5 - Desaprovechamiento de Capacidad Logística Existente

Cientos de personas se movilizan a diario con espacio libre en sus vehículos, bolsos o mochilas. Esta capacidad instalada no aprovechada podría resolver parte del problema logístico del país sin requerir nueva infraestructura.

## Contexto Competitivo

+-------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **Competidor / Referente**                                                                                                                | **Diferencia con Movo**                                                                                                                                                                                                                                           |
+===========================================================================================================================================+===================================================================================================================================================================================================================================================================+
| Correo Argentino / Andreani / OCA                                                                                                         | Logística centralizada, costosa, sin modelo P2P ni identidad digital.                                                                                                                                                                                             |
+-------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| Rappi / PedidosYa                                                                                                                         | Enfocado en delivery urbano de corta distancia. Couriers dependientes. Sin KYC avanzado ni viajes declarados.                                                                                                                                                     |
+-------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| Treggo / Rapiboy                                                                                                                          | Última milla B2B/B2C. No permite transporte por usuarios particulares con viajes propios.                                                                                                                                                                         |
+-------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| Mercado Envíos                                                                                                                            | Integrado al ecosistema Mercado Libre. No es P2P ni permite la monetización de viajes personales.                                                                                                                                                                 |
+-------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| Grupos de WhatsApp o Facebook informales                                                                                                  | Sin tecnología, trazabilidad, garantías ni sistema de pagos.                                                                                                                                                                                                      |
+-------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

# Procesos Involucrados

Esta sección describe el panorama actual de los procesos de logística P2P informal tal como existen hoy, sin la intervención de una plataforma como Movo. El análisis cubre la descripción de cada proceso, el flujo operativo, los participantes involucrados, la información que manejan y los sistemas o herramientas que utilizan actualmente.

El objetivo es establecer una línea base (estado AS-IS) que permita contrastar con claridad qué problemas resuelve la solución propuesta y en qué dimensiones agrega valor.

![Mapa de procesos de la logística P2P informal en su estado actual (AS-IS).](diagrama:mapa-procesos-asis)

Para poder entender el impacto de la solución propuesta, es necesario describir primero el estado actual del proceso. El mapa global que se presenta a continuación refleja cómo se organiza hoy la logística P2P informal en Argentina, identificando tres capas de procesos:

## Procesos Estratégicos

Los procesos estratégicos son aquellos que definen cómo los participantes establecen las condiciones de confianza, coordinación y responsabilidad antes de iniciar una operación logística. En el esquema informal actual, estos procesos ocurren de forma completamente no estructurada.

### Gestión de Confianza

Descripción: En la logística P2P informal, la confianza entre emisor y transportista se construye exclusivamente a partir de relaciones personales preexistentes. Una persona solo confía su paquete a alguien que conoce directamente, o que le fue recomendado por un conocido de confianza (red de contactos de primer o segundo grado).

**Flujo actual:**

1.  El emisor necesita enviar un paquete.

2.  Busca en su red personal si alguien viaja al destino en la fecha requerida.

3.  Contacta a esa persona (conocida o recomendada) por WhatsApp u otro canal.

4.  Evalúa si puede confiarle el paquete en base a referencias informales.

5.  Llegan a un acuerdo verbal de condiciones.

**Participantes:**

-   Emisor: quien necesita enviar el paquete.

-   Transportista informal: persona de confianza que realiza el viaje.

-   Red de referencias: contactos comunes que avalan al transportista.

**Información que manejan:**

-   Nombre del transportista y relación personal con el emisor.

-   Referencias verbales no documentadas.

-   Histórico informal de \'viajes anteriores\' basado en la memoria personal.

**Sistemas existentes:**

-   WhatsApp (canal principal de contacto y consulta).

-   Facebook / grupos de WhatsApp temáticos del estilo \'alguien viaja a X?\'.

-   Boca a boca como mecanismo de reputación no estructurado.

**Brecha crítica:**

El mecanismo de confianza no escala. Solo funciona dentro de una red de contactos acotada. Quien no tiene esa red queda excluido del sistema. Además, la confianza no es cuantificable ni transferible: dos personas pueden tener referencias opuestas sobre el mismo transportista sin que exista forma de resolver la contradicción.

### Coordinación

Descripción: Una vez establecida la confianza mínima, el emisor y el transportista coordinan verbalmente las condiciones del envío. No existe ningún contrato ni acuerdo formal. Todo se pacta de palabra.

**Flujo actual:**

1.  El emisor informa al transportista el origen, destino, naturaleza del paquete y fecha.

2.  Se acuerda un precio de manera informal.

3.  Se coordina lugar y hora de retiro del paquete.

4.  No se documenta ningún acuerdo.

**Participantes:**

-   Emisor y Transportista.

**Información que manejan:**

-   Fecha y hora de retiro.

-   Lugar de retiro (domicilio rough o punto de encuentro acordado).

-   Precio pactado verbalmente.

-   Descripción informal del paquete.

**Sistemas existentes:**

-   WhatsApp o llamada telefónica.

**Brecha crítica:**

No existe un acuerdo vinculante. Si el transportista no se presenta o el precio cambia, no hay mecanismo de reclamación. La información de la coordinación no queda registrada en ningún lugar accesible por ambas partes.

### Gestión del Riesgo

Descripción: En el esquema informal, el riesgo del envío es asumido individualmente por cada parte. No hay un sistema de responsabilidades claramente asignadas, ni garantías, ni mecanismo de compensación ante un incidente.

**Flujo actual:**

1. El emisor asume el riesgo de que el paquete se pierda, llegue danado o no sea entregado.

2. El transportista asume el riesgo de no cobrar el servicio.

3. Si ocurre un incidente, la resolución depende de la voluntad de las partes.

4. No existe arbitraje, seguro, ni constancia del estado del paquete al momento del retiro.

**Participantes:**

-   Emisor, Transportista, Receptor.

**Información que manejan:**

-   Ninguna de carácter formal. El riesgo no está documentado.

**Sistemas existentes:**

-   Ninguno. No existe sistema de gestión de riesgo en este esquema.

**Brecha crítica:**

La asunción individual del riesgo es el principal inhibidor de adopción masiva de la logística P2P informal. Quien no conoce personalmente al transportista no tiene forma de mitigar el riesgo, por lo que directamente no opera.

## Procesos Operativos

Los procesos operativos representan el flujo físico del paquete: desde que el emisor lo declara disponible hasta que el receptor lo recibe. Son los procesos centrales del negocio y los que mayor fricción presentan en el esquema informal actual.

### Etapa 1: Solicitud

Descripción: El emisor necesita enviar un paquete y busca de manera reactiva si alguien de su red viaja al destino. No existe un mercado donde publicar la solicitud. Todo depende de la red de contactos disponible en ese momento.

**Flujo actual:**

1. El emisor identifica la necesidad de envío.

2. Consulta en grupos de WhatsApp o Facebook: \'¿alguien viaja a [ciudad] esta semana?\'.

3. Espera respuestas de manera pasiva.

4. Evalúa las respuestas en base al conocimiento personal de los que responden.

5. Contacta al candidato elegido y acuerda las condiciones verbalmente.

**Participantes:**

-   Emisor (único actor activo en esta etapa).

**Información que manejan:**

-   Destino requerido, fecha aproximada, descripción verbal del paquete.

-   Sin campos estructurados ni datos estandarizados.

**Sistemas existentes:**

-   WhatsApp (grupos comunitarios, vecinales, de trabajo).

-   Facebook Marketplace / grupos de la ciudad o localidad.

**Brecha crítica:**

La solicitud es reactiva y limitada a la red de contactos del emisor. No hay matching automático, no hay visibilidad para transportistas fuera de esa red, y no hay estructura de datos para comparar opciones. El tiempo que demora encontrar transportista es altamente variable e impredecible.

### Etapa 2: Retiro

Descripción: El transportista pasa a retirar el paquete del domicilio del emisor en el momento acordado verbalmente. No hay verificación de identidad, ni registro del estado del paquete al momento del retiro.

**Flujo actual:**

1. El transportista se dirige al domicilio del emisor a la hora pactada.

2. El emisor entrega el paquete de mano a mano.

3. No se toman fotos del estado del paquete.

4. No se firma ningún recibo ni se genera ningún registro digital.

5. El transportista parte con el paquete bajo su responsabilidad informal.

**Participantes:**

-   Emisor y Transportista.

**Información que manejan:**

-   Domicilio de retiro (coordenadas o descripción aproximada).

-   Hora pactada (no confirmada formalmente).

-   Sin evidencia fotográfica del estado del paquete.

**Sistemas existentes:**

-   GPS personal del transportista para orientarse.

-   WhatsApp para avisar que está llegando o que ya se retiró.

**Brecha crítica:**

La ausencia de evidencia fotográfica al momento del retiro imposibilita cualquier reclamo posterior sobre el estado del paquete. Si el paquete llega danado, no hay forma de determinar si el daño ocurrió antes o después del retiro.

### Etapa 3: Envío y Traslado

Descripción: El paquete viaja con el transportista. Esta es la etapa de mayor opacidad: el emisor y el receptor no tienen ninguna visibilidad sobre dónde está el paquete ni cuando llegará.

**Flujo actual:**

1. El transportista lleva el paquete durante su viaje normal.

2. No hay actualización de estado ni tracking.

3. El emisor o receptor pueden contactar al transportista por WhatsApp para preguntar.

4. La respuesta depende de la voluntad y disponibilidad del transportista.

**Participantes:**

-   Transportista (único actor activo en esta etapa).

**Información que manejan:**

-   Ninguna de carácter sistemático. Solo el transportista sabe donde está el paquete.

**Sistemas existentes:**

-   Ninguno para trazabilidad. WhatsApp para consultas puntuales.

**Brecha crítica:**

La opacidad total durante el traslado genera máxima ansiedad en el emisor y el receptor. No hay hora estimada de entrega, no hay confirmación de que el paquete todavía está con el transportista, y no hay forma de reaccionar ante un desvío o demora.

### Etapa 4: Entrega

Descripción: El transportista entrega el paquete al receptor. No hay verificación de identidad del receptor, ni firma de recepción, ni evidencia digital que certifique que la entrega ocurre.

**Flujo actual:**

1. El transportista contacta al receptor (generalmente por WhatsApp) al llegar al destino.

2. El receptor se acerca al lugar de encuentro acordado.

3. La entrega se realiza de mano a mano.

4. No se toman fotos, no se firma nada, no hay confirmación digital.

5. El transportista cobra (si aún no lo había hecho) o da el paquete gratuitamente.

**Participantes:**

-   Transportista y Receptor.

**Información que manejan:**

-   Nombre del receptor (informal, no verificado).

-   Lugar de entrega acordado verbalmente.

**Sistemas existentes:**

-   WhatsApp para coordinación de último momento.

**Brecha crítica:**

No existe ninguna constancia de que la entrega ocurre. Si el receptor niega haberlo recibido, el transportista no tiene forma de demostrarlo. Si el emisor pagó por adelantado y la entrega no ocurre, no tiene recurso. Este es el punto de mayor exposición al fraude y al conflicto.

## Procesos de Apoyo

Los procesos de apoyo son transversales al flujo operativo. No forman parte del flujo central del paquete pero son habilitadores críticos: sin comunicación, sin pago y sin reputación, el proceso operativo no puede ocurrir. En el esquema informal actual, estos procesos de apoyo son los de mayor precariedad.

### Comunicación

Descripción: Toda la comunicación entre los participantes ocurre fuera de cualquier sistema especializado. Los canales utilizados son de propósito general (mensajería y redes sociales) y no ofrecen ningún valor específico para la logística.

**Participantes:**

-   Emisor, Transportista, Receptor.

**Canales existentes:**

-   WhatsApp: coordinación de detalles, actualizaciones de estado informales.

-   Facebook Messenger / grupos: contacto inicial y publicación de solicitudes.

-   Llamada telefónica: para urgencias o cuando el mensaje no es suficiente.

**Información que manejan:**

-   Precio, horarios, lugares de encuentro.

-   Actualizaciones de estado informales (\'ya salí\', \'ya llegué\', \'ya te lo dejé\').

**Brecha crítica:**

La comunicación está entremezclada con conversaciones personales. No hay separación entre el contexto logístico y el personal. No hay historial estructurado del envío. Ante un conflicto, reconstruir la línea de hechos a partir de chats es tedioso y fácilmente manipulable.

### Pago Informal

Descripción: Los pagos se realizan sin ningún sistema de gestión. El acuerdo económico es verbal y la ejecución puede ser en efectivo o por transferencia bancaria directa, sin ningún vínculo formal con el objeto del envío.

**Participantes:**

-   Emisor y Transportista (en algunos casos, el Receptor paga al recibir).

**Mecanismos de pago existentes:**

-   Efectivo: entregado al momento del retiro o de la entrega.

-   Transferencia bancaria o Mercado Pago directo: sin referencia del envío.

**Información que manejan:**

-   Monto acordado verbalmente.

-   Sin comprobante vinculado al envío específico.

**Brecha crítica:**

No existe hold de fondos. Si el emisor paga por adelantado y la entrega no se realiza, pierde el dinero sin recurso. Si el transportista entrega y el emisor no paga, el transportista tampoco tiene recurso. El pago desvinculado del resultado del envío es el principal generador de conflictos en el esquema informal.

### Gestion de Reputacion

Descripción: La reputación de los participantes se construye y circula de manera completamente informal, a través de referencias personales no documentadas. No existe ningún sistema que agregue, estructure o verifique esta información.

**Participantes:**

-   Comunidad de usuarios (emisores, transportistas, receptores).

**Mecanismos existentes:**

-   Boca a boca entre conocidos.

-   Comentarios en grupos de Facebook (públicos, no estructurados).

-   Referencias informales en conversaciones de WhatsApp.

**Información que manejan:**

-   Opiniones verbales no verificables, sin historial digital.

**Brecha crítica:**

La reputación informal no es acumulable ni portable. Un transportista puede ser muy reconocido en su red local pero desconocido por completo fuera de ella. No existe ninguna forma de que alguien fuera de la red acceda a esa reputación. Esto limita estructuralmente la escala del sistema.

### Resolución de Disputas

Descripción: No existe ningún mecanismo formal de resolución de conflictos. Cuando ocurre un incidente (paquete perdido, danado, no entregado, pago incumplido), la resolución depende exclusivamente de la voluntad de las partes o del acceso a instancias legales costosas y desproporcionadas para el valor de la disputa.

**Participantes:**

-   Emisor, Transportista, Receptor (según la naturaleza del conflicto).

**Mecanismos existentes:**

-   Ninguno formal o especializado.

-   Presión social informal en grupos de Facebook o WhatsApp.

-   En casos extremos, denuncia policial o judicial (rara vez justificable económicamente).

**Información que manejan:**

-   Conversaciones de WhatsApp como única evidencia (manipulable y desestructurada).

**Brecha crítica:**

La ausencia de mecanismo de resolución es el inhibidor más fuerte para la adopción masiva. Los usuarios racionales no operan con desconocidos cuando saben que no hay recurso ante un incumplimiento. Este es el factor que mantiene al sistema informal bloqueado en redes de confianza pequeñas.

## Diagnóstico del Estado de los Procesos

El siguiente análisis sintetiza las brechas más críticas identificadas en el relevamiento de los procesos actuales. Cada brecha representa una dimensión en la que el esquema informal falla sistemáticamente y que la plataforma Movo está diseñada para resolver.

+-----------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------+-----------------------------------------------------------------------------------------------------------------------------------+
| **Dimensión**                                                                                                                     | **Estado AS-IS**                                                                                                                    | **Brecha identificada**                                                                                                           |
+===================================================================================================================================+=====================================================================================================================================+===================================================================================================================================+
| **Confianza**                                                                                                                     | Basada en relaciones personales preexistentes.                                                                                      | Excluye a quienes no tienen red. No escala.                                                                                       |
+-----------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------+-----------------------------------------------------------------------------------------------------------------------------------+
| **Coordinación**                                                                                                                  | Verbal / WhatsApp / Redes Sociales.                                                                                                 | Sin trazabilidad, sin acuerdo vinculante.                                                                                         |
+-----------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------+-----------------------------------------------------------------------------------------------------------------------------------+
| **Riesgo logístico**                                                                                                              | Asumido individualmente, sin contrato.                                                                                              | Sin mecanismo de compensación ante pérdida o daño.                                                                                |
+-----------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------+-----------------------------------------------------------------------------------------------------------------------------------+
| **Pago**                                                                                                                          | Efectivo o transferencia directa.                                                                                                   | Sin hold de fondos. Sin arbitraje en caso de disputa.                                                                             |
+-----------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------+-----------------------------------------------------------------------------------------------------------------------------------+
| **Trazabilidad**                                                                                                                  | Ninguna (el paquete viaja \'a ciegas\').                                                                                            | El emisor no sabe si el paquete llegará.                                                                                          |
+-----------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------+-----------------------------------------------------------------------------------------------------------------------------------+
| **Reputación**                                                                                                                    | Boca a boca no estructurado.                                                                                                        | Sin historial digital verificable.                                                                                                |
+-----------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------+-----------------------------------------------------------------------------------------------------------------------------------+
| **Resolución de conflictos**                                                                                                      | Ninguna formal.                                                                                                                     | La parte afectada no tiene recurso disponible.                                                                                    |
+-----------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------+-----------------------------------------------------------------------------------------------------------------------------------+

## Actores del Entorno

Además de los tres participantes directos del proceso (Emisor, Transportista, Receptor), el entorno de la logística P2P informal incluye actores externos que condicionan o participan indirectamente en el sistema:

+------------------------------------------------------------------------------------------------+---------------------------------------------------------------------------------------------------------+------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------+
| **Actor**                                                                                      | **Descripción**                                                                                         | **Rol**                                                                                        | **Participación en el proceso**                                                                 |
+================================================================================================+=========================================================================================================+================================================================================================+=================================================================================================+
| Emisor                                                                                         | Quien necesita enviar el paquete.                                                                       | Directo                                                                                        | Genera la solicitud de envío. Paga por el servicio.                                             |
+------------------------------------------------------------------------------------------------+---------------------------------------------------------------------------------------------------------+------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------+
| Transportista informal                                                                         | Persona que viaja y acepta llevar el paquete.                                                           | Directo                                                                                        | Ejecuta el traslado. Recibe el pago.                                                            |
+------------------------------------------------------------------------------------------------+---------------------------------------------------------------------------------------------------------+------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------+
| Receptor                                                                                       | Quien recibe el paquete en destino.                                                                     | Directo                                                                                        | Acepta o rechaza recibir el paquete.                                                            |
+------------------------------------------------------------------------------------------------+---------------------------------------------------------------------------------------------------------+------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------+
| Red de contactos / comunidad                                                                   | Grupos de WhatsApp, Facebook, vecinos.                                                                  | Indirecto                                                                                      | Facilita el matching y la reputación informal.                                                  |
+------------------------------------------------------------------------------------------------+---------------------------------------------------------------------------------------------------------+------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------+
| Operadores logísticos formales                                                                 | Correo Argentino, Andreani, OCA.                                                                        | Contexto                                                                                       | Son la alternativa formal, más cara e inaccesible en muchas zonas.                              |
+------------------------------------------------------------------------------------------------+---------------------------------------------------------------------------------------------------------+------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------+
| Plataformas de pago                                                                            | Mercado Pago, bancos, billeteras digitales.                                                             | Indirecto                                                                                      | Canalizan los pagos informales entre los participantes.                                         |
+------------------------------------------------------------------------------------------------+---------------------------------------------------------------------------------------------------------+------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------+

# Propuesta Detallada del Producto

## Alcance del Proyecto

### Incluye

-   Aplicación móvil multiplataforma (iOS y Android) desarrollada en React Native (con EXPO).

-   Backend API REST con Node.js (Express o Fastify) y FastAPI (Python).

-   Base de datos relacional (PostgreSQL) para datos transaccionales y usuarios.

-   Base de datos en memoria (Redis) para caché, sesiones y WebSocket state.

-   Integración completa con la API de Mercado Pago (Auth & Capture, Split Payments, Marketplace).

-   Integración con Didit.me para KYC biométrico y verificación documental.

-   Protocolo de "Cryptographic Handshake\" con QR dinámico y validación GPS.

-   Motor de precios dinámico con variables de distancia, peso, urgencia y demanda.

-   Sistema de subastas (bidding) para transportistas sobre envíos publicados.

-   Algoritmo de optimización de rutas para viajes declarados por transportistas.

-   Seguimiento en tiempo real con actualizaciones de posición (WebSockets).

-   Sistema de reputación bidireccional y perfiles sociales de usuario.

-   Registro de evidencia fotográfica en puntos clave del flujo.

-   Aplicación web en [*Next.js*](http://next.js) para el Panel de administración básico para monitoreo operacional, BI y resolución de disputas.

-   Funcionalidades de chat en tiempo real entre usuarios (el sistema provee estados de envío y notificaciones así como chat en tiempo real entre usuarios de una transacción).

-   Swagger para documentación de los endpoints.

-   Postman para probar los endpoints.

### No Incluye (Fuera de Alcance)

-   Integración con otros proveedores de pago distintos de Mercado Pago en la versión inicial.

-   Seguro de carga (contemplado como funcionalidad futura).

-   Aplicación web para usuarios finales (solo móvil en el alcance del PF).

-   Gestión de logística en módulo B2B o B2C o integración con ERPs empresariales.

-   Blockchain pública o red distribuida para el registro de transferencias (se usa almacenamiento centralizado con firmas criptográficas verificables en MVP).

-   Integración con operadores logísticos tradicionales (Correo Argentino, Andreani, etc.).

## Listado Completo de Funcionalidades

### Módulo 1 - Identidad y Onboarding

-   Registro de usuario con validación de email y teléfono (OTP).

-   KYC biométrico y documental mediante Didit.me (liveness detection + verificación de DNI).

-   Perfil público de usuario con: nombre, foto, score de reputación, cantidad de envíos realizados/recibidos/transportados, reseñas de otros usuarios.

-   Validación adicional para transportistas: carga y verificación de licencia de conducir, y registro obligatorio de tarjeta de crédito/débito para cobro de comisiones.

### Módulo 2 - Solicitud y Gestión de Envíos (Pestaña \"Enviar\")

-   Alta de nuevo envío con campos: receptor, fecha de retiro, dirección de retiro, dirección de entrega.

-   Categorización del paquete en tipos predefinidos:

    -   \"Carta o documento\" (sobres, hojas, documentación)

    -   \"Encomienda estándar\" (paquete común)

    -   \"Ítem cotidiano\" (categoría para objetos de uso diario: llaves, cargadores, auriculares, etc.)

    -   \"Objeto frágil\" (requiere manejo especial)

    -   \"Ítem urgente\" (prioridad alta en el motor de precios)

-   Precio sugerido calculado por el motor de precios dinámico.

-   Flujo de aceptación del receptor (notificación push con botón \"Aceptar / Rechazar envío\").

-   Visualización del listado de ofertas de transportistas con: precio ofertado, score de reputación, vehículo, tiempo estimado.

-   Selección y confirmación de transportista por parte del emisor.

-   Historial de envíos realizados con estados y línea de tiempo.

### Módulo 3 - Transporte de Paquetes (Pestaña \"Transportar\")

-   Vista de envíos disponibles en la ciudad/región del transportista.

-   Filtro \"Declaro un viaje\": el transportista ingresa origen, destino, fecha y hora de partida.

-   Sugerencia automática de paquetes compatibles con la ruta declarada (motor logístico).

-   Visualización de ruta optimizada con puntos de retiro y entrega en el mapa.

-   Sistema de ofertas: el transportista puede aceptar el precio sugerido o enviar una contraoferta.

-   Confirmación de la asignación y bloqueo de fondos en la tarjeta del emisor.

-   Ejecución del envío con live tracking activo.

-   Registro de fotografías al retirar y entregar cada paquete.

-   Ejecución del Cryptographic Handshake (QR / NFC) para retiro y entrega.

### Módulo 4 - Seguimiento y Notificaciones

-   Mapa en tiempo real del transportista visible para el emisor y el receptor.

-   Notificaciones push en eventos clave: paquete retirado, en camino, entregado.

-   Hora estimada de retiro y hora estimada de entrega, actualizadas dinámicamente.

-   Historial de posiciones del transportista durante el envío (auditoría).

-   Sistema de conversación (chat en tiempo real) durante el proceso de envío del paquete.

### Módulo 5 - Pagos

-   Integración con Mercado Pago Connect (modelo Marketplace / Split Payments).

-   Hold (reserva de fondos) en tarjeta del emisor al confirmar el transportista.

-   Liberación automática del hold y split payment al completarse el Cryptographic Handshake de entrega.

-   Pago en efectivo: el transportista cobra al receptor en mano. La comisión de Movo se cobra automáticamente en la tarjeta precargada del transportista.

-   Historial de transacciones para el emisor, receptor y transportista.

-   Gestión de devoluciones parciales o totales en caso de cancelación con transportista ya asignado.

### Módulo 6 - Reputación y Feedback

-   Sistema de calificación de 1 a 5 estrellas post-entrega para: emisor, transportista y receptor.

-   Comentarios libres (texto) en cada calificación.

-   Perfil público que agrega todas las calificaciones recibidas con score promedio ponderado.

-   Protección anti-fraude: las calificaciones se habilitan únicamente después de la confirmación de entrega por ambas partes.

## Mapa Global de Procesos

Los procesos de Movo se organizan en tres grandes dominios: el dominio de Identidad y Confianza, el dominio de Operaciones Logísticas y el dominio de Pagos y Economía. Estos dominios interactúan con un conjunto de sistemas de soporte transversales.

![Mapa global de procesos de Movo (TO-BE), agrupado en procesos estratégicos, operativos y de apoyo.](diagrama:mapa-procesos-tobe)

| Identidad y confianza | Operaciones logísticas | Pagos y economía |
|---|---|---|
| P1 - Registro y KYC | P5 - Solicitud de envío | P13 - Reserva de fondos (hold) |
| P2 - Reputación y feedback | P6 - Aceptación del receptor | P14 - Captura y split payment |
| P3 - Validación adicional (transportista) | P7 - Motor de precios y subastas | P15 - Cobro de comisión en efectivo |
| | P8 - Asignación de transportista | P16 - Gestión de disputas y reembolsos |
| | P9 - Optimización logística de ruta | |
| | P10 - Ejecución y tracking en tiempo real | |
| | P11 - Cryptographic handshake | |
| | P12 - Registro de evidencia fotográfica | |

: Procesos de Movo por dominio.

## Descripción Detallada de Procesos

### P1 - Registro y KYC (Know Your Customer)

Todo usuario que quiera participar de la plataforma (ya sea como emisor, transportista o receptor) debe completar un proceso de verificación de identidad antes de poder realizar transacciones. El KYC se implementa mediante la integración con Didit.me, plataforma especializada en verificación biométrica y documental.

**Participantes:**

-   Usuario (solicitante del registro)

-   Didit.me (proveedor externo de KYC)

-   Sistema Movo (backend)

**Flujo del proceso:**

1. El usuario descarga la app e ingresa sus datos básicos (nombre, email, número de teléfono).

2. El sistema invoca la API de Didit.me para iniciar una sesión de verificación.

3. Didit.me solicita captura de documento de identidad (DNI frente y dorso) y selfie biométrica.

4. Didit.me realiza liveness detection para asegurar que la persona está presente y no es una foto o video.

5. Didit.me devuelve un resultado de verificación: aprobado, rechazado o pendiente de revisión manual.

6. El usuario queda habilitado para operar en la plataforma.

**Información manejada:**

-   DNI (frente y dorso) - procesado por Didit.me, Movo no almacena imágenes de documentos.

-   Datos biométricos - procesados por Didit.me, resultado enviado como score/booleano.

-   Score de confianza inicial - asignado post-KYC.

### P5 - Solicitud de Envío

El usuario emisor accede a la pestaña \"Enviar\" e inicia el proceso de alta de un nuevo envío. Este proceso implica la definición del paquete, la identificación del receptor, la fijación de condiciones (fecha, precio sugerido) y la validación por parte del receptor.

**Participantes:**

-   Emisor (usuario que origina el envío)

-   Receptor (usuario destinatario, debe estar registrado en Movo)

-   Sistema Movo (motor de precios, validaciones)

**Flujo del proceso:**

1. El emisor selecciona la opción \"Nuevo envío\".

2. Indica la fecha y horario en que el paquete puede ser retirado.

3. Identifica al receptor mediante usuario registrado en Movo (búsqueda por nombre).

4. Describe el paquete: tipo (ver categorías en sección de Funcionalidades), dimensiones (manual), peso aproximado.

5. El sistema calcula un precio sugerido mediante el motor de precios dinámico.

6. El sistema envía una notificación al receptor para que acepte o rechace el envío.

7. El receptor acepta el envío: queda registrada su conformidad como destinatario.

8. El envío queda en estado \"En espera de transportista\" y se publica en el tablero de oportunidades.

### P6 - Aceptación del Receptor

Movo requiere que el receptor explícitamente acepte recibir el envío antes de que éste sea publicado al mercado de transportistas. Esto previene el envío de paquetes no solicitados y protege la privacidad del receptor.

### P7 - Motor de Precios y Subastas

El motor de precios calcula una tarifa base para cada envío en función de variables cuantificables. Los transportistas pueden aceptar el precio sugerido o presentar contraofertas. El emisor tiene visibilidad del ranking de ofertas combinado con el score de reputación del transportista.

**Variables del motor de precios:**

-   Distancia de la ruta (origen → destino), calculada con Google Maps Distance Matrix API.

-   Peso y volumen declarado del paquete.

-   Urgencia declarada por el emisor (estándar / urgente / flexible).

-   Índice de demanda actual en esa ruta (ratio oferta/demanda de transportistas disponibles).

-   Precio referencial del combustible en la región (fuente: API de precios oficiales o scraping).

-   Categoría del paquete (documentos, frágil, estándar, etc.).

**Fórmula base conceptual:**

> **Tarifa** = (Distancia × TarifaKm) + (Peso × TarifaKg) + BonusUrgencia + FactorDemanda

### P9 - Optimización Logística de Ruta

Cuando un transportista declara un viaje (origen → destino con fecha y hora), el sistema identifica envíos compatibles en esa ruta o en rutas con desvíos aceptables. El matching no se resuelve únicamente por distancia y desvío geográfico: el sistema también valida que la fecha del viaje declarado caiga dentro del rango de retiro solicitado por el envío (pickup_date_start--pickup_date_end). Un envío geográficamente compatible pero fuera de ese rango de fechas no se ofrece como candidato. El algoritmo de optimización busca maximizar el número de paquetes entregados minimizando el desvío total del transportista respecto a su ruta original, dentro del subconjunto de envíos que ya superó el filtro de ventana de fechas.

**Algoritmo aplicado:**

Se aplica una variante del Vehicle Routing Problem with Time Windows (VRPTW), y no un TSP simple: el sistema no solo necesita optimizar el orden de las paradas, sino descartar candidatos cuya ventana de fecha/hora de retiro no es compatible con el viaje declarado --- exactamente el tipo de restricción que VRPTW modela de forma nativa y que un TSP puro no contempla. Haber elegido VRPTW desde el arranque, en lugar de partir de un TSP simple y agregarle restricciones de tiempo más adelante, evitó tener que rediseñar el modelo cuando se incorporó la validación de rango de fechas al matching. Se considera el punto de origen declarado por el transportista, los puntos de retiro y entrega de cada paquete compatible, y el punto de destino final. El objetivo es minimizar la distancia total sujeto tanto a las ventanas horarias como a las ventanas de fecha comprometidas con el emisor.

**Ejemplo de operación:**

-   Transportista declara viaje: Córdoba Capital → Luque (distancia: \~100 km).

-   Sistema detecta un envío en Villa del Rosario (en ruta), con desvío de 6 km.

-   Sistema detecta un segundo envío en Jesús María (desvío de 12 km sobre la ruta original).

-   El transportista puede aceptar ambos envíos adicionales. El sistema recalcula la ruta óptima y actualiza los tiempos estimados.

### P10 - Ejecución y Seguimiento en Tiempo Real

Una vez confirmado el transportista, el envío pasa al estado de ejecución. El sistema muestra al emisor y al receptor la ubicación del transportista, hora estimada de retiro y hora estimada de entrega, bajo un modelo de consulta bajo demanda (similar a Find My / Buscar de Apple) en lugar de streaming continuo: cuando el emisor o el receptor abren el mapa, el backend dispara una notificación push silenciosa al dispositivo del transportista solicitando que reporte su posición actual, y esa posición se muestra en el mapa junto con el timestamp de la consulta. Si el transportista no responde dentro de un timeout configurado, o si la notificación silenciosa no llega a entregarse (limitación conocida de iOS, donde el sistema operativo no garantiza la entrega de silent push notifications), el mapa muestra la última posición conocida junto con un indicador de antigüedad (\"hace X minutos\"). Este modelo evita mantener una conexión de streaming constante consumiendo batería del transportista, y es consistente con el resto del diseño de tracking on-demand del sistema.

### P11 - Cryptographic Handshake (Transferencia de Custodia)

El protocolo de transferencia de custodia garantiza que el cambio de posesión del paquete entre dos partes ocurrió de manera verificable, con ambas partes físicamente presentes. Se implementa en dos momentos clave: retiro (emisor → transportista) y entrega (transportista → receptor).

**Mecanismo técnico - QR dinámico (MVP):**

1. La app del usuario que cede la custodia (emisor en el retiro, transportista en la entrega) genera un desafío criptográfico único (nonce) firmado con la clave privada del usuario.

2. Este desafío se codifica en un QR de vida corta (TTL de 15 segundos).

3. El usuario que recibe la custodia escanea el QR. La app verifica la firma digital del nonce usando la clave pública del cedente.

4. Simultáneamente, el sistema verifica que ambos dispositivos se encuentran en un radio de proximidad configurado (geofencing, típicamente 50--100 metros) mediante coordenadas GPS con timestamp.

5. Si ambas verificaciones son exitosas (firma válida + proximidad confirmada), se registra un evento inmutable de transferencia de custodia en el backend con timestamp, coordenadas, hash del QR y firmas de ambas partes.

6. Si alguna verificación falla, la transacción se bloquea y se notifica a ambas partes.

**Mecanismo alternativo - NFC (post-MVP):**

En dispositivos compatibles, la firma criptográfica puede intercambiarse mediante NFC (Near Field Communication), simplificando el proceso a un acercamiento de teléfonos. El protocolo criptográfico subyacente es idéntico al del QR.

### P12 - Registro de Evidencia Fotográfica

Para garantizar trazabilidad del estado del paquete, el sistema solicita fotografías en los siguientes momentos:

-   Al momento de solicitar el envío: el emisor fotografía el paquete sellado y en condiciones de envío.

-   Al momento del retiro: el transportista fotografía el paquete al recibirlo del emisor.

-   Al momento de la entrega: el transportista fotografía el paquete. El receptor acepta el estado al recibirlo escaneando el QR.

### P13-P15 - Gestión de Pagos

El sistema de pagos se diseña en torno a tres principios: (1) el dinero del emisor está seguro y bloqueado hasta la confirmación de entrega, (2) el transportista recibe el pago inmediatamente después de la entrega confirmada, (3) Movo cobra únicamente su comisión sobre el total de la transacción, sin ser intermediario del total del pago.

*Ver Sección 5.4 para descripción técnica detallada del sistema de pagos.*

## Flujograma Punta-a-Punta del proceso principal de envio

La Figura siguiente muestra el recorrido completo de un envío, desde el registro de las partes hasta la actualización de la reputación, distribuido en calles según quién ejecuta cada actividad.

![Flujo punta a punta del proceso principal de envío (diagrama de actividad UML).](diagrama:ei-flujo-punta-a-punta){.pagina-completa}

# Explicaciones Técnicas Clave

## Sistema KYC con Didit.me

Didit.me es una plataforma de verificación de identidad digital que expone una API REST para flujos de KYC embebidos en aplicaciones móviles y web. La integración en Movo sigue el patrón de verificación delegada: el backend de Movo crea una sesión KYC en Didit.me y el SDK de Didit (embebido en la app) conduce al usuario por el proceso de verificación sin que la app de Movo procese directamente datos biométricos sensibles.

**Flujo de integración técnica:**

1. El backend de Movo llama a POST /sessions en la API de Didit.me enviando el ID de usuario y los tipos de verificación requeridos (document + biometric).

2. Didit devuelve un session_token y una URL de verificación.

3. El SDK de Didit en la app móvil abre un webview con esa URL, conduce el flujo de captura de documentos y selfie.

4. Una vez completado el flujo, Didit notifica al backend de Movo via webhook con el resultado (approved / rejected / manual_review) y un verification_id.

5. El backend de Movo actualiza el estado KYC del usuario y genera su aprobacion si el resultado es aprobado.

**Ventajas de este enfoque:**

-   Movo no almacena imágenes de documentos ni datos biométricos en sus servidores.

-   Reducción de superficie de ataque y de obligaciones regulatorias de protección de datos sensibles.

-   Didit provee detección de vivacidad (liveness) que previene el uso de fotos o videos para bypass.

-   El modelo de precios de Didit (por verificación) es predecible y escala con el volumen de usuarios.

## Cryptographic Handshake - Detalle Técnico

El protocolo de transferencia de custodia de Movo es un mecanismo de autenticación mutua basado en criptografía de clave pública. Cada usuario posee un par de claves (pública/privada) generado localmente en su dispositivo al completar el onboarding.

**Protocolo paso a paso:**

1. El cedente (quien transfiere el paquete) solicita iniciar la transferencia en su app. El backend genera un nonce único (número de uso único, 256 bits de entropía) asociado a esa transacción específica.

2. El cedente firma el nonce con su clave privada: firma = sign(privateKeyCedente, nonce).

3. El sistema codifica {transactionId, nonce, firma} en un QR con TTL de 60 segundos.

4. El receptor escanea el QR. La app del receptor envía {transactionId, nonce, firma, gpsCedente, gpsReceptor} al backend.

5. El backend verifica: (a) la firma del cedente usando su clave pública, (b) que el nonce no haya sido usado antes, (c) que el TTL no haya expirado, (d) que la distancia entre gpsCedente y gpsReceptor sea menor al umbral configurado (default: 100m).

6. Si todas las verificaciones pasan, el backend registra el evento de transferencia con timestamp, coordenadas, hash del nonce. El estado del envío se actualiza.

**Propiedades de seguridad garantizadas:**

-   Imposibilidad de replay: el nonce es de un solo uso y el TTL limita la ventana de ataque.

-   Imposibilidad de falsificación remota: la firma solo puede generarse con la clave privada del cedente.

-   Verificación de presencia física: la validación GPS impide confirmar entregas sin proximidad real.

-   Inmutabilidad del registro: el evento de transferencia es registrado con hash criptográfico, no puede alterarse sin detección.

## Algoritmo Logístico de Optimización de Rutas

El motor logístico de Movo resuelve una variante del Vehicle Routing Problem with Time Windows (VRPTW) simplificado a un único vehículo (el transportista que declaró el viaje). El objetivo es incorporar paradas intermedias de retiro/entrega que maximicen la utilidad del transportista minimizando el desvío respecto a su ruta declarada.

**Modelo del problema:**

-   Input: ruta declarada R = (origen, destino, horario de salida), conjunto de envíos S disponibles con coordenadas de retiro y entrega, ventanas horarias comprometidas.

-   Output: secuencia óptima de paradas P = [p1, p2, \..., pn] que minimiza distancia total sujeto a restricciones de tiempo.

## Sistema de Pagos con Mercado Pago

El sistema de pagos de Movo se construye sobre dos APIs de Mercado Pago: el mecanismo de Auth & Capture (autorización y captura diferida) y el modelo Marketplace con Split Payments. Ambos mecanismos se utilizan de forma complementaria.

### Modelo Auth & Capture

Cuando el emisor confirma un transportista, la app inicia una autorización de pago (no una captura) mediante la API de Mercado Pago con el parámetro capture: false. Esto reserva (\"bloquea\") el monto en la tarjeta del emisor sin debitarlo efectivamente. El hold puede mantenerse hasta 7 días en Mercado Pago.

Una vez confirmada la entrega mediante el Cryptographic Handshake, el backend de Movo invoca el endpoint de captura (capture: true) sobre la autorización preexistente. El débito efectivo ocurre en ese momento.

Si el envío es cancelado antes del retiro, el backend invoca la cancelación de la autorización, liberando los fondos del emisor sin ningún cargo.

### Modelo Marketplace y Split Payments

Movo opera como Marketplace en el ecosistema de Mercado Pago. Cada transportista conecta su cuenta de Mercado Pago mediante el flujo OAuth (Mercado Pago Connect). Esto le otorga a Movo permisos delegados para procesar pagos en nombre del transportista.

Al realizar la captura, se configura un split payment que distribuye automáticamente el monto: el porcentaje de comisión de Movo se acredita en la cuenta de Movo, y el saldo restante se acredita directamente en la cuenta del transportista.

Esta arquitectura tiene una implicancia fiscal crítica: Movo solo procesa en sus cuentas el porcentaje de comisión, no el total de la transacción. Esto evita que Movo sea considerado como el perceptor del total del pago y por lo tanto evita la retención de Ingresos Brutos (IIBB) provinciales sobre montos que no corresponden a ingresos propios.

### Flujo de Pago en Efectivo

En transacciones en efectivo, el receptor paga al transportista directamente al momento de la entrega. Para garantizar el cobro de la comisión de Movo, todo transportista que ofrezca la modalidad de pago en efectivo debe tener precargada una tarjeta de crédito o débito en la plataforma. Al confirmar la entrega (Cryptographic Handshake), el backend de Movo genera automáticamente un cargo por el monto de la comisión en la tarjeta del transportista.

## Gestión de la Confianza en el Sistema

La confianza en Movo es un atributo multidimensional que se construye y gestiona a través de cuatro capas complementarias:

1. **Confianza de Identidad**: Garantizada por KYC. Todo usuario ha demostrado que es quien dice ser, con documento y biometría verificados.

2. **Confianza Criptográfica**: Garantizada por el Cryptographic Handshake. Las transferencias de custodia son eventos verificables matemáticamente: si el registro dice que el paquete fue entregado, hubo una firma digital válida con presencia física comprobable en ese momento.

3. **Confianza Reputacional**: Construida a lo largo del tiempo mediante el sistema de calificaciones. El score de reputación es público, verificable y difícil de manipular (requiere transacciones reales para incrementarse).

4. **Confianza Financiera**: Garantizada por el mecanismo de hold de pagos. El emisor sabe que su dinero no será debitado hasta que la entrega se confirme. El transportista sabe que recibirá el pago inmediatamente después de la entrega.

# Valor Esperado del Proyecto

## Valor para los Usuarios

### Para el Emisor

-   Acceso a logística P2P en zonas donde los operadores tradicionales no llegan o son prohibitivamente costosos.

-   Precios competitivos determinados por mercado y no por tarifarios fijos.

-   Seguridad financiera mediante el hold de fondos: el dinero no es debitado hasta confirmar la entrega.

-   Trazabilidad completa del estado del paquete en tiempo real.

-   Evidencia fotográfica ante eventuales disputas sobre el estado del paquete.

### Para el Transportista

-   Generación de ingresos adicionales aprovechando viajes que ya se realizan, sin incurrir en costos de combustible adicionales.

-   Algoritmo de optimización que minimiza el desvío necesario para hacer entregas adicionales.

-   Cobro garantizado inmediato post-entrega mediante split payment automatizado.

-   Construcción de reputación digital que aumenta el volumen de oportunidades a lo largo del tiempo.

### Para el Receptor

-   Recepción segura de envíos de personas conocidas (el emisor debe registrarlo explícitamente).

-   Control sobre qué envíos acepta recibir.

-   Tracking en tiempo real del paquete en camino.

-   Posibilidad de delegar la entrega del paquete a otro receptor, en caso de que no lo pueda recibir el.

## Valor para la Sociedad

-   Inclusión logística: poblaciones rurales y del interior acceden a servicios de envío a precios accesibles.

-   Eficiencia en el uso de recursos: se aprovecha la capacidad de transporte ya existente, reduciendo la huella de carbono respecto a envíos exclusivos.

-   Formalización de transacciones que hoy ocurren en economía informal, con beneficios impositivos y de trazabilidad.

## Valor Tecnológico y Académico

-   Aplicación práctica de criptografía asimétrica en un caso de uso de la vida real en el contexto argentino.

-   Integración de múltiples tecnologías emergentes (seguridad criptografica, algoritmos de optimización combinatoria) en un sistema cohesivo.

-   Referente de arquitectura para plataformas P2P con mecanismos de confianza digital en mercados emergentes.

## Modelo de Negocio

Movo opera bajo un modelo de comisión por transacción. La plataforma cobra un porcentaje del valor de cada envío completado exitosamente. Este porcentaje es el único ingreso que Movo procesa en sus cuentas, gracias al mecanismo de split payment. La comisión exacta se definirá en función del análisis competitivo y de costos operativos.

El modelo de ingresos no depende de suscripciones fijas ni de publicidad, lo que alinea los incentivos de Movo con los del usuario: **la plataforma gana cuando el usuario gana.**

## Riesgos Identificados

+---------------------------------------------------------------------------------------------------+---------------------------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------+
| **Riesgo**                                                                                        | **Impacto**                                                                                                                                                   | **Mitigación**                                                                                                                            |
+===================================================================================================+===============================================================================================================================================================+===========================================================================================================================================+
| Cambios en la API de Mercado Pago para cuentas Marketplace                                        | Alto                                                                                                                                                          | Desarrollar una capa de abstracción de pagos que permita cambiar el proveedor sin afectar el core del negocio.                            |
+---------------------------------------------------------------------------------------------------+---------------------------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------+
| Complejidad del algoritmo de optimización de rutas en tiempo real                                 | Medio                                                                                                                                                         | MVP con algoritmo greedy simple. Optimización avanzada en fase posterior.                                                                 |
+---------------------------------------------------------------------------------------------------+---------------------------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------+
| Precisión del GPS en entornos urbanos densos para el geofencing del handshake                     | Medio                                                                                                                                                         | Configurar umbral de proximidad ajustable. QR con TTL como fallback.                                                                      |
+---------------------------------------------------------------------------------------------------+---------------------------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------+
| Resistencia de usuarios al proceso de KYC (fricción en onboarding)                                | Alto                                                                                                                                                          | Diseño UX optimizado para el flujo de KYC. Comunicar el valor de seguridad claramente.                                                    |
+---------------------------------------------------------------------------------------------------+---------------------------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------+
| Costos de API de Didit.me en volumen alto de verificaciones                                       | Medio                                                                                                                                                         | Evaluar caché de verificaciones y período de re-verificación para reducir llamadas a la API.                                              |
+---------------------------------------------------------------------------------------------------+---------------------------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------+

# Glosario de Términos

+-------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **Término**                                                                                                                               | **Definición**                                                                                                                                                                                                                                                    |
+===========================================================================================================================================+===================================================================================================================================================================================================================================================================+
| KYC (Know Your Customer)                                                                                                                  | Proceso de verificación de identidad de un cliente mediante documentos y, opcionalmente, biometría.                                                                                                                                                               |
+-------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| Cryptographic Handshake                                                                                                                   | Protocolo de autenticación mutua basado en criptografía de clave pública para verificar la presencia física de dos partes en un mismo lugar y momento.                                                                                                            |
+-------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| Hold / Auth & Capture                                                                                                                     | Mecanismo de reserva de fondos en una tarjeta de crédito/débito: se autoriza el débito pero no se materializa hasta la captura explícita.                                                                                                                         |
+-------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| Split Payment                                                                                                                             | Distribución automática del monto de una transacción entre múltiples destinatarios. En Movo: porcentaje de comisión para Movo, saldo para el transportista.                                                                                                       |
+-------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| Nonce                                                                                                                                     | Número de uso único generado aleatoriamente para prevenir ataques de replay en protocolos criptográficos.                                                                                                                                                         |
+-------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| Geofencing                                                                                                                                | Técnica de validación geoespacial que verifica si un dispositivo se encuentra dentro de un radio predefinido alrededor de un punto de referencia.                                                                                                                 |
+-------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| VRPTW                                                                                                                                     | Vehicle Routing Problem with Time Windows. Problema de optimización combinatoria que busca rutas óptimas para uno o más vehículos con restricciones de ventanas temporales.                                                                                       |
+-------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| P2P (Peer-to-Peer)                                                                                                                        | Arquitectura descentralizada donde los participantes interactúan directamente entre sí sin intermediarios centrales.                                                                                                                                              |
+-------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| Liveness Detection                                                                                                                        | Técnica biométrica que verifica que la persona frente a la cámara es real y está presente, previniendo el uso de fotos o videos para bypass del KYC.                                                                                                              |
+-------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| AR/CV                                                                                                                                     | Realidad Aumentada / Visión Computacional. Tecnologías que permiten al dispositivo analizar e interpretar el mundo físico a través de la cámara.                                                                                                                  |
+-------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| TFG                                                                                                                                       | Trabajo Final de Grado. Proyecto integrador requerido para la obtención del título de Ingeniería en Sistemas.                                                                                                                                                     |
+-------------------------------------------------------------------------------------------------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

