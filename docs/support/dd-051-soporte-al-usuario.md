# DD-051 — Soporte al usuario sobre el chat existente (MOVO-320)

> Borrador para pegar en `[Movo] 011-Registro de Decisiones de Diseño`. Complementa ADR-023 (chat) y DD-046 (push del chat) sin
> modificarlos. El número lo fija el ticket como "el siguiente libre": 049 era el último vigente.

**Contexto.** MOVO-319 agrega un canal de soporte: el usuario le escribe al equipo de Movo desde la app
(con o sin un envío de por medio) y un agente contesta desde el panel. Ya existe un chat de tiempo real entre
las partes de un envío (ADR-023/DD-046) con lo difícil resuelto: autenticación del handshake WebSocket, hub de
sockets, filtro de lenguaje, tildes de entregado/leído, paginación por cursor y push con resumen de ráfagas.
Una conversación de soporte no es de un envío (`shipment_id` es opcional) y tiene tres cosas que el chat no:
un estado (`open` / `awaiting_user` / `resolved`), un solo "otro lado" (Movo) y **notas internas** que el
usuario no puede ver nunca.

**Decisión.**

- **Vive en `movo-svc-shipments`, no en un servicio nuevo.** Ahí están el `ChatHub`, el handshake WS, el push y
  el filtro; un servicio nuevo los duplicaría o necesitaría un cliente HTTP para cada uno. Tablas propias en el
  esquema `shipments` (`support_conversations`, `support_messages`, `support_participant_states`); no se tocan las
  del chat del envío. Es el mismo criterio de ADR-017 (la entidad vive donde está la atomicidad), y una excepción
  a "un esquema por dominio" que se acepta por tamaño: son tres tablas.
- **Se reusa el `ChatHub` con otra clave de sala** (`support:<conversationId>` en vez del UUID del envío), así
  el tráfico de soporte no se mezcla con el del chat del envío ni lo cortan sus cierres por estado de envío.
  Mismo límite que ADR-019: registro en memoria y una sola réplica.
- **Las notas internas no llegan al usuario por ningún camino**, y eso se garantiza en un punto único en vez de
  filtrar en cada ruta: `toUserFacingMessage` (`domain/support-rules.ts`) devuelve `null` para una nota y es la
  única función que arma un mensaje hacia el usuario (API, WebSocket y push pasan por ella); la query del
  historial usa una lista blanca de `kind` (`user`, `agent`, `system`), no un "todo menos `note`", así un `kind`
  nuevo queda oculto hasta que se decida mostrarlo. Los tipos de `@movo/shared` (`SupportUserFacingMessage`) no
  tienen un `kind` `note`. Cada camino tiene su test de regresión.
- **Escribir sobre una `resolved` la reabre** (`open`, con un mensaje `system` "Se reabrió la conversación");
  sobre una `awaiting_user` pasa a `open`. Con bloqueo de fila para que dos mensajes simultáneos no reabran dos veces.
- **Idempotencia por `clientMessageId`**: el índice único por conversación cubre el reenvío de un mensaje; como
  crear una consulta todavía no tiene conversación, un índice único parcial `(author_id, client_message_id)`
  para `kind = 'user'` hace atómico el reintento de la creación (sin él, dos pedidos simultáneos crearían dos).
- **Push propia**: categoría nueva `support` ("Soporte de Movo", sección Conversaciones), separada de `chat`
  para que silenciar el chat de un envío no silencie las respuestas de Movo, y trigger `supportMessageReceived`.
  Sigue DD-046 (texto de 140 caracteres, el primero avisa y los de los 30 s siguientes se juntan en un resumen
  que se omite si ya se leyó). Solo avisa una respuesta de un agente: ni una nota ni un evento `system`, y no
  si el usuario tiene la conversación abierta por WebSocket.
- **Sin bloqueo de usuarios** (DD-026): la otra parte es Movo. **Filtro de lenguaje** solo para los mensajes
  del usuario, con `moderated: true`.
- **Un envío ajeno responde 422 `SUPPORT_SHIPMENT_NOT_PARTY`** y no 403 (que era lo que decía el ticket): el
  código ya existe en `ApiErrorCode` y lo usa el panel al vincular un envío; inexistente y ajeno dan la misma
  respuesta para no filtrar qué ids existen. De igual modo, una conversación ajena es 404.
- **Retención: no se borra ni archiva nada.** Las conversaciones y mensajes se conservan al resolverse y no hay
  ningún job de purga. **Plazo de retención pendiente**: lo tiene que definir el equipo con asesoramiento legal
  (MOVO-224, Ley 25.326: datos personales y plazos de conservación), y hasta entonces no hay barrido que lo
  aplique. La baja de cuenta (MOVO-39) tampoco las trata todavía.

**Alternativas descartadas.**
- *Servicio nuevo `svc-support`*: aísla el dominio pero duplica hub, handshake, filtro y push, o los expone por
  HTTP interno con latencia en el camino de un mensaje en tiempo real; desproporcionado para tres tablas.
- *Reusar `chat_messages` con un `shipment_id` nulo*: mezcla las notas internas en una tabla cuyas queries
  asumen que todo es visible para las partes; un olvido en un `WHERE` filtraría una nota.
- *Proveedor externo de soporte (Zendesk, Intercom, Crisp)*: costo y datos personales fuera de Movo, y el panel
  del TFG ya tiene su propia bandeja (MOVO-323).
- *Una sola categoría de push (`chat`)*: un toggle para dos cosas distintas.

**Trade-offs aceptados.**
- Una excepción más al "un esquema por servicio" de ADR-003 (soporte comparte esquema con envíos).
- El registro de sockets es en memoria (una réplica): un reinicio corta los WebSocket abiertos y el cliente
  reconecta; el resumen de push vive en un `setTimeout` del proceso (mismo límite que DD-046).
- Sin adjuntos (MOVO-321), sin "escribiendo", sin presencia, sin calificación de la atención.
- El lado del agente (bandeja, asignación, notas, resolución) es MOVO-322: este ADR deja listas las funciones
  del servicio que difunden al usuario (`publishStaffMessage`, `publishStatus`, `publishAgentRead`), pero nada
  las llama todavía desde un endpoint; hasta entonces las respuestas de un agente solo se simulan en los tests.
