# CLAUDE.md — infra

Nginx, Compose y el canal WebSocket (ADR-022). Contexto general del proyecto en el `CLAUDE.md` de la raíz.

### MOVO-200 — Spike: canal de tiempo real (ADR-022)

Cierra la incertidumbre sobre el canal de tiempo real (ver "Pendientes transversales"
histórico — no había ninguna línea de WebSocket/Socket.io/SSE en el repo antes de este
spike). Decisión: **WebSocket nativo vía `@fastify/websocket`** (ADR-022), no
Socket.io ni SSE — reemplaza la mención a Socket.io que traía ADR-005. Documento de
conclusiones completo linkeado al issue en Linear (relevamiento, comparación de las 3
tecnologías, impacto en infra, esbozo de auth/autorización).

- **PoC mínima (AC5) en esta misma rama**: `services/movo-svc-shipments/src/plugins/
  websocket.ts` + `src/modules/tracking/tracking-poc.routes.ts` —
  `GET /shipments/:id/track` (WS) valida el JWT en el handshake
  (`verifyAccessToken`, mismo mecanismo que el gateway), autoriza por pertenencia al
  envío (`assertShipmentAccess` + `carrierId`) y empuja una posición de muestra.
  **No era la implementación final** — MOVO-201 (ticket hermano bloqueado por este
  spike, ver su entrada más abajo) la reemplazó por completo: conectaba directo a
  `svc-shipments` sin pasar por el gateway, sin salas ni difusión a múltiples
  suscriptores, sin ingesta real de GPS. La doc de uso vive ahora en
  `docs/tracking/README.md` (`docs/tracking-poc/` ya no existe).
- **MOVO-159 AC4 resuelto**: el condicional "polling o suscripción si hay Socket.io"
  pasa a "suscripción por WebSocket, cuando MOVO-201 esté disponible" — ese reemplazo
  de polling se hace en los tickets de implementación de MOVO-159/MOVO-199, no en este
  spike.
- **AC3 (infra) aplicado y validado localmente**: `infra/nginx/templates/
  default.conf.template` suma un `map $http_upgrade $connection_upgrade` (patrón
  estándar de nginx para servir HTTP y WS desde el mismo `location`, sin forzar
  `Connection: upgrade` en requests normales) + `proxy_set_header Upgrade/Connection` +
  `proxy_read_timeout` de 30s a 3600s. Validado con el stack local real
  (`infra/docker-compose.local.yml`, nginx real con cert self-signed, no mockeado):
  arranca sin errores con el template nuevo (equivalente a `nginx -t`, que este entorno
  no tenía disponible antes), el tráfico normal sigue funcionando
  (`curl https://localhost:8443/health` → 200), y un WebSocket real de punta a punta
  (TLS en nginx → upgrade reenviado → JWT validado → mensaje recibido) funciona
  apuntando nginx directo a `svc-shipments` (prueba temporal, revertida — el gateway
  real hoy responde 404 a ese path porque `@fastify/http-proxy` no reenvía upgrades de
  protocolo, confirmando que el hueco es MOVO-201, no nginx). El timeout subido aplica
  a TODO el `location /` (no solo a rutas WS, que todavía no existen como tales del
  lado del gateway) — trade-off documentado inline en el archivo. Sin probar contra un
  deploy real en dev/prod (EC2) todavía.
- **Pendiente de este ticket**: estimación informada de los tickets de implementación
  de MOVO-11/MOVO-201 (identificados, sin horas concretas todavía).

### MOVO-201 — Canal de tiempo real: implementación real (gateway + `svc-shipments`)

Reemplaza la PoC de MOVO-200 sobre la tecnología que fijó ADR-022. Detalle completo en
`gateway/CLAUDE.md` y `services/movo-svc-shipments/HISTORIAL.md` (ambos con entrada propia
de MOVO-201) — acá solo lo transversal.

- **El gateway ahora sí proxea el upgrade WS** (`config/routes-map.ts#ServiceRoute.
  websocket`, solo en `/shipments`): `@fastify/http-proxy` lo maneja internamente sin
  necesitar `@fastify/websocket` ahí, pero no reenvía `x-user-*` al upstream por default
  en una conexión WS (solo `cookie`) — hubo que agregar un `wsClientOptions.
  rewriteRequestHeaders` propio. Cierra el hueco que el spike de MOVO-200 había
  confirmado (`@fastify/http-proxy` no reenviaba upgrades de protocolo en absoluto).
- **Heartbeat ping/pong implementado** (cada 30s, `movo-svc-shipments`) — cierra el
  pendiente transversal que había dejado MOVO-200 (ver abajo, la entrada vieja quedó
  resuelta) y permitió bajar `proxy_read_timeout` de nginx de 3600s a 90s.
- **Auth de browser (`movo-admin`/MOVO-33) queda diseñada, no implementada**: mecanismo
  elegido, subprotocolo `Sec-WebSocket-Protocol` (no query param, por el riesgo de
  logueo del JWT en nginx/Cloudflare) — sin consumidor real todavía (MOVO-33 no está
  bloqueado por MOVO-201), así que no se implementó código sin usar.
- **Sin verificar contra un deploy real en dev/prod (EC2)** — AC6 del ticket, mismo
  pendiente que ya traía MOVO-200 para nginx; esta sesión no tuvo acceso a esa infra.
