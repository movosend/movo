# ADR-040 — Chat propio sobre el canal WebSocket (MOVO-26)

> Borrador para pegar en `[Movo] 004 - Sprint 0.md`. El 039 lo reserva MOVO-283.

**Contexto.** MOVO-26 pide chat de texto en tiempo real entre emisor, receptor y transportista, disponible
desde la asignación hasta 24 h después de la entrega, con el historial vinculado al envío y visible para el
admin en una disputa. Evaluamos proveedores con plan gratuito: Stream Chat (Maker Account: 2.000 MAU y 100
conexiones simultáneas, por aprobación, para equipos chicos y de bajos ingresos; al llegar al tope los
usuarios nuevos no pueden conectarse), Sendbird y CometChat (~100 MAU), Tencent RTC (1.000 MAU) y Firebase
(una base en tiempo real, no un chat). Cifras de las páginas públicas de cada proveedor, a reconfirmar.

**Decisión.** Chat propio dentro de `movo-svc-shipments`, sobre el canal de ADR-022. Un hilo por envío; se
envía por HTTP (`POST /shipments/:id/chat/messages`, idempotente por `clientMessageId`) y se recibe por
WebSocket (`GET /shipments/:id/chat`), como la ingesta de posiciones de ADR-024. Persistencia en
`shipments.chat_messages`. Solo texto en el MVP. Instancia propia del registro de sockets para no mezclar el
chat con el tracking. Push por mensaje, sin el texto, a quien no tiene el chat abierto.

**Por qué no un proveedor.** La autorización del chat depende de datos que solo tiene `svc-shipments`
(partes del envío, receptor transferido por ADR-038, ventana de 24 h, bloqueos de ADR-026). Un tercero
obligaría a duplicar usuarios y permisos, a sincronizar el historial para el admin y a depender de un cupo y
de una credencial más, sin ahorrar el trabajo de reglas. El canal WebSocket, la autenticación del handshake
y el push ya existen.

**Trade-offs aceptados.** Sin ack en tiempo real por el socket (el ack es la respuesta HTTP), sin presencia,
indicador de escritura ni leído/no leído; el registro de sockets está en memoria y es de una sola réplica
(ADR-006/022); el bloqueo (ADR-026) oculta el contenido de quien tiene un bloqueo con el autor (mensaje vacío, sin push ni tildes) en vez de impedir escribir, porque es un hilo único por envío y no uno por par; entregado el envío el hilo queda en solo lectura y a las 24 h se archiva (sigue legible). Retención y
purga del historial: pendiente de definir con el equipo.
