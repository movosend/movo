# Descripción del Tema

**EP-04 · Ejecución del Envío** es el núcleo técnico de Movo: lo que ocurre desde que el envío tiene un transportista asignado hasta que el paquete llega a manos del receptor. Incluye el **handshake criptográfico** que prueba la transferencia de custodia en el retiro y en la entrega, la **evidencia fotográfica** obligatoria en cada etapa, la **ruta optimizada** multi-parada del viaje, el **seguimiento en tiempo real** de la posición, el **chat** entre las tres partes, la **transferencia de la recepción** a otra persona y las **notificaciones push** que mantienen informados a todos.

Es la segunda capa de confianza del producto (la custodia): la firma ECDSA del dispositivo, la proximidad de 100 m y un evento inmutable reemplazan la confianza ciega entre desconocidos. Los canales en tiempo real (tracking y chat) usan WebSocket nativo con autenticación por JWT (ADR-022).

**Servicios involucrados:** `gateway`, `movo-svc-shipments` (handshake, evidencia, tracking, chat, transferencia), `movo-svc-pricing-logistics` (optimización de la ruta), `movo-svc-users` (claves de dispositivo, bloqueos y notificaciones), `movo-svc-payments` (liberación de fondos al entregar) y `movo-mobile`; **externos:** Google Routes API, Expo Push Service y Amazon S3.
