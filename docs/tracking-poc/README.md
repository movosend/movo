# MOVO-200: PoC del canal de tiempo real (WebSocket nativo)

> Prueba de concepto mínima exigida por el AC5 de [MOVO-200](https://linear.app/movosend/issue/MOVO-200), spike que decidió la tecnología del canal de tiempo real (ver **ADR-022**, `CLAUDE.md` raíz, y el documento de conclusiones del spike linkeado al issue en Linear). **No es la implementación final** — esa es [MOVO-201](https://linear.app/movosend/issue/MOVO-201) (ticket hermano, bloqueado por este spike), que agrega el proxy del gateway, salas por envío/difusión a múltiples suscriptores, e ingesta real de GPS.

## Qué demuestra

Un canal WebSocket nativo (`@fastify/websocket`) en `services/movo-svc-shipments` que:

1. Valida el JWT de acceso (`Authorization: Bearer <token>`) en el momento del upgrade HTTP → WebSocket, con el mismo mecanismo (`verifyAccessToken` de `@movo/shared`) que usa el gateway hoy para requests HTTP normales.
2. Autoriza la suscripción: solo el emisor, el receptor o el transportista asignado del envío (o un admin) puede conectarse a `/shipments/:id/track` — cualquier otro usuario autenticado recibe un cierre `4003`.
3. Empuja un mensaje de posición de muestra al cliente ya conectado.

Código: `services/movo-svc-shipments/src/plugins/websocket.ts` (registra el plugin) y `services/movo-svc-shipments/src/modules/tracking/tracking-poc.routes.ts` (la ruta, con el resto de las decisiones documentadas en los comentarios del archivo).

## Simplificaciones deliberadas (no son bugs)

- **Conecta directo a `svc-shipments`, sin pasar por el gateway.** El proxy de WebSocket del gateway es el alcance de MOVO-201. Por eso esta PoC valida el JWT ella misma en vez de confiar en `x-user-*` (ADR-010 asume que ese trust model arranca en el gateway).
- **Sin salas ni difusión.** Autoriza una vez al conectar y empuja un único mensaje — no hay múltiples suscriptores por envío todavía.
- **Sin ingesta real de GPS.** La posición que empuja es una constante (Córdoba Capital), no viene de ningún transportista real.
- **Códigos de cierre WS "privados" (RFC 6455, ≥4000)** para distinguir el motivo del rechazo sin un status HTTP (no hay uno que rechazar — el upgrade ya se completó del lado de TCP antes de que el handler pueda validar): `4001` sin token / token inválido, `4003` sin permiso sobre el envío, `4004` envío inexistente.

## Cómo correrla

### 1. Levantar el servicio con sus dependencias reales

Desde la raíz del repo (ver `README.md` para el setup completo si no lo tenés corriendo):

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis
cd services/movo-svc-shipments
npm run dev
```

Necesitás un `.env` local con al menos `DATABASE_URL`, `REDIS_URL` y `JWT_SECRET` (mismo `JWT_SECRET` que usa `movo-svc-users`/el gateway para emitir el token, ver `.env.example`).

### 2. Conseguir un `shipmentId` real y un access token

Usá el flujo normal de la API (vía el gateway, puerto 3000 salvo que lo hayas cambiado):

```bash
# Login para obtener un access token real
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<tu usuario de dev>","password":"<...>"}'

# Un envío donde ese usuario sea emisor/receptor/transportista -- por ejemplo,
# el que ya tengas de punta a punta probando MOVO-80/MOVO-158, o creá uno nuevo
# con POST /api/v1/shipments
```

### 3. Conectar al canal

`svc-shipments` corre en el puerto que tenga configurado (`PORT`, default `3000` — **si corrés el gateway en el mismo puerto, cambiá uno de los dos** para probar la PoC en paralelo). Con [`wscat`](https://www.npmjs.com/package/wscat) instalado:

```bash
wscat -c "ws://localhost:<PORT_SVC_SHIPMENTS>/shipments/<shipmentId>/track" \
  -H "Authorization: Bearer <accessToken>"
```

O con un script de Node (usando el paquete `ws`, ya instalado como dependencia transitiva del servicio):

```js
const WebSocket = require("ws");
const ws = new WebSocket("ws://localhost:<PORT_SVC_SHIPMENTS>/shipments/<shipmentId>/track", {
  headers: { authorization: "Bearer <accessToken>" },
});
ws.on("message", (data) => console.log(JSON.parse(data.toString())));
ws.on("close", (code, reason) => console.log("cerrado:", code, reason.toString()));
```

Resultado esperado: un único mensaje

```json
{ "type": "position", "shipmentId": "<shipmentId>", "lat": -31.4201, "lng": -64.1888, "at": "<ISO timestamp>" }
```

Probá también el camino negativo: sin header `Authorization` (cierre `4001`), con el token de un usuario ajeno al envío (cierre `4003`), y con un `shipmentId` inexistente (cierre `4004`).

### 4. Desde Expo (cliente real, no wscat)

El `WebSocket` global de React Native (a diferencia del de un browser) acepta un tercer parámetro de opciones con `headers` custom — es la base de la decisión del ADR-022 ("sin fricción extra" para auth vía Authorization header, ver la comparación del spike):

```ts
const ws = new WebSocket(`ws://<host>:<PORT_SVC_SHIPMENTS>/shipments/${shipmentId}/track`, undefined, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

Requiere un dev build (no Expo Go, que no soporta módulos nativos custom en general — para esta PoC en particular alcanza con el WebSocket global, pero se corrió contra un dev build real como pide el AC5 del ticket).

## Impacto en infraestructura (AC3 del spike, sin aplicar todavía)

Esta PoC se probó **sin pasar por nginx** (conexión directa al contenedor/proceso de `svc-shipments`). El riesgo real identificado por el spike -- nginx no reenvía los headers `Upgrade`/`Connection` y su `proxy_read_timeout` (30s) corta cualquier conexión persistente -- sigue sin corregirse en `infra/nginx/templates/default.conf.template`. Queda como pendiente explícito del DoD de MOVO-200, a aplicar y probar contra una conexión de larga duración antes de que MOVO-201 dependa de él en producción.
