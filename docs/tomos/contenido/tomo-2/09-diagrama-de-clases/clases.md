# Modelo de Clases del Dominio

El dominio de Movo se reparte en tres contextos delimitados, cada uno propiedad de un microservicio con su propio esquema de datos (ADR-001, ADR-003): **identidad** (`movo-svc-users`), **envíos** (`movo-svc-shipments`) y **pagos** (`movo-svc-payments`). Los diagramas de clases siguientes modelan cada contexto con sus entidades, atributos principales, operaciones y asociaciones. Un cuarto diagrama muestra la estructura en capas de un servicio y las interfaces de integración con proveedores externos.

Se aplican estas convenciones de lectura:

- Los **atributos** son los del esquema real de datos (Prisma, ADR-011), con los tipos del dominio (`UUID`, `Decimal`, `DateTime`); se muestran los más relevantes de cada entidad, y el listado completo está en el diccionario de datos del documento de DER.
- Las **operaciones** son los métodos reales de los servicios de cada módulo que operan sobre la entidad, no operaciones inventadas: en Movo las reglas de negocio viven en servicios (`*.service.ts`) y las entidades son datos persistidos, por lo que cada operación se asocia a la entidad sobre la que actúa.
- Las **clases marcadas con el estereotipo `«movo»`** (en verde) son los agregados raíz de cada contexto.
- Entre contextos **no hay asociaciones** en los diagramas: las referencias entre servicios (por ejemplo, el `senderId` de un envío hacia un usuario) son referencias lógicas por identificador, sin clave foránea, para que ningún servicio dependa de las tablas de otro (ADR-003, ADR-010).

# Contexto de Identidad

La entidad raíz es `User`, que concentra la cuenta, el estado de verificación y los datos de contacto. Los **roles** (`sender`, `carrier`, `receiver`, `admin`) no son un campo fijo: un mismo usuario puede tener varios a la vez, por eso se modelan como una relación `UserRoleGrant`. La verificación de identidad y de licencia se registra intento por intento en `KycVerification`; `User` conserva solo el estado vigente. Las **sanciones** son un historial de solo agregar filas: suspender, inhabilitar o levantar agrega o cierra una fila, nunca modifica el pasado. La clave pública del dispositivo (`DeviceKey`) es la que verifica la firma del handshake criptográfico.

![Diagrama de clases del contexto de identidad.](diagrama:clases-identidad){.borde .sin-corte}

# Contexto de Envíos

`Shipment` es el agregado raíz: su ciclo de vida lo gobierna una máquina de estados (ver el documento de diagramas de estados) y su historia queda en `ShipmentEvent`, una línea de tiempo inmutable. Los transportistas compiten por un envío mediante `Offer`; una oferta aceptada puede asociarse a un `Trip` (el viaje declarado por el transportista), que a su vez recibe la traza GPS en `CarrierPosition`. La custodia física se prueba con `HandshakeEvent` (retiro y entrega) y con las fotos de `ShipmentPhoto`. Las calificaciones, las solicitudes de transferencia del receptor, las disputas y el chat cuelgan del envío y mueren con él.

![Diagrama de clases del contexto de envíos.](diagrama:clases-envios){.borde .sin-corte}

# Contexto de Pagos

El agregado central es `Hold` (la reserva de fondos autorizada pero no capturada). Al confirmarse la entrega se liquida en un `Settlement`, que registra el reparto entre el transportista y Movo. El dinero que queda pendiente entre usuarios y la plataforma (penalidades, recargos y pagos de saldo) se lleva en `UserLedgerEntry`, una cuenta corriente por usuario con movimientos idempotentes. Las tarjetas del emisor (`SavedCard`, agrupadas bajo su `PayerCustomer` en Mercado Pago) y la cuenta de cobro del transportista (`CarrierMpAccount`) completan el contexto. Movo nunca almacena número de tarjeta ni CVV.

![Diagrama de clases del contexto de pagos.](diagrama:clases-pagos){.borde .sin-corte}

# Estructura en Capas e Integración con Proveedores

Todos los servicios Node siguen la misma estructura en capas: las **rutas** (Fastify, con esquemas JSON que validan la entrada y generan el Swagger) delegan en **servicios** con las reglas del negocio, que usan el **dominio** (funciones puras y máquinas de estados), **repositorios** (acceso a datos con Prisma) y **adaptadores o clientes** (integración con proveedores externos y con otros servicios). Cada integración externa se oculta detrás de una interfaz con una implementación real y una implementación de consola o *mock*, elegida por una variable de entorno; es lo que permite desarrollar, probar y correr la integración continua sin depender de servicios de pago (ADR-012, ADR-014, ADR-017).

![Capas de un servicio e interfaces de proveedores externos.](diagrama:clases-servicios){.borde .sin-corte}
