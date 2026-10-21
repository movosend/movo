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
quiere igual, que devuelva esa misma constante).

## Reglas de escritura

- Toda escritura (responder, nota, asignar, prioridad, tema, etiquetas, vincular, resolver, reabrir, pedir un adjunto)
  pasa por `runAdminAction` de `svc-admin`: bitácora y **conflicto de interés**. Sobre una consulta cuyo `user.id` es el admin
  responde `403 ADMIN_CONFLICT_OF_INTEREST` (agregar `support_conversation` a `AdminTargetType` y a `conflict-of-interest.ts`).
  El panel lo muestra como aviso y deja el compositor deshabilitado.
- Responder pasa la conversación a `awaiting_user`, la asigna al agente si no tenía y deja el evento; responder sobre una
  `resolved` la reabre con su evento.
- Los textos de los eventos `system` los arma el servidor **en tercera persona** ("Tomás Ferreyra tomó la conversación",
  "Prioridad: alta", "Vinculada a #MOVO-48176"): el mismo mensaje lo leen todos los agentes.
- `waitMinutes` lo calcula el servidor (desde el último mensaje del usuario sin respuesta; 0 si no espera).
- Vincular un envío valida que el usuario de la consulta sea parte → si no, `422 SUPPORT_SHIPMENT_NOT_PARTY`.
- Errores propios: `SUPPORT_CONVERSATION_NOT_FOUND` (404), `SUPPORT_ATTACHMENT_INVALID` (422), `SUPPORT_SHIPMENT_NOT_PARTY` (422),
  `SUPPORT_TICKET_INVALID` (401), `SUPPORT_SERVICE_UNAVAILABLE` (502). Ya están en `ApiErrorCode`.

## Adjuntos (MOVO-321)

`POST attachments` valida `image/jpeg|png|webp` y ≤ 5 MB → `{ attachmentId, uploadUrl, expiresAt }`; el panel redimensiona
(lado máx. 1600 px) y hace `PUT`. Al enviar el mensaje (`attachmentIds`, hasta 4) el servidor verifica que el objeto exista con el
tipo y tamaño declarados; cada adjunto se usa una vez y solo por quien lo creó. Los mensajes devuelven
`{ id, contentType, width?, height?, url }` con `url` firmada y de vida corta, generada al leer. Prefijo privado `support/<conversationId>/…`.

## Tiempo real

El panel no puede usar el JWT en el navegador (cookies `__Host-*` httpOnly) ni mandar `Authorization` en un `WebSocket`, y Vercel no
hospeda WS. Diseño:

1. Server Action → `POST realtime-ticket` → `{ ticket, url, expiresAt }`. Un solo uso, ~30 s, atado al admin y al origin.
2. El navegador conecta con `new WebSocket(url, ["movo-support.v1", ticket])`. El servidor valida el ticket, **responde solo el subprotocolo
   `movo-support.v1`** (nunca el ticket) y rechaza el upgrade si es inválido.
3. Hospedaje: **`svc-admin`**, expuesto por el gateway en `/api/v1/admin/support/ws` (hay que habilitar el upgrade en el gateway y en
   `infra/nginx`). `svc-admin` se suscribe al `ChatHub` de `svc-shipments` por un endpoint interno y retransmite solo eventos de soporte.
   Los agentes reciben **todos** los eventos de soporte, incluidas las notas.
4. Eventos (`SupportEvent`, cada uno con `cursor` monótono y opaco): `conversation_created`, `support_message` (trae la fila ya actualizada),
   `conversation_updated`, `counts_updated`.
5. Respaldo: si el WS falla 3 veces seguidas el panel pasa a `GET events?since=<cursor>` cada 10 s (sigue intentando el WS). Sin `since` devuelve
   `{ events: [], cursor }` (arranca desde ahora). `reset: true` = el servidor ya no guarda tantos eventos; el panel vuelve a pedir lista, contadores y mensajes.
   Alcanza con retener unos minutos de eventos.
6. Los eventos nunca llevan notas internas hacia el usuario; el canal del usuario (mobile, MOVO-319) es otro.

## Pendiente de backend (para 321/322)

Todo lo anterior. El panel funciona hoy contra `MOVO_ADMIN_MOCK=1` (ver `movo-admin/CLAUDE.md`, entrada MOVO-323).
