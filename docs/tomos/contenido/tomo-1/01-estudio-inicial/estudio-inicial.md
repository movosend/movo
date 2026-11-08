::: importante
**Alcance temporal de este documento.** El Estudio Inicial registra el diagnóstico y la propuesta formulados en agosto de 2026. Es una línea de base del proyecto, no una especificación de la versión entregada. Las historias, decisiones técnicas y reglas vigentes se documentan en el Tomo II; el proceso que quedó implementado y sus procedimientos operativos, en el Tomo III. Al final de esta sección se resumen los cambios materiales entre la propuesta y el producto.
:::

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

![Posicionamiento cualitativo de Movo frente a los referentes del mercado: quién aporta la capacidad de transporte y en qué tipo de trayecto opera cada uno.](diagrama:ei-posicionamiento)


# Procesos Involucrados

Esta sección describe el panorama actual de los procesos de logística P2P informal tal como existen hoy, sin la intervención de una plataforma como Movo. El análisis cubre la descripción de cada proceso, el flujo operativo, los participantes involucrados, la información que manejan y los sistemas o herramientas que utilizan actualmente.

El objetivo es establecer una línea base (estado AS-IS) que permita contrastar con claridad qué problemas resuelve la solución propuesta y en qué dimensiones agrega valor.

![Mapa de procesos de la logística P2P informal en su estado actual (AS-IS).](diagrama:mapa-procesos-asis)

Para poder entender el impacto de la solución propuesta, es necesario describir primero el estado actual del proceso. El mapa global que se presenta a continuación refleja cómo se organiza hoy la logística P2P informal en Argentina, identificando tres capas de procesos:

## Síntesis de los procesos actuales (AS-IS)

El mapa anterior ubica los procesos estratégicos, operativos y de apoyo. La tabla conserva para cada uno el flujo observado, sus participantes, la información y los medios que utiliza, y la brecha que motivó la propuesta.

| Grupo y proceso | Flujo y participantes | Información y medios actuales | Brecha principal |
|---|---|---|---|
| Estratégico · confianza | El emisor busca a alguien conocido o recomendado antes de confiarle el paquete. Participan emisor, transportista y red de referencias. | Identidad y antecedentes transmitidos de palabra, por WhatsApp o grupos sociales. | Solo funciona dentro de una red personal y las referencias no son verificables. |
| Estratégico · coordinación | Emisor y transportista acuerdan recorrido, fecha, retiro y precio mediante mensajes o llamadas. | Direcciones, horarios, descripción del paquete y precio en chats dispersos. | No queda un acuerdo trazable ni un estado compartido. |
| Estratégico · riesgo | Cada parte asume por su cuenta pérdida, daño o incumplimiento. | Referencias personales y conversaciones; no existe un registro común de responsabilidad. | No hay evidencia ni mecanismo de compensación. |
| Operativo · solicitud | El emisor consulta a conocidos o publica en grupos si alguien viaja al destino; el transportista responde si puede llevarlo. | Origen, destino, fecha y características del paquete en WhatsApp o Facebook. | La búsqueda depende de contactos y no ofrece comparación sistemática. |
| Operativo · retiro | Emisor y transportista se encuentran y entregan el paquete según lo pactado. | Hora y lugar acordados por chat; sin acta, identificación ni foto compartida. | No se prueba quién recibió el paquete ni en qué estado. |
| Operativo · traslado | El transportista lleva el paquete y avisa ocasionalmente a emisor o receptor. | Ubicación y hora estimada comunicadas por mensajes o llamadas. | Las partes carecen de seguimiento verificable. |
| Operativo · entrega | El transportista coordina con el receptor y le entrega el paquete. | Mensajes y confirmación verbal; no hay firma ni constancia digital. | Es difícil probar recepción, identidad y estado final. |
| Apoyo · comunicación | Las tres partes se contactan fuera de un sistema común. | Chats, llamadas y redes sociales sin vínculo formal con el envío. | Las decisiones y avisos se pierden entre conversaciones. |
| Apoyo · pago | Emisor y transportista pactan efectivo o transferencia; a veces paga el receptor. | Precio y comprobantes en canales bancarios o mensajes separados. | El pago no está condicionado a la entrega ni ligado al envío. |
| Apoyo · reputación y disputas | Las referencias circulan de boca en boca; cada conflicto se negocia entre las partes. | Opiniones personales, mensajes y eventualmente reclamos por vías externas. | No hay historial verificable ni un procedimiento proporcional para resolver incidentes. |

: Procesos del entorno informal antes de Movo.

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

## Capacidades propuestas por dominio

La propuesta inicial se organizó en seis grupos. Este resumen expresa el alcance pensado en esa instancia; el inventario refinado de historias y su estado final se encuentra en el Tomo II.

| Dominio | Capacidad propuesta |
|---|---|
| Identidad y confianza | Registro, verificación documental y biométrica, perfil público y habilitación del transportista. |
| Publicación | Creación de envíos con paquete, receptor, fecha, direcciones y precio sugerido; aceptación previa del receptor. |
| Transporte y asignación | Viajes declarados, búsqueda de paquetes compatibles, ofertas, selección del transportista y ruta con paradas. |
| Ejecución | Evidencia fotográfica, transferencia de custodia mediante QR, seguimiento, chat y notificaciones. |
| Economía | Reserva y captura de fondos, reparto del pago, alternativa en efectivo y devoluciones. |
| Reputación y operación | Calificaciones, historial de actividad, disputas y panel para administración. |

: Capacidades de la propuesta inicial.

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

## Secuencia propuesta del proceso

El mapa anterior agrupa los procesos. La secuencia principal prevista era: verificar a las partes, publicar un envío, obtener la aceptación del receptor, recibir ofertas, asignar un transportista, acordar el pago, registrar retiro y entrega, y cerrar con liquidación y calificaciones. El flujograma siguiente muestra responsabilidades y transferencias entre actores. El Manual de Procedimientos del Tomo III describe el proceso efectivamente implementado y sus plazos vigentes.

## Flujograma Punta-a-Punta del proceso principal de envio

La Figura siguiente muestra el recorrido completo de un envío, desde el registro de las partes hasta la actualización de la reputación, distribuido en calles según quién ejecuta cada actividad.

![Flujo punta a punta del proceso principal de envío (diagrama de actividad UML).](diagrama:ei-flujo-punta-a-punta){.pagina-completa}

# Evolución de la propuesta al producto entregado

Las opciones de agosto se refinaron durante los sprints. Esta tabla evita tomar como vigentes los parámetros de la propuesta inicial; los detalles y fundamentos finales están en los ADR y DD del Tomo II y en los manuales del Tomo III.

| Aspecto | Propuesta inicial | Producto documentado al cierre |
|---|---|---|
| Transferencia de custodia | El estudio describía un QR firmado con 60 segundos de vigencia y verificación de proximidad. | QR de 15 segundos y distancia máxima de 100 metros. Ver ADR-018 y Manual de Procedimientos. |
| Reserva de fondos | Se consideraba una vigencia de hasta 7 días y captura tras la entrega. | El plazo operativo documentado es de 5 días; el cobro y los reintentos siguen las reglas del Manual de Procedimientos. Ver DD-050. |
| Pago en efectivo | La propuesta contemplaba pago del receptor en la entrega y cobro de la comisión a una tarjeta del transportista. | El emisor paga al transportista en el retiro; la comisión de Movo se registra como deuda en la cuenta corriente del transportista. Ver MOVO-37 y Tomo III. |
| Precio y alcance de funciones | Se propusieron demanda, combustible y otras variables para el precio, además de un conjunto amplio de funciones. | Las historias refinadas, las decisiones DD y las limitaciones aceptadas del Tomo II indican qué se construyó y qué quedó pendiente. |

: Cambios materiales entre el Estudio Inicial y la documentación final.

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

# Términos del dominio

El glosario consolidado del Tomo II reúne los términos de negocio y técnicos usados en los tres tomos.
