# Canal de tiempo real (WebSocket nativo)

Implementación real de [MOVO-201](https://linear.app/movosend/issue/MOVO-201) sobre la
tecnología que decidió el spike [MOVO-200](https://linear.app/movosend/issue/MOVO-200)
(ver **ADR-022**, `CLAUDE.md` raíz). Reemplaza la PoC de MOVO-200 (antes
`docs/tracking-poc/`) — esta carpeta documenta el canal tal como corre hoy, no un
experimento.

## Qué hace

Un canal WebSocket nativo (`@fastify/websocket`) en `services/movo-svc-shipments`,
detrás del proxy de `movo-api-gateway`, que:

1. Valida el JWT de acceso (`Authorization: Bearer <token>`) en el momento del upgrade
   HTTP → WebSocket, con el mismo mecanismo (`verifyAccessToken` de `@movo/shared`) que
   usa el gateway hoy para requests HTTP normales — `src/services/realtime-authorizer.ts`.
2. Autoriza la suscripción: solo el emisor, el receptor, el transportista asignado o un
   admin del envío puede conectarse a `/shipments/:id/track`. Cualquier otro usuario
   autenticado recibe un cierre `4003`.
3. Cierra la conexión — al conectar o mientras sigue abierta — apenas el envío llega a un
   estado que corta el tracking (`delivered`, `completed`, `cancelled`,
   `rejected_by_receiver`, `disputed`), código `4009`. AC6 de MOVO-11: la ubicación del
   transportista no es visible una vez completado el handshake de entrega.
4. Mantiene la conexión viva detrás de nginx/Cloudflare con un ping/pong de protocolo
   cada 30s (`HEARTBEAT_INTERVAL_MS`) y termina el socket si un cliente deja de
   responder.
5. Registra cada conexión en `app.realtimeRegistry` (`src/plugins/realtime.ts`) — un
   mapa en memoria `shipmentId -> sockets`, agnóstico del tipo de mensaje, para que la
   ingesta de posiciones (MOVO-202) y futuros canales (chat, MOVO-26) lo reusen sin
   rediseñarlo.

Fuera de alcance de MOVO-201 (tickets hermanos): la ingesta y persistencia real de
posiciones GPS (MOVO-202), la emisión desde el mobile, y el chat (MOVO-26).

## Cómo probarlo en local

### 1. Levantar el stack completo (gateway + svc-shipments + Postgres/Redis)

```bash
docker compose -f infra/docker-compose.yml up -d
```

O corriendo `movo-svc-shipments` fuera de Docker para iterar más rápido (`npm run dev`
en el servicio, con Postgres/Redis reales levantados vía compose) — en ese caso conectá
directo al puerto del servicio en vez de al gateway.

### 2. Conseguir un `shipmentId` real y un access token

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<tu usuario de dev>","password":"<...>"}'
```

Un envío donde ese usuario sea emisor/receptor/transportista (por ejemplo, el que ya
tengas de punta a punta probando MOVO-80/MOVO-158, o creá uno nuevo con
`POST /api/v1/shipments`).

### 3. Conectar al canal, a través del gateway

Con [`wscat`](https://www.npmjs.com/package/wscat):

```bash
wscat -c "ws://localhost:3000/api/v1/shipments/<shipmentId>/track" \
  -H "Authorization: Bearer <accessToken>"
```

Resultado esperado: un mensaje `{"type":"connected","shipmentId":"<shipmentId>"}` y la
conexión se mantiene abierta (ping/pong cada 30s, invisible para `wscat`).

Probá también los caminos negativos: sin header `Authorization` (cierre `4001`), con el
token de un usuario ajeno al envío (cierre `4003`), `shipmentId` inexistente (cierre
`4004`), y un envío ya `delivered`/`cancelled`/etc. (cierre `4009` inmediato).

### 4. Desde Expo (cliente real, mobile)

```ts
const ws = new WebSocket(`ws://<host>:3000/api/v1/shipments/${shipmentId}/track`, undefined, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

El `WebSocket` global de React Native acepta headers custom en el handshake (a
diferencia del de un browser estándar — ver la nota de auth para browser más abajo).
Requiere un dev build, no Expo Go.

## Decisiones no obvias

- **El JWT se valida en `svc-shipments`, no solo en el gateway**: aunque el gateway ya
  proxea el upgrade con `x-user-*` inyectados (ver más abajo), la ruta sigue verificando
  el JWT real. Una conexión WS es de larga duración — validar el token real en vez de
  confiar en un header derivado en el momento del handshake HTTP de otra request es más
  estricto, no redundante.
- **El proxy del gateway (`@fastify/http-proxy`) no reenvía `x-user-*` por default en una
  conexión WS** — su `rewriteRequestHeaders` de default solo reenvía `cookie`.
  `gateway/src/routes/index.ts` agrega un `wsClientOptions.rewriteRequestHeaders` propio
  que reenvía `x-user-id`/`x-user-roles`/`x-kyc-status`/`x-request-id`, los mismos que ya
  inyecta el `preHandler` para HTTP normal (ADR-010). Sin esto, la request HTTP normal a
  `/shipments/*` funcionaba con la identidad inyectada pero la conexión WS al mismo
  prefijo llegaba "anónima" al servicio.
- **Cierre por estado vía `EventEmitter` en proceso, no polling**: `shipment-repository.ts
  #updateStatus()` (única vía de escritura de `status`, MOVO-104) emite un evento que
  `realtime.ts` escucha para cerrar en el acto los sockets de ese envío — sin esperar a
  que el cliente reconecte. Alcanza porque `svc-shipments` corre en una sola réplica
  (ADR-006); no hay mecanismo cross-proceso (no hace falta un message broker, ADR-001).
- **Auth para clientes de navegador (`movo-admin`/MOVO-33), diseñado y NO implementado
  todavía**: el `WebSocket` nativo de un browser no permite headers custom, así que
  `Authorization: Bearer` (lo que usa el mobile) no sirve ahí. El mecanismo elegido para
  cuando haga falta es un subprotocolo (`Sec-WebSocket-Protocol`) que viaje el JWT — no
  un query param (`?token=...`), porque una URL con el JWT queda logueada en los access
  logs de nginx/Cloudflare. `movo-admin`/MOVO-33 no está bloqueado por MOVO-201; queda
  pendiente para cuando ese ticket lo necesite.
