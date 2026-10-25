# Chat entre las partes de un envío (MOVO-26)

Un hilo por envío entre emisor, receptor y transportista. Se **envía por HTTP** y se **recibe por WebSocket**
(mismo molde que la ingesta de posiciones, ADR-020). Decisión y trade-offs: `adr-023-chat-propio.md`.
El diseño de la pantalla es el prototipo "Chat del envío · v2".

## Endpoints (`movo-svc-shipments`, prefijo `/shipments`, pasan por el gateway)

| Método | Ruta | Qué hace |
| --- | --- | --- |
| `GET` | `/chats` | La lista "Chats": uno por envío con transportista (en curso, entregado o en disputa), el más reciente primero, con `route`, último mensaje, `unreadCount`, `access` y `archived`. |
| `POST` | `/:id/chat/messages` | Envía `{ body, clientMessageId }`. 201 la primera vez, 200 si es un reenvío (idempotente por `clientMessageId`). |
| `GET` | `/:id/chat/messages?limit=&cursor=` | Historial del más reciente al más antiguo, con cursor opaco. Devuelve `access`, `archived`, `reportedByMe` y, en los mensajes propios, `deliveryStatus`. |
| `GET` | `/:id/chat/participants` | Emisor, transportista y receptor con `firstName`, `fullName`, `photoUrl` y `role` (encabezado "Ana, Diego y Luis" y avatares). |
| `POST` | `/:id/chat/read` | Quien mira leyó todo hasta ahora: baja su contador y les avisa a los demás. |
| `POST` | `/:id/chat/report` | "Reportar conversación": una por persona y envío, idempotente (201 / 200). |
| `GET` (WS) | `/:id/chat` | Canal de recepción: `connected`, `chat_message` y `chat_receipt`. El cliente no manda nada por acá. |

El WebSocket se autentica con `Authorization: Bearer <JWT>` en el handshake (como `/track`). Códigos de cierre:
`4001` token inválido o vencido (reconectar con token nuevo), `4003` sin permiso, `4004` envío inexistente,
`4009` el chat ya no está disponible (cancelado; no reconectar).

## Cuándo se puede escribir y cuándo se lee

| Situación | Las partes | Admin |
| --- | --- | --- |
| Con transportista asignado, sin entregar (`assignment_pending` … `in_transit`) | escriben | lee |
| Entregado / completado | **solo lectura** | lee |
| Entregado hace más de 24 h | solo lectura, `archived: true` (sigue legible, atenuado en la lista) | lee |
| En disputa | solo lectura | lee |
| Cancelado, rechazado o sin transportista | `409 CHAT_CLOSED` y se cortan los sockets (`4009`) | lee |

El receptor que transfirió la recepción (DD-038) lee, no escribe. El admin lee siempre (evidencia de disputa)
y nunca escribe. Sin permiso de escritura: `403 CHAT_READ_ONLY`. Reglas puras en `src/domain/chat-window.ts`.

**Cada asignación arranca una conversación limpia.** Si el emisor no paga a tiempo, el envío vuelve a `published`, el
transportista se cae y el chat se cierra; si después acepta otra oferta, el nuevo transportista no ve lo que se habló
con el anterior. `acceptOffer` guarda `chat_started_at` en el envío y el historial, el último mensaje y los no leídos
solo cuentan mensajes desde ese instante. Los mensajes viejos no se borran: el admin los ve todos (evidencia de
disputa). `NULL` = sin corte (envíos anteriores a este cambio).

## Bloqueo (DD-026)

Un bloqueo **no impide escribir**. El contenido de quien tiene un bloqueo con quien mira llega vacío con
`hidden: true` (el cliente muestra "Mensaje de un usuario bloqueado"), tanto en el historial como en tiempo
real y en el último mensaje de la lista. Esos mensajes no suman a los no leídos, no disparan push ni cuentan
para los tildes. Si `svc-users` no responde, no se oculta nada (falla abierto, como los listados).
Bloquear y desbloquear usa los endpoints de siempre (`POST/DELETE /users/:id/block`).

## Tildes de entregado y leído

Cada mensaje propio trae `deliveryStatus`: `sent` ✓, `delivered` ✓✓ (todos los demás lo recibieron) o `read`
✓✓ azules / "Leído por todos" (todos lo leyeron). "Los demás" son las otras partes menos quienes tienen un
bloqueo con el autor. Se guarda hasta dónde recibió y leyó cada integrante (`chat_participant_states`):
- **Recibir:** tener el chat abierto por WebSocket cuando llega el mensaje, abrir el historial o conectarse.
- **Leer:** `POST /:id/chat/read` (la app lo llama al ver la conversación y al llegar un mensaje con ella abierta).
- **En vivo:** el WebSocket empuja `{type:"chat_receipt", userId, status:"delivered"|"read", upTo}`; el cliente
  guarda el último valor por usuario y recalcula los tildes de sus mensajes.

## Filtro de lenguaje

Las palabras ofensivas se tapan con asteriscos del mismo largo **antes** de guardar y de difundir
("sos un pelotudo" → "sos un ********"): nadie más llega a ver la palabra. El mensaje sale igual, con
`moderated: true`, y el cliente le muestra a quien lo escribió el aviso `CHAT_MODERATION_WARNING`
(de `@movo/shared`): hay que respetar a los demás miembros de la comunidad. Lo que se guarda es el texto ya
tapado (el admin ve lo mismo que las partes). La lista vive en `src/domain/chat-moderation.ts`
(`CHAT_BLOCKED_TERMS`); compara por palabra entera, ignora mayúsculas, tildes y letras repetidas, y entiende
números y símbolos por letra ("put4", "put@"). Es acotada a propósito: insultos y agravios fuertes, no las
palabrotas de uso cotidiano ("boludo", "mierda") ni palabras legítimas del dominio ("retrasado").

## Lo que arma el cliente

- Código del envío en la lista (`#MOVO-12345`): `activeShipmentDisplayCode(id)` de `movo-mobile`.
- Tarjetas de evento dentro de la conversación ("Envío aceptado", "Retiro confirmado", "En camino", "Entregado"):
  se mezclan con los mensajes los eventos de `GET /shipments/:id/events` (y el `{type:"status"}` del canal de
  tracking). **"Llegando"** no tiene evento hoy: depende de las notificaciones de cercanía, sin implementar.
- Separadores de día ("Hoy"), agrupar burbujas del mismo autor, respuestas rápidas por rol e iniciales.

## Detalles que conviene saber

- Texto de 1 a 1000 caracteres tras `trim`. Sin imágenes, sin "escribiendo…".
- Push (`chatMessageReceived`, categoría `chat`), al estilo WhatsApp (MOVO-301): a quien **no** tiene el chat abierto, con
  el nombre y rol de quien escribió como título y el **texto del mensaje** (cortado a 140 caracteres) como cuerpo. El
  primer mensaje avisa enseguida; los que llegan dentro de los 30 s siguientes (`CHAT_PUSH_WINDOW_SECONDS`) no mandan
  una push cada uno: se juntan en Redis (`chat-push-buffer:*`) y al cerrarse la ventana sale **un único resumen**
  ("3 mensajes nuevos · último texto"). El resumen se agenda para cuando cierra la ventana vigente (un solo reloj: un
  mensaje posterior nunca sale antes que uno anterior) y, al salir, relee el envío, vuelve a filtrar los autores
  bloqueados (DD-026) y se omite si el destinatario ya leyó la conversación. Así una ráfaga son como
  mucho dos avisos por ventana. El resumen lo agenda un `setTimeout` en el proceso: un reinicio entre medio lo pierde
  (el primer mensaje ya avisó). **Esto reemplaza el punto de ADR-023** ("sin el texto") por DD-046: el texto ahora se ve en la pantalla
  bloqueada, como en WhatsApp. El mobile saca de la bandeja las
  notificaciones de un chat al abrirlo.
- El hilo vive en `shipments.chat_messages` (solo se agrega). La retención y purga del historial no están
  definidas: es un dato personal, hay que decidirlo con el equipo junto con DD-023.
- El registro de sockets (`ChatHub`) está en memoria y es de una sola réplica, igual que el de tracking
  (ADR-006/019), y es aparte del de tracking para no mezclar mensajes ni cierres.
- "Reportar conversación" guarda el reporte (`chat_reports`) y deja un log `chat_conversation_reported`; todavía
  no hay un panel que lo muestre al equipo (MOVO-30/33).

## Probarlo a mano

```bash
# terminal 1: recibir como transportista
npx wscat -c ws://localhost:3002/shipments/<id>/chat -H "Authorization: Bearer <JWT del transportista>"
# terminal 2: enviar como emisor (directo al servicio; por el gateway no hace falta x-user-*)
curl -X POST localhost:3002/shipments/<id>/chat/messages \
  -H 'content-type: application/json' -H 'x-user-id: <uuid emisor>' -H 'x-user-roles: sender' \
  -d '{"body":"Hola","clientMessageId":"'$(uuidgen)'"}'
```
