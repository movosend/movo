# Criterio de Selección

Este documento recopila los patrones de diseño que efectivamente aplica el código de Movo, con el problema que resuelven, dónde se implementan y qué costo aceptado traen. No se listan patrones teóricos que el proyecto no use. Cada entrada cita archivos reales del repositorio para que el tribunal y los mantenedores puedan verificarla.

Los patrones se agrupan en cuatro familias: **creacionales y estructurales** (cómo se construyen y conectan los componentes), **de comportamiento** (cómo colaboran), **de consistencia y de integración distribuida** (cómo se mantiene la integridad entre servicios sin transacciones distribuidas) y **de resiliencia y operación**.

# Resumen

| Patrón | Familia | Problema que resuelve | Dónde |
|----------|----------|--------------------------------------|--------------------------------|
| Strategy y Factory Method | Creacional / comportamiento | Cambiar el proveedor de un servicio externo sin tocar la lógica | `adapters/*-provider.ts` |
| Adapter y Anti-Corruption Layer | Estructural | Aislar al dominio del modelo de un tercero o de otro servicio | `adapters/*-client.ts`, `mercadopago-client.ts` |
| Repository | Estructural | Separar la lógica de negocio del acceso a datos | `repositories/*.ts` |
| API Gateway y Proxy | Estructural | Punto único de entrada con autenticación y límites | `gateway/src` |
| Inyección de dependencias por fábricas | Creacional | Componer servicios testeables sin un contenedor de DI | `create*Service(...)` |
| State (máquina de estados) | Comportamiento | Impedir estados y transiciones inválidas | `domain/*-state-machine.ts` |
| Publicación y suscripción | Comportamiento | Difundir eventos en tiempo real a clientes conectados | `realtime/`, chat y tracking |
| Saga con compensación | Integración distribuida | Asignar un envío y reservar fondos entre dos servicios | `modules/funding/` |
| Bloqueo optimista (compare-and-swap) | Consistencia | Evitar condiciones de carrera sin bloqueos largos | `repositories/*.ts` |
| Receptor idempotente | Consistencia | Tolerar reintentos y doble toque sin duplicar efectos | `clientMessageId`, `idempotencyKey` |
| Barrido periódico con candado distribuido | Operación | Ejecutar tareas de fondo en una sola réplica | `plugins/*-sweep.ts` |
| Degradación controlada (fail-open / fail-closed) | Resiliencia | Decidir qué hacer cuando cae un servicio vecino | clientes y gateway |
| Historial de solo agregar filas | Consistencia | Auditar sin posibilidad de reescribir el pasado | triggers en las migraciones |
| DTO y contrato compartido | Estructural | Una única definición de los tipos entre servicios | `shared/movo-shared` |

: Patrones de diseño aplicados en Movo.

# Creacionales y Estructurales

## Strategy y Factory Method: proveedores intercambiables

**Problema.** Movo depende de servicios de pago o de cuota limitada (Twilio, Resend, Google Maps, Didit, Mercado Pago, S3). Usarlos en desarrollo, en las pruebas y en la integración continua tendría costo, volvería lentas las pruebas y las haría dependientes de la red.

**Solución.** Cada capacidad externa se expresa como una **interfaz** (por ejemplo, `SmsProvider`, `EmailProvider`, `GeocodingProvider`, `RoutesProvider`, `StorageProvider`, `PushNotificationProvider`, `DiditClient`), con una implementación real y una de consola o *mock*. Una **fábrica** `create…Provider(config)` elige la estrategia según una variable de entorno (`SMS_PROVIDER`, `EMAIL_PROVIDER`, `GEOCODING_PROVIDER`, `STORAGE_PROVIDER`, `DIDIT_MODE`). El valor por defecto es siempre el *mock*, de modo que un entorno mal configurado falla del lado seguro y barato.

**Dónde.** `services/movo-svc-users/src/adapters/` y `services/movo-svc-shipments/src/adapters/`. Decisiones asociadas: ADR-012 (SMS), ADR-014 (geocoding), ADR-016 (email).

**Costo aceptado.** Hay que mantener la paridad de contrato entre la implementación real y el *mock*; y una variable de entorno olvidada en el despliegue hace que el servicio arranque sano pero con el *mock*, un fallo silencioso que ya ocurrió dos veces y motivó la regla de las tres ubicaciones en el `CLAUDE.md` del repositorio.

## Adapter y Anti-Corruption Layer: clientes de otros servicios

**Problema.** Los servicios se comunican por REST síncrono (ADR-001). Si cada uno consumiera directamente el modelo de otro, un cambio interno se propagaría por todo el sistema.

**Solución.** Cada servicio accede a sus vecinos a través de un **cliente** que traduce el contrato HTTP al vocabulario propio del servicio y centraliza el *timeout*, los errores y la autenticación interna: `UsersClient`, `PaymentsClient`, `PricingClient`, `PricingLogisticsClient`, `NotificationsClient`. Lo mismo vale para el SDK de Mercado Pago, aislado detrás de `MercadoPagoClient`. El dominio nunca ve la forma de la respuesta del tercero.

**Dónde.** `services/movo-svc-shipments/src/adapters/*-client.ts`, `services/movo-svc-payments/src/adapters/`.

## Repository

**Problema.** Evitar que las reglas de negocio contengan consultas y que las pruebas necesiten mockear el ORM.

**Solución.** Toda lectura y escritura pasa por un repositorio por agregado (`ShipmentRepository`, `OfferRepository`, `TripRepository`, `HoldRepository`, ...), que encapsula Prisma y las transacciones. Los servicios reciben el repositorio por parámetro, de modo que las pruebas pueden usar la implementación real contra una base real (como exige el plan de pruebas) o una implementación en memoria.

**Dónde.** `services/*/src/repositories/`.

## API Gateway y Proxy

**Problema.** Los clientes no deben conocer la topología interna, y la autenticación, los límites de uso y la restricción de cuentas sancionadas no deben repetirse en cada servicio.

**Solución.** El gateway es el único servicio expuesto: valida el JWT, aplica los límites de uso con contadores en Redis, bloquea las acciones de cuentas suspendidas o inhabilitadas leyendo su marca en Redis, inyecta los encabezados `x-user-id` y roles (descartando los del cliente) y reenvía el pedido al servicio dueño de la ruta según un mapa de rutas declarativo. También hace de *proxy* de los WebSockets. Los servicios internos confían en esos encabezados (ADR-010).

**Costo aceptado.** El modelo de confianza es perimetral, no *zero-trust*: si alguien llega a la red interna, puede suplantar encabezados. Es una limitación aceptada y documentada.

**Dónde.** `gateway/src/plugins/` (`auth.ts`, `rate-limit.ts`, `account-restriction.ts`) y `gateway/src/config/routes-map.ts`.

## Inyección de dependencias mediante fábricas

**Problema.** Componer servicios con muchas colaboraciones (repositorios, clientes, proveedores) manteniéndolos fáciles de probar.

**Solución.** En lugar de un contenedor de inyección, cada servicio es una función fábrica `createXService(deps)` que recibe sus colaboradores y devuelve un objeto con sus operaciones. El `app.ts` de cada servicio hace la composición. Las dependencias opcionales (por ejemplo, el cliente de notificaciones) degradan el comportamiento en vez de romperlo.

## DTO y contrato compartido

**Problema.** Duplicar los tipos entre servicios genera divergencias silenciosas.

**Solución.** El paquete `shared/movo-shared` define los tipos de dominio, los enumerados, los claims del JWT y el contrato de error `ApiError`; el gateway y los servicios Node lo importan, y los DTO de cada módulo mapean las filas de la base al contrato público sin exponer identificadores internos ni datos personales de otras partes.

# De Comportamiento

## State: máquinas de estados explícitas

**Problema.** El envío, la oferta, el viaje y el hold tienen ciclos de vida con reglas estrictas; un estado inválido puede significar dinero mal movido.

**Solución.** Cada objeto declara un grafo cerrado de transiciones válidas (`VALID_TRANSITIONS`) y toda transición pasa por una función que lo valida y lanza un error de dominio ante cualquier otra; el estado se cambia con un UPDATE condicionado al estado de origen. Los diagramas de estados de este tomo se generan leyendo ese mismo código.

**Dónde.** `services/movo-svc-shipments/src/domain/shipment-state-machine.ts` y `offer-state-machine.ts`; `services/movo-svc-payments/src/modules/user-ledger/user-ledger.service.ts`.

## Publicación y suscripción para el tiempo real

**Problema.** Emisor y receptor deben ver la posición del transportista y los mensajes del chat sin recargar.

**Solución.** Un registro en memoria de conexiones WebSocket por envío (`realtime`) actúa como *hub*: los servicios publican eventos (nueva posición, nuevo mensaje, cambio de estado) y el registro los difunde a los suscriptores autorizados. Cuando un cambio de estado termina el seguimiento, el *hub* cierra las conexiones con un código propio (ADR-019).

**Dónde.** `services/movo-svc-shipments/src/realtime/`.

# De Consistencia e Integración Distribuida

## Saga con compensación: asignación y reserva de fondos

**Problema.** Asignar un transportista (en `movo-svc-shipments`) y reservar el dinero del emisor (en `movo-svc-payments`) son dos operaciones en dos servicios y dos bases, sin transacción distribuida posible.

**Solución.** La asignación es una **saga** orquestada por `movo-svc-shipments`: acepta la oferta y deja el envío en un estado intermedio (`assignment_pending` o `assigned_unfunded`), pide el hold a `movo-svc-payments` y, si el pago se completa, confirma la asignación; si falla, vence o llega un evento de Mercado Pago, ejecuta la **compensación**: libera el hold, devuelve el envío a `published` y deja la oferta como no aceptada. Barridos periódicos cierran los casos que quedan a mitad de camino y reconcilian el estado ante un fallo parcial (DD-037).

**Dónde.** `services/movo-svc-shipments/src/modules/funding/`.

## Bloqueo optimista (compare-and-swap)

**Problema.** Dos aceptaciones de oferta, dos confirmaciones del mismo QR o dos capturas simultáneas no pueden ganar ambas.

**Solución.** Las transiciones críticas se escriben como `UPDATE … WHERE id = ? AND status = <origen>` y se verifica la cantidad de filas afectadas: si es cero, otro proceso ganó y se responde con un conflicto. No hay bloqueos de fila prolongados ni `SELECT … FOR UPDATE`. Índices únicos parciales en la base refuerzan los invariantes más importantes (un hold vivo por envío, un viaje activo por transportista, una oferta pendiente por par).

**Dónde.** `repositories/*.ts` de shipments y payments; migraciones con índices parciales.

## Receptor idempotente

**Problema.** Las redes móviles reintentan y los usuarios tocan dos veces.

**Solución.** Las operaciones sensibles aceptan una clave de idempotencia y repetirlas devuelve el resultado original sin duplicar el efecto: `clientMessageId` en el chat y el soporte, la clave de idempotencia de los pagos de Mercado Pago, la clave de cada movimiento de la cuenta corriente y la huella del pedido de cada hold.

## Historial de solo agregar filas

**Problema.** La auditoría debe ser confiable.

**Solución.** Las tablas de la bitácora de acciones del administrador, de las notas internas y del historial de sanciones rechazan `UPDATE` y `DELETE` mediante *triggers* de la base de datos; los movimientos de la cuenta corriente no se pueden borrar y solo admiten cambiar su estado. Una sanción levantada cierra su fila, no la borra. Los eventos del envío y del handshake se escriben solo por inserción desde el código.

**Dónde.** Migraciones de `movo-svc-admin`, `movo-svc-payments` y `movo-svc-users`.

# De Resiliencia y Operación

## Barrido periódico con candado distribuido

**Problema.** Vencimientos, reintentos y limpiezas deben ejecutarse sin intervención y sin duplicarse si hay más de una réplica.

**Solución.** Cada tarea de fondo (*sweep*) se registra con un temporizador y toma un candado en Redis (`SET NX` con TTL) antes de correr; si otra réplica ya lo tiene, omite la corrida. Cada barrido es idempotente y procesa en lotes.

**Dónde.** `services/movo-svc-shipments/src/plugins/*-sweep.ts` y `register-sweep.ts`.

## Degradación controlada: fail-open y fail-closed

**Problema.** Los servicios dependen de sus vecinos y de terceros que pueden caer.

**Solución.** Cada dependencia tiene una política explícita según el riesgo: **falla abierta** cuando bloquear es peor que dejar pasar (el filtro de bloqueos del feed, la restricción de cuentas en el gateway cuando Redis no responde, el precio sugerido que pasa a «a estimar», la ruta que degrada a una heurística), y **falla cerrada** cuando dejar pasar es un riesgo (crear una oferta si no se puede consultar el bloqueo, aceptar una oferta sin poder revalidar al transportista, capturar un pago a ciegas). Los *timeouts* de cada cliente son cortos y explícitos.
