# Soporte: bandeja del agente (MOVO-319)

Contrato que define MOVO-323 (pantallas de `movo-admin`) para que lo implementen MOVO-322 (API del agente,
`svc-admin` + endpoints internos de `svc-shipments`) y MOVO-321 (adjuntos). Los tipos viven en
`shared/movo-shared/src/types/admin-support.ts` (se importan por `@movo/shared/src/types/admin-support`);
este documento explica las rutas, los eventos y las decisiones. Si el código y este texto difieren, manda el código.

El panel llama **solo** a `/admin/support/*` de `svc-admin` (decisión 6 de MOVO-286). El gateway ya enruta
`/admin/*` con `allowedRoles: [admin]`.

## Rutas (`/api/v1/admin/support/*`)

| Método y ruta | Cuerpo / query | Respuesta | Notas |
| --- | --- | --- | --- |
| `GET conversations` | `status` (obligatorio), `assignee` (`me`/`none`/id), `q`, `cursor` | `SupportListPage` | Abiertas: prioridad (urgente → baja) y mayor espera. Resueltas: última actividad. `q` cubre nombre, `SOP-NNNN`, código de envío y texto de mensajes. Páginas de 30 |
| `GET counts` | `status`, `assignee`, `q` | `SupportCounts` | `byStatus` respeta asignación y `q`; `byOwner` (Todos/Míos/Sin asignar) respeta estado y `q`; `unreadTotal` es global (badge del menú) |
| `GET conversations/:id` | | `SupportConversation` | |
| `GET conversations/:id/messages` | `cursor` | `SupportMessagesPage` | Más recientes primero, páginas de 50. Trae **todos** los `kind` (notas y `system` incluidos) |
| `POST conversations/:id/messages` | `SupportSendBody` | `SupportMessage` | `internal: true` = nota (nunca llega al usuario). Idempotente por `clientMessageId`. Un mensaje puede ir solo con adjuntos |
| `PATCH conversations/:id` | `SupportPatchBody` | `SupportConversation` | Asignar/desasignar, prioridad, tema, etiquetas, vincular/desvincular envío. Cada cambio de asignación, prioridad, tema y vínculo deja un mensaje `system`; las etiquetas no |
| `POST conversations/:id/resolve` · `…/reopen` | `{}` | `SupportConversation` | Con evento `system`. Sin calificación |
| `POST conversations/:id/read` | `{}` | 204 | Lectura: **no** va a bitácora ni pasa por el conflicto de interés. No leídos son compartidos por conversación |
| `GET conversations/:id/context` | | `SupportUserContext` | Falla abierto: si `svc-users` no responde, `badges: null` y el resto igual |
| `GET agents` | | `SupportAgent[]` | Admins con `activeCount` (consultas no resueltas asignadas): menú "Asignar" |
| `POST attachments` | `SupportAttachmentCreateBody` | `SupportAttachmentCreateResult` | MOVO-321 AC1. El panel sube con `PUT uploadUrl` desde el navegador (hace falta CORS en el bucket para el origen del panel) |
| `POST realtime-ticket` | `{}` | `SupportRealtimeTicket` | Ver "Tiempo real" |
| `GET events` | `since` (cursor) | `SupportEventsPage` | Polling de respaldo del WS |
| `GET ws` (upgrade) | subprotocolo | | Ver "Tiempo real" |

Las respuestas rápidas **no** son una ruta para el panel: `SUPPORT_QUICK_REPLIES` y `resolveQuickReply` están en
`@movo/shared` y las usa el panel directamente (MOVO-322 AC11 pedía `GET /admin/support/quick-replies`; si el backend la
quiere igual, que devuelva esa misma constante). MOVO-322 la implementó así: `GET quick-replies` devuelve la constante.

## Reglas de escritura

- Toda escritura (responder, nota, asignar, prioridad, tema, etiquetas, vincular, resolver, reabrir, pedir un adjunto)
  pasa por `runAdminAction` de `svc-admin`: bitácora y **conflicto de interés**. Sobre una consulta cuyo `user.id` es el admin
  responde `403 ADMIN_CONFLICT_OF_INTEREST` (objetivo `support_conversation` de `AdminTargetType`, MOVO-322).
  El panel lo muestra como aviso y deja el compositor deshabilitado.
- Responder pasa la conversación a `awaiting_user`, la asigna al agente si no tenía y deja el evento; responder sobre una
  `resolved` la reabre con su evento.
- Los textos de los eventos `system` los arma el servidor **en tercera persona** ("Tomás Ferreyra tomó la conversación",
  "Prioridad: alta", "Vinculada a #MOVO-48176"): el mismo mensaje lo leen todos los agentes.
- `waitMinutes` lo calcula el servidor (desde el último mensaje del usuario sin respuesta; 0 si no espera).
- Vincular un envío valida que el usuario de la consulta sea parte → si no, `422 SUPPORT_SHIPMENT_NOT_PARTY`.
- Errores propios: `SUPPORT_CONVERSATION_NOT_FOUND` (404), `SUPPORT_ATTACHMENT_INVALID` (422), `SUPPORT_SHIPMENT_NOT_PARTY` (422),
  `SUPPORT_TICKET_INVALID` (401), `SUPPORT_SERVICE_UNAVAILABLE` (502). Ya están en `ApiErrorCode`.

## Implementación del lado del agente (MOVO-322)

- **Dos capas**: `svc-admin` (`modules/support/`) completa nombres y roles (`POST /internal/admin/users/names`, que ahora
  devuelve `roles`; best-effort, "Nombre no disponible" si `svc-users` cae), resuelve `assignee=me`, busca por nombre en
  `svc-users` (los ids viajan como `userIds`) y pasa toda escritura por `runAdminAction`. `svc-shipments`
  (`/internal/admin/support/*`, `modules/admin-support/`) aplica las reglas del modelo y avisa al usuario y al panel. El
  contrato interno es `SupportInternal*` (`admin-support-internal.ts`), con ids en vez de nombres.
- **Eventos del equipo**: `kind = event` en `support_messages` (actor en `author_id`/`author_name`). El panel los ve como
  `system`; el usuario **nunca** (lista blanca de `USER_VISIBLE_MESSAGE_KINDS`): ve solo el cambio de estado
  (`support_status`). `system` sigue siendo el evento del lado del usuario ("Se reabrió la conversación").
- **Bitácora**: `support.reply`, `support.note`, `support.assign`, `support.priority`, `support.topic`, `support.tags`,
  `support.link_shipment`, `support.unlink_shipment` (o `support.update` si un `PATCH` cambia varios campos),
  `support.resolve`, `support.reopen` y `support.attachment_request`. Asignar a alguien que no es admin: 400, fila `failed`.
- **No leídos compartidos**: mensajes del usuario posteriores a `last_agent_read_at`; `POST read` lo avanza (y le pone el ✓✓
  al usuario).
- **Contexto**: perfil y KYC de `svc-users`; insignias `identity` (email y teléfono verificados), `kyc_approved`/`kyc_pending`
  y `license_valid` (aprobada y no vencida). Si el KYC no responde, `badges: null`; sin el perfil, 502.
- **Tiempo real**: Redis Stream `support:events` (ADR-056, borrador en `adr-056-eventos-del-panel-por-redis-stream.md`);
  `GET events` ya lee de ahí. El WebSocket con ticket es la segunda PR de MOVO-322.

## Adjuntos (MOVO-321)

`POST attachments` valida `image/jpeg|png|webp` y ≤ 5 MB → `{ attachmentId, uploadUrl, expiresAt }`; el panel redimensiona
(lado máx. 1600 px) y hace `PUT`. Al enviar el mensaje (`attachmentIds`, hasta 4) el servidor verifica que el objeto exista con el
tipo y tamaño declarados; cada adjunto se usa una vez y solo por quien lo creó. Los mensajes devuelven
`{ id, contentType, width?, height?, url }` con `url` firmada y de vida corta, generada al leer. Prefijo privado `support/<conversationId>/…`.

Implementado en `svc-shipments` (MOVO-321):

- **Servicio reutilizable** `modules/support/support-attachments.service.ts`: `create` (valida y firma el `PUT`), `assertUsable` (cantidad,
  dueño, uso único, conversación y `HEAD` real contra el bucket) y `viewsFor` (URLs de `GET` de 15 min, firmadas en cada lectura, nunca
  persistidas). Ninguna decide el acceso a la conversación: quien llama ya la autorizó. El lado del usuario la usa con `uploaderKind: "user"`;
  `POST /admin/support/attachments` (MOVO-322) la tiene que usar con `uploaderKind: "staff"`, y `appendStaffMessage` ya acepta `attachmentIds`
  (también en notas). Un adjunto del usuario no lo puede usar un agente, ni al revés.
- **Tabla** `shipments.support_attachments`: la fila nace al pedir la URL, sin mensaje; al enviar el mensaje se asocia en la misma
  transacción con un `UPDATE … WHERE message_id IS NULL`, así el uso único es atómico. La regla de "se puede usar" es un único predicado SQL
  (`usablePredicate`) que comparten la verificación previa y el claim; el claim además rechaza más de 4 o repetidos, así ningún camino se
  la saltea. `support_messages.attachment_count` alimenta `lastMessage.hasAttachments`.
- **Tope**: hasta `SUPPORT_ATTACHMENT_MAX_PENDING` (20) adjuntos pedidos y sin usar por quien sube; el siguiente da 429
  `SUPPORT_ATTACHMENT_PENDING_LIMIT`.
- **Fan-out**: si firmar las URLs falla después de guardar el mensaje, se difunde sin adjuntos (la app los recupera con `GET /messages`) y el
  request no falla.
- **Primera consulta del usuario** (sin `conversationId`, punto abierto de MOVO-324, opción A): el objeto va a `support/pending/<userId>/…` y,
  al crear la consulta, la fila queda en esa conversación **sin mover el objeto** (moverlo pediría `CopyObject` y no cambia la privacidad).
- **Huérfanos**: `plugins/support-attachment-sweep.ts`, con la ventana, el intervalo y el interruptor de las fotos huérfanas (`ORPHAN_PHOTO_*`,
  sin env vars nuevas). En dos pasos: marca la fila (`deleting_at`, ya no se puede asociar), borra el objeto y recién entonces la fila; si S3
  falla, la marca queda y la próxima corrida reintenta. Es la única limpieza: no hay regla de lifecycle sobre `support/*`, porque el objeto
  de `pending` no se mueve al usarse y una regla por prefijo borraría fotos en uso.
- Retención: se conservan mientras la conversación (no hay purga de soporte).

## Tiempo real

El panel no puede usar el JWT en el navegador (cookies `__Host-*` httpOnly) ni mandar `Authorization` en un `WebSocket`, y Vercel no
hospeda WS. Diseño:

1. Server Action → `POST realtime-ticket` → `{ ticket, url, expiresAt }`. Un solo uso, ~30 s, atado al admin y al origin.
2. El navegador conecta con `new WebSocket(url, ["movo-support.v1", ticket])`. El servidor valida el ticket, **responde solo el subprotocolo
   `movo-support.v1`** (nunca el ticket) y rechaza el upgrade si es inválido.
3. Hospedaje: **`svc-admin`**, expuesto por el gateway en `/api/v1/admin/support/ws` (MOVO-322). Ruta pública en el gateway (sin JWT) que
   rechaza el upgrade sin ticket; el gateway acepta el WebSocket del navegador y abre otro hacia `svc-admin`, al que solo le pasa el primer
   subprotocolo, así que reenvía la lista original en `x-ws-protocols` y el `Origin`. `svc-admin` gasta el ticket (`GETDEL`, guarda solo su
   sha256), exige un `Origin` de `SUPPORT_WS_ALLOWED_ORIGINS` (cierre 4003) y cierra con 4001 un ticket inválido, vencido o usado; la
   conexión dura lo que una sesión de panel (15 min) y se corta con 4001 para pedir otro. nginx no cambia (su `location /` ya hace el upgrade).
   Los eventos salen del Redis Stream de ADR-056, un lector para todas las conexiones. Los agentes reciben **todos** los eventos de soporte,
   incluidas las notas.
4. Eventos (`SupportEvent`, cada uno con `cursor` monótono y opaco): `conversation_created`, `support_message` (trae la fila ya actualizada),
   `conversation_updated`, `counts_updated`.
5. Respaldo: si el WS falla 3 veces seguidas el panel pasa a `GET events?since=<cursor>` cada 10 s (sigue intentando el WS). Sin `since` devuelve
   `{ events: [], cursor }` (arranca desde ahora). `reset: true` = el servidor ya no guarda tantos eventos; el panel vuelve a pedir lista, contadores y mensajes.
   Alcanza con retener unos minutos de eventos.
6. Los eventos nunca llevan notas internas hacia el usuario; el canal del usuario (mobile, MOVO-319) es otro.

## Soporte del lado del usuario (MOVO-320, ADR-051)

El usuario le escribe a Movo desde la app (MOVO-324). Vive en `svc-shipments` (módulo `modules/support/`), sobre el chat existente
(ADR-040/046): mismo `ChatHub` (otra clave de sala, `support:<id>`), mismo handshake WS, mismo filtro de lenguaje. Los tipos son
`shared/movo-shared/src/types/support.ts` (se importan por `@movo/shared/src/types/support`; ojo que `SupportUserMessage` es del panel: el
mensaje que ve el usuario es `SupportUserFacingMessage`). El agente **no** entra por acá: usa `/admin/support/*`.

### Rutas (`/api/v1/support/*`, usuario autenticado; solo ve las suyas, ajena o inexistente = 404)

| Método y ruta | Cuerpo / query | Respuesta | Notas |
| --- | --- | --- | --- |
| `POST conversations` | `SupportCreateBody` (`topic`, `body`, `clientMessageId`, `shipmentId?`, `attachmentIds?`) | `SupportCreateResult` (201; 200 si se reenvía el `clientMessageId`) | Crea la consulta y su primer mensaje en una transacción. Con `shipmentId` el usuario tiene que ser parte (emisor, transportista, receptor o ex receptor): si no, **422** `SUPPORT_SHIPMENT_NOT_PARTY` (inexistente da lo mismo). `attachmentIds`: subidos sin `conversationId` (ver Adjuntos) |
| `GET conversations` | | `SupportListResponse` | La de actividad más reciente primero (hasta 100). `lastMessage` nunca es una nota ni un evento `system`; `unreadCount` cuenta solo respuestas del equipo |
| `GET conversations/:id/messages` | `limit` (1-100, 30), `cursor` | `SupportUserMessagesPage` | Más recientes primero, cursor opaco (mismo formato que el chat). Trae `conversation` para el encabezado. Abrir la primera página marca lo recibido |
| `POST conversations/:id/messages` | `SupportSendUserBody` | `SupportUserFacingMessage` (201 / 200) | Idempotente por `clientMessageId`. Sobre una `resolved` la reabre; sobre una `awaiting_user` la pasa a `open` |
| `GET shipments` | `limit` (1-50, 20), `cursor` | `SupportShipmentOptionsPage` | MOVO-324. Envíos de los que el usuario es parte, en cualquier rol y estado, para vincular a una consulta nueva (`GET /shipments/mine` no trae al transportista). `route` es "Ciudad → Ciudad" |
| `POST attachments` | `SupportUserAttachmentCreateBody` (`contentType`, `sizeBytes`, `conversationId?`, `width?`, `height?`) | `SupportAttachmentCreateResult` (201) | MOVO-321. Con `conversationId`, la consulta tiene que ser del usuario (404 si no); sin él, para una consulta nueva. La app hace `PUT uploadUrl` con el mismo `Content-Type` |
| `POST conversations/:id/read` | | `{ readAt }` | Baja el `unreadCount` a cero |
| `GET conversations/:id` (WS) | header `Authorization: Bearer` | frames de abajo | Mismo mecanismo que `/track` y el chat del envío |

Texto de 1 a `SUPPORT_MESSAGE_MAX_LENGTH` (2000) caracteres, recortado (vacío si el mensaje lleva imágenes, MOVO-321). Una URL de
adjunto vencida se renueva volviendo a pedir la página de mensajes: cada lectura firma URLs nuevas. Las palabras ofensivas se tapan con asteriscos y el mensaje
sale con `moderated: true`; a los de un agente no se les aplica el filtro. No hay chequeo de bloqueo (ADR-026): la otra parte es Movo.

### Estados

`open` (le toca al equipo) → `awaiting_user` (respondió un agente) → vuelve a `open` cuando el usuario escribe. Una `resolved` se **reabre**
si el usuario escribe: pasa a `open`, se limpia `resolved_at` y se guarda un mensaje `system` "Se reabrió la conversación" (queda a
continuación del mensaje del usuario). La conversación no se borra ni se archiva al resolverse y no hay job de purga: el plazo de retención
está pendiente de definir con el equipo legal (MOVO-224).

### WebSocket (`GET /api/v1/support/conversations/:id`)

Frames: `{ "type": "connected", "conversationId" }` al aceptar (la app refresca la primera página), y después `support_message`
(`{ message }`), `support_status` (`{ conversationId, status }`) y `support_receipt` (`{ conversationId, upTo }`: un agente leyó hasta
`upTo`, la app actualiza los tildes). El cliente no manda nada. Cierres: `4001` token inválido o vencido (la app renueva y reconecta; también
se corta sola al `exp` del JWT), `4003` sin permiso (un admin que no es el dueño: los agentes usan el canal del panel), `4004` la
conversación no existe o no es del usuario (terminal). Heartbeat de 30 s. Registro en memoria y una sola réplica (ADR-022).

### Notas internas

Una nota (`kind = note`) **nunca** llega al usuario: se excluye en la query del historial (lista blanca de `kind`), en la lista (último mensaje
y no leídos), en el WebSocket y en la push. Todo mensaje hacia el usuario pasa por `toUserFacingMessage` (`domain/support-rules.ts`), que
devuelve `null` para una nota. Cada camino tiene su test de regresión en `test/support.integration.test.ts`.

### Push

Cuando contesta un agente (no una nota, no un evento `system`) y el usuario no tiene la conversación abierta por WebSocket:
título "Soporte de Movo", cuerpo "Lucía: …" (o "Lucía: Te envió una imagen" si no hay texto), `data: { type: "support_message", conversationId }`,
categoría `support` (respeta el toggle maestro, el de la categoría y el horario de silencio, MOVO-245). Ráfagas como en ADR-046: la primera
avisa enseguida y las de los 30 s siguientes salen en un único resumen ("N mensajes nuevos · …") que se omite si ya se leyó o si el usuario
abrió la conversación.

### Lo que le falta al lado del agente (MOVO-322)

`createSupportService` expone `publishStaffMessage(conversation, message)`, `publishStatus(conversation)` y `publishAgentRead(conversationId,
userId, upTo)`: lo que hay que llamar después de guardar una respuesta, un cambio de estado o una lectura del agente para que le llegue al
usuario (WebSocket y push). Hoy nada las llama desde un endpoint; los tests las usan para simular al agente. Tampoco hay todavía un
endpoint interno para que `svc-admin` se suscriba a los mensajes del usuario (los agentes los ven por `GET events`, que implementa 322).

### Probarlo a mano

```bash
# abrir una consulta (por el gateway; $TOKEN es el access token del usuario)
curl -s -X POST "$API/api/v1/support/conversations" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"topic":"payments","body":"Me cobraron dos veces","clientMessageId":"'$(uuidgen)'"}'
# escuchar la conversación
wscat -c "wss://$HOST/api/v1/support/conversations/$ID" -H "authorization: Bearer $TOKEN"
```

## Pendiente de backend (para 321/322)

El lado del usuario (320) está implementado, ver la sección anterior.

Todo lo de la bandeja del agente. El panel funciona hoy contra `MOVO_ADMIN_MOCK=1` (ver `movo-admin/CLAUDE.md`, entrada MOVO-323).
