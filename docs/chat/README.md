# Chat entre las partes de un envío (MOVO-26)

Un hilo por envío entre emisor, receptor y transportista. Se **envía por HTTP** y se **recibe por
WebSocket** (mismo molde que la ingesta de posiciones, ADR-024). Decisión y trade-offs: `adr-040-chat-propio.md`.

## Endpoints (`movo-svc-shipments`, prefijo `/shipments`, pasan por el gateway)

| Método | Ruta | Qué hace |
| --- | --- | --- |
| `POST` | `/:id/chat/messages` | Envía un mensaje `{ body, clientMessageId }`. 201 la primera vez, 200 si es un reenvío (idempotente por `clientMessageId`). |
| `GET` | `/:id/chat/messages?limit=&cursor=` | Historial del más reciente al más antiguo, con cursor opaco. Devuelve `access`: `open` o `read_only`. |
| `GET` (WS) | `/:id/chat` | Canal de recepción: `{type:"connected"}` y `{type:"chat_message", message}`. El cliente no manda nada por acá. |

El WebSocket se autentica con `Authorization: Bearer <JWT>` en el handshake (como `/track`). Códigos de cierre:
`4001` token inválido o vencido (reconectar con token nuevo), `4003` sin permiso, `4004` envío inexistente,
`4009` el chat ya no está disponible (no reconectar).

## Cuándo está disponible

- Desde que hay transportista asignado (`assignment_pending`, `assigned_unfunded`, `assigned`, `in_transit`).
- Hasta 24 h después de `delivered`/`completed` (`CHAT_POST_DELIVERY_WINDOW_HOURS`).
- `cancelled` y `rejected_by_receiver` lo cierran en el acto (se cortan los sockets abiertos).
- `disputed`: solo lectura.
- El receptor que transfirió la recepción (ADR-038) lee, no escribe.
- Un bloqueo (ADR-026) entre quien escribe y cualquiera de las otras partes corta la escritura
  (`403 USER_BLOCKED`); la lectura sigue.
- El **admin** lee el historial siempre (evidencia de disputa) y nunca escribe.

Fuera de la ventana: `409 CHAT_CLOSED` (también en el historial para las partes). Sin permiso de escritura:
`403 CHAT_READ_ONLY`. Reglas puras en `src/domain/chat-window.ts`.

## Detalles que conviene saber

- Texto de 1 a 1000 caracteres tras `trim`. Sin imágenes, sin "escribiendo…", sin leído/no leído.
- Push (`chatMessageReceived`, categoría `chat`): se manda a quien **no** tiene el chat abierto, una vez por
  minuto y por destinatario, y sin el texto del mensaje (se vería en la pantalla bloqueada).
- El hilo vive en `shipments.chat_messages` (solo se agrega). La retención y purga del historial no están
  definidas: es un dato personal, hay que decidirlo con el equipo junto con ADR-023.
- El registro de sockets (`ChatHub`) está en memoria y es de una sola réplica, igual que el de tracking
  (ADR-006/022). Es una instancia aparte de `realtimeRegistry` para no mezclar mensajes ni cierres.

## Probarlo a mano

```bash
# terminal 1: recibir como transportista
npx wscat -c ws://localhost:3002/shipments/<id>/chat -H "Authorization: Bearer <JWT del transportista>"
# terminal 2: enviar como emisor (directo al servicio; por el gateway no hace falta x-user-*)
curl -X POST localhost:3002/shipments/<id>/chat/messages \
  -H 'content-type: application/json' -H 'x-user-id: <uuid emisor>' -H 'x-user-roles: sender' \
  -d '{"body":"Hola","clientMessageId":"'$(uuidgen)'"}'
```
