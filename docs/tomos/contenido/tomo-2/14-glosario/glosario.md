# Lenguaje del Dominio

Este glosario reúne los términos del negocio y de la técnica que usa el equipo, con las definiciones vigentes al cierre del proyecto. Constituye el **lenguaje ubicuo** de Movo: se usa de forma consistente en el código, en la documentación y en la comunicación del equipo. Donde una definición del Sprint 0 quedó superada por la implementación, aquí figura la versión actual (por ejemplo, el ciclo de vida del envío, el momento de la reserva de fondos o la resolución de disputas).

| Término | Definición |
|----------------|--------------------------------------------------------------------------|
| **Emisor** | Usuario registrado que crea un envío, designa a un receptor y paga. Prepara el paquete y es quien elige al transportista entre las ofertas recibidas. |
| **Receptor** | Usuario registrado designado por el emisor como destinatario. Debe aceptar o rechazar el envío en 48 horas, antes de que se publique; no puede editar sus datos. Puede transferir la recepción a otra persona (DD-038). |
| **Transportista** | Usuario con identidad y licencia de conducir verificadas y una cuenta de Mercado Pago vinculada, que traslada físicamente el paquete y cobra el neto del envío. |
| **Administrador** | Usuario con rol `admin` que opera el panel de administración con un segundo factor; sus acciones de escritura quedan registradas en una bitácora. |
| **Envío** | Unidad central del sistema: el acuerdo entre emisor, receptor y transportista para trasladar un paquete. Su ciclo de vida tiene 11 estados (ver el documento de diagramas de estados). |
| **Viaje (declarado)** | Trayecto planificado por un transportista (origen, destino, salida y vehículo). Permite sugerirle paquetes compatibles con su ruta y agrupar los envíos que va a llevar. Puede repetirse semanalmente (DD-042). |
| **Oferta** | Propuesta de un transportista para trasladar un envío publicado, con el monto neto que quiere cobrar. El sistema le suma la comisión de Movo para mostrar al emisor el precio bruto. |
| **Precio sugerido** | Valor que calcula el motor de precios para un envío a partir del peso facturable, la distancia, el tipo de paquete y la demanda de la zona (`package_tapered_v2`, DD-041). |
| **Cotización congelada** | Precio sugerido que se reserva durante 15 minutos bajo un identificador de un solo uso, para que el emisor pague el valor que vio (DD-028). |
| **Peso facturable** | El mayor entre el peso real y el peso volumétrico del paquete, base del cálculo del precio. |
| **Alta demanda** | Recargo que se aplica al precio sugerido cuando la relación entre paquetes y transportistas de la zona supera un umbral. |
| **Comisión de Movo** | Porcentaje fijo y configurable del precio que retiene la plataforma al repartir el pago (15 % por defecto). |
| **Feed de paquetes** | Lista de envíos publicados cercanos a un punto de retiro, visible para transportistas verificados, sin datos personales de las partes. |
| **Handshake criptográfico** | Protocolo de transferencia de custodia en el retiro y en la entrega: el cedente genera un desafío efímero, lo firma con la clave de su dispositivo y el cesionario lo confirma estando a menos de 100 metros (ADR-018). |
| **Cedente / Cesionario** | Quien entrega el paquete en una etapa del handshake (emisor en el retiro, transportista en la entrega) y quien lo recibe (transportista en el retiro, receptor en la entrega). |
| **Nonce** | Número aleatorio de un solo uso que identifica un desafío del handshake; se guarda solo su hash en el evento de custodia. |
| **ECDSA P-256** | Algoritmo de firma digital de curva elíptica con el que el dispositivo del cedente firma el desafío del handshake. |
| **TTL (QR)** | Vigencia del código QR del handshake: 15 segundos; pasado ese tiempo el cedente debe generar uno nuevo. |
| **Proximidad (geofencing)** | Verificación de que cedente y cesionario están dentro de un radio de 100 metros al confirmar el handshake. |
| **Evidencia fotográfica** | Fotos del paquete que el transportista debe cargar al retirar y al entregar para poder confirmar el handshake. |
| **Tracking** | Seguimiento de la posición del transportista durante el tránsito, transmitido en tiempo real por WebSocket a las partes del envío. |
| **Ruta optimizada** | Orden de retiros y entregas de un viaje calculado como un VRPTW con ventanas horarias. |
| **VRPTW** | *Vehicle Routing Problem with Time Windows*: problema de optimización de rutas con ventanas de tiempo, resuelto con Google OR-Tools. |
| **Chat del envío** | Conversación en tiempo real entre emisor, receptor y transportista asignado, vigente mientras el envío no se cancele ni se rechace. |
| **Transferencia de receptor** | Solicitud del receptor para que otra persona reciba el envío; se completa de forma atómica si la invitada acepta antes de que empiece la entrega. |
| **Redesignación de receptor** | Elección de otro receptor por parte del emisor después de un rechazo, dentro de 48 horas (DD-027). |
| **KYC (Know Your Customer)** | Verificación de identidad previa a operar, delegada en Didit.me (documento y prueba de vida). Movo no almacena documentos ni biometría. |
| **Insignia** | Marca visual del perfil que certifica un nivel de verificación: identidad verificada y licencia verificada. |
| **Reputación** | Score de 1 a 5 de cada usuario, calculado con contracción bayesiana hacia la media global y decaimiento temporal, discriminado por rol. Con menos de 3 calificaciones el perfil se muestra como nuevo. |
| **Calificación** | Valoración de 1 a 5 estrellas con comentario opcional entre las partes de un envío entregado, posible durante 72 horas. |
| **Reporte y bloqueo** | Herramientas de moderación entre usuarios: el reporte llega al equipo; el bloqueo oculta envíos y bloquea ofertas y designaciones en ambos sentidos. |
| **Sanción** | Suspensión (temporal o indefinida) o inhabilitación de una cuenta, aplicada por un administrador y registrada en un historial de solo agregar filas. |
| **Disputa** | Reclamo formal de una parte sobre un envío entregado o completado, dentro de 7 días, con motivo, descripción, fotos y descargos de las contrapartes (DD-054). |
| **Soporte** | Conversación del usuario con el equipo de Movo desde la aplicación, con o sin un envío asociado. |
| **Hold (reserva)** | Autorización del pago en la tarjeta del emisor sin cobrarlo. Se crea al asignar el transportista y se captura recién al confirmarse la entrega. |
| **Captura** | Cobro efectivo de un hold. Puede ser total (al entregar) o parcial (al cobrar una penalidad). |
| **Split payment** | Reparto automático del pago capturado: la comisión de Movo queda como *application fee* y el neto se acredita en la cuenta de Mercado Pago del transportista. |
| **Liquidación** | Registro del resultado de una captura: montos bruto, comisión y neto, y su estado (en proceso, acreditada, fallida o escalada). |
| **Saga de asignación** | Secuencia de pasos entre `movo-svc-shipments` y `movo-svc-payments` para asignar un transportista y reservar los fondos, con compensación si el pago falla o vence (DD-037). |
| **Ruta cercana / lejana** | Camino de la saga según los días al retiro: con retiro cercano (dentro de 3 días) el emisor paga al aceptar la oferta, con 30 minutos de plazo; con retiro lejano el pago se confirma cuando se abre una ventana previa al retiro. |
| **Penalidad de cancelación** | Cargo del 25 % del precio acordado cuando el emisor cancela un envío asignado con menos de 12 horas de anticipación al retiro (DD-047). |
| **Cuenta corriente** | Registro por usuario de penalidades, recargos, pagos voluntarios y ajustes que generan una deuda o un saldo a favor (DD-044). |
| **Deuda vencida** | Deuda sin saldar por más de 14 días, que impide al transportista ofertar y declarar viajes hasta saldarla. |
| **Vinculación de Mercado Pago** | Autorización OAuth que permite a Movo cobrar en nombre del transportista y repartir el pago. |
| **Tarjeta guardada** | Tarjeta del emisor registrada en Mercado Pago, con la que se paga ingresando solo el código de seguridad. Movo conserva únicamente la marca, los últimos cuatro dígitos y el vencimiento. |
| **Access token / Refresh token** | Credenciales de sesión: un JWT de 60 minutos y un token opaco de 90 días, de un solo uso, que se renueva con rotación (ADR-004, ADR-013). |
| **OTP** | Código de un solo uso enviado por SMS o correo para verificar un teléfono, recuperar la contraseña o ingresar al panel. |
| **API Gateway** | Único servicio expuesto a Internet: autentica, limita el uso y enruta cada pedido al servicio dueño. |
| **Referencia lógica** | Referencia a una entidad de otro servicio por su identificador, sin clave foránea, para que ningún servicio dependa de las tablas de otro (ADR-003). |
| **ADR** | *Architecture Decision Record*: registro de una decisión de arquitectura con su contexto y el costo aceptado. |
| **Compare-and-swap** | Escritura condicionada al estado esperado (`UPDATE … WHERE status = …`) con la que se evitan condiciones de carrera sin bloqueos largos. |
| **Idempotencia** | Propiedad por la que repetir una operación con la misma clave devuelve el resultado original sin duplicar su efecto. |
| **Barrido (*sweep*)** | Tarea periódica en segundo plano (vencimientos, reintentos, limpieza) que toma un candado en Redis para correr en una sola réplica. |
| **Fail-open / Fail-closed** | Política ante la caída de una dependencia: dejar pasar la operación (por ejemplo, el filtro de bloqueos del feed) o rechazarla (por ejemplo, crear una oferta sin poder verificar el bloqueo). |
| **URL prefirmada** | URL temporal de Amazon S3 para subir o leer un archivo sin exponer credenciales ni pasar el archivo por el backend (ADR-007). |
| **WebSocket** | Canal bidireccional persistente usado para el tracking, el chat y el soporte, autenticado con el JWT en el establecimiento de la conexión (ADR-019). |
| **Webhook** | Llamada que un proveedor externo (Didit, Mercado Pago) hace a Movo para informar un evento; se valida con una firma y una ventana de tiempo para evitar repeticiones. |
| **TFG** | Trabajo Final de Grado: proyecto integrador de la carrera, en el que se enmarca Movo. |

: Glosario del dominio y de la técnica.
