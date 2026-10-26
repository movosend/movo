# Prueba de flujo completo, 25/10/2026 (dev)

Primera prueba real de punta a punta: un envío creado, ofertado, pagado, retirado con QR, seguido en vivo
y entregado con QR, con dispositivos reales en la calle. Este informe contrasta lo que quedó en la BD y en
los logs de dev contra la referencia de [`flujo-esperado-e2e.md`](./flujo-esperado-e2e.md) y documenta
cada problema encontrado, con evidencia, causa y propuesta.

- **Envío:** `6c0d8b51-69bc-4cc7-b558-538208f530ab`, hoy `completed` con
  `payment_simulated = true`.
- **Viaje:** `b84ffbb4-3102-41d6-b67b-24186c1e98b7` (auto-creado al aceptar).
- **Horarios en UTC** (ART = UTC−3). Retiro 21:54, entrega 23:33.
- **Evidencia:** `/home/ubuntu/movo/dump-20261025/` en la EC2 de dev: dumps de logs por servicio desde las
  00:00 del 25/10 y la salida de `flujo-esperado-e2e.sql` (`envio-6c0d8b51.txt`). Se puede borrar
  cuando ya no haga falta; no tiene secretos, pero sí datos de usuarios de prueba.

## Resumen

| # | Problema | Severidad | Dónde | Estado |
|---|---|---|---|---|
| 1 | Al transportista se le cerró la sesión a mitad del viaje y se cortó el tracking 26 min | **Crítica** | `movo-mobile` (sesión) | Causa identificada, falta el fix |
| 2 | El sandbox de MP no respondió: 4 intentos de pago fallidos, se resolvió forzando el estado | Alta (externa) | MP / `svc-payments` | Mitigado con DD-055 |
| 3 | El barrido de timeout revirtió la asignación durante la caída de MP, y casi lo hace dos veces | Media | `svc-shipments` (saga) | Comportamiento de diseño, a revisar |
| 4 | Deploys en plena prueba: borraron logs y causaron 5xx | Media (proceso) | CI/CD | Regla nueva en el doc de referencia |
| 5 | El optimizador de rutas siempre da timeout (cliente a 1 s) | Media | `svc-shipments` → pricing | Causa identificada |
| 6 | 503 de nginx por rate limit al volver la app a primer plano | Media | `infra/nginx` + mobile | Causa identificada |
| 7 | El panel abre y cierra el WebSocket de soporte en loop (~1 ticket cada 2 s) | Media | config dev + `movo-admin` | Causa identificada |
| 8 | `GET /trips/:id/matches` da 409 en cada poll con el viaje activo | Baja | `movo-mobile` | Causa identificada |
| 9 | `GET /shipments/undefined/ratings` (400) | Baja | `movo-mobile` | Causa identificada |
| 10 | Envíos de pruebas anteriores con holds `manual-*` y uno trabado en `delivered` | Baja (datos) | BD de dev | Limpiar |
| — | `POST /users/me/legal-acceptance` 422 | — | build viejo (Movo/14) | Conocido, fuera de alcance |

## Línea de tiempo del envío

Reconstruida de `shipment_events`, `holds`, `admin.audit_log` y el access log de nginx. Los logs de
aplicación anteriores a las 21:48 se perdieron (ver #4).

| Hora | Qué pasó |
|---|---|
| 19:50 | El emisor crea el envío (precio sugerido $14.240, `package_tapered_v3`, `distanceSource: routes_api`). 2 fotos de creación |
| 20:32 | El receptor acepta → `published` |
| 20:39–20:40 | El transportista oferta ($14.240) y el emisor acepta → `assignment_pending` (ruta cercana, retiro el mismo día) |
| 20:40–20:59 | Tres `POST /funding`, todos **502 tras ~10 s** (MP no responde). Holds 1 (`superseded`), 2 y 3 (`abandoned`) |
| 20:55 | Primer intento de forzar a `assigned` desde el panel: falla con `HOLD_NOT_AUTHORIZED` (el pago simulado todavía no estaba deployado) |
| 21:16 | El barrido de timeout revierte el envío a `published` (36 min después de aceptar). La oferta queda `assignment_lapsed` |
| 21:17 | El transportista oferta de nuevo y el emisor acepta → `assignment_pending`, viaje auto-creado `b84ffbb4` |
| 21:17 | Cuarto `POST /funding`: 502. Hold 4 `abandoned` |
| 21:48 | **Deploy** (PR #318, pago simulado) |
| 21:50 | Forzado a `assigned` con `simulatePayment` (OK) |
| 21:51 | El transportista inicia el viaje y llega al retiro (`carrier_arrived_pickup`, 12,8 m de precisión) |
| 21:54 | Handshake de retiro (4,6 m) → `in_transit`. Hubo 4 `generate` antes: el QR vence a los 15 s y la foto de retiro se subió recién a las 21:54:35 |
| **22:16** | **Se cierra la sesión del transportista** (#1). Último punto GPS guardado: 22:15:51 |
| **22:42** | El transportista vuelve a iniciar sesión y el tracking se reanuda |
| 23:33 | Handshake de entrega (21 m) → `delivered` → `completed` 44 ms después (liquidación sintética) |
| 23:33 | `trip_auto_completed` |
| 23:33–12:26 (26/10) | Calificaciones: el transportista califica a receptor y emisor, el emisor al transportista |

Lo que coincidió con la referencia: fotos, handshakes (distancias, actores, `reason`), `pickup_evidence`,
`trips.started_at`, el cierre automático del viaje, la marca del pago simulado (`payment_simulated`,
`kind = manual`, `actor_id` del admin, `audit_log`, logs `payment_simulated` y `shipment_status_forced`)
y la ausencia de liquidación y webhooks en payments. El detalle por paso está en la referencia.

---

## 1. Sesión cerrada a mitad del viaje (crítico)

**Síntoma.** A las 22:16 el transportista quedó deslogueado sin hacer nada. El tracking en vivo se cortó
hasta que volvió a entrar a las 22:42. En la BD hay 96 posiciones contra ~132 esperables, con un hueco de
25 min 46 s (22:15:51 → 22:41:38) en `captured_at`.

**Evidencia** (access log de nginx, IP del transportista `181.239.18.65`):

```
21:16:46  POST /auth/refresh                 200   ← último refresh antes del corte
22:16:51  POST /shipments/positions          401   ← 60 min exactos después: venció el access token (ADR-004)
22:16:52  GET  /shipments/transporting       401
22:16:52  GET  /trips?status=active          401
22:16:52  POST /shipments/positions          401
22:16:52  POST /auth/refresh                 200   ← el refresh ANDA
22:16:52  POST /shipments/positions          401   ← pero las requests siguientes salen sin sesión
22:16:52  POST /shipments/positions          401
22:16:53  GET  /shipments/transporting       401
          (nada más de este dispositivo durante 25 min)
22:42:06  POST /auth/login                   200
22:42:06  POST /shipments/positions          200   ← se reanuda; sale primero lo que quedó en la cola
```

En Redis (`refresh:<userId>:<tokenId>`, TTL de 90 días, la creación sale de `now − (90 d − TTL)`):

| Token | Creado | `used` | Qué es |
|---|---|---|---|
| `4cb87eaf…` | 21:16 | `true` | el que se gastó en el refresh de las 22:16 |
| **`1d4bbee2…`** | **22:16** | **`false`** | **el que emitió ese refresh: la app nunca lo usó** |
| `140d7280…` | 22:42 | `true` | el del login manual |

El servidor rotó bien la sesión y la app descartó el token nuevo. **No hubo reuso**: no se presentó
ningún token viejo y no se disparó `revokeAllForUser`, porque `1d4bbee2` sigue vivo. Es decir, la app
borró su propia sesión localmente después de recibir una nueva válida.

**Causa.** Coincide punto por punto con este camino del código:

1. `movo-mobile/src/api/http-client.ts` (`request` / `doRefresh`): ante el 401 `AUTH_TOKEN_EXPIRED` hace
   el refresh y después `await authHooks.onTokensRefreshed(session)`.
2. `onTokensRefreshed` es `setSession` (`src/store/auth-store.ts:91`), que hace **primero**
   `await persistSession(session)` (4 escrituras en `expo-secure-store`) y **recién después** actualiza el
   estado en memoria.
3. `src/lib/secure-store.ts` llama a `SecureStore.setItemAsync` sin `keychainAccessible`, así que usa el
   default **`WHEN_UNLOCKED`**: en iOS, el Keychain rechaza la escritura con el teléfono bloqueado.
4. A las 22:16 la app muy probablemente corría en segundo plano con el teléfono bloqueado: el envío
   anterior había salido 76 s antes, cuando en primer plano sale uno cada 25 s, y en segundo plano lo
   que despierta la app es la tarea de ubicación (`tracking-task.ts`). La escritura falla, `doRefresh` rechaza y el `catch` del interceptor llama a
   **`onAuthFailure()` → `clearSession()`**. Borrar del Keychain sí funciona bloqueado, así que la sesión
   queda vacía en memoria y en disco.
5. Con `isAuthenticated = false`, `hooks/use-carrier-tracking.ts` (efecto de sincronización) llama a
   **`locationService.stopTracking()`**: deja de **capturar**, no solo de enviar. Eso explica el hueco en
   `captured_at`. Las posiciones ya encoladas no se pierden, porque el lote no descarta ante un 401: la
   del 22:15:51 se guardó recién a las 22:42 (`max_demora_ingesta` = 26 min). Al volver a iniciar sesión,
   el efecto arranca el tracking de nuevo, que es lo que vio el transportista.

Las requests de las 22:16:52 que siguieron dando 401 son las que estaban en vuelo o encoladas cuando se
limpió la sesión: salieron sin `Authorization`.

**Qué no está verificado.** El error exacto del Keychain no quedó registrado: la app no tiene telemetría
de errores. La cadena es consistente con toda la evidencia, del servidor y de Redis, y no hay otra que lo
sea: un cierre de la app a mitad del refresh habría dejado el token viejo en el Keychain y el siguiente
arranque habría disparado la detección de reuso, que no ocurrió. **Para reproducirlo:** iniciar un viaje
en un iPhone, bloquearlo y esperar a que venza el access token (60 min desde el último refresh), con la
app en segundo plano.

**Por qué importa.** Le pasa a cualquier transportista que maneje más de una hora con el teléfono
bloqueado. El tracking deja de funcionar sin aviso, y el emisor y el receptor ven "sin señal". Además
pierde la sesión en el momento menos oportuno: tiene que volver a iniciar sesión para el handshake de
entrega.

**Propuesta** (en `movo-mobile`, una US):

- Guardar las keys `session*` con `keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK` (legibles y
  escribibles con el teléfono bloqueado después del primer desbloqueo desde que se prendió). Es la opción
  estándar para tokens que usa una tarea en segundo plano. Hay que migrar las keys ya guardadas: se
  reescriben en el próximo `setSession`.
- En `setSession`, actualizar el estado en memoria **antes** de persistir, y que un fallo de persistencia
  no se trate como fallo de autenticación. El servidor ya rotó el token: tirarlo garantiza perder la
  sesión. Reintentar la escritura más tarde, por ejemplo al volver a `active` en `AppState`.
- En `request()`, llamar a `onAuthFailure` solo si el **servidor** rechazó el refresh (401/403 de
  `/auth/refresh`), no ante cualquier excepción local.
- Opcional: refresco proactivo del access token cuando la app vuelve a primer plano o antes de que
  venza, para no depender del primer 401 en background.
- Sumar una prueba manual al DoD: viaje de más de 60 min con el teléfono bloqueado.

## 2. Caída del sandbox de Mercado Pago (externa, mitigada)

**Evidencia.** Cuatro `POST /shipments/:id/funding`, todos 502 a los ~10 s (20:40:34, 20:40:52,
20:59:10, 21:17:39), es decir, el timeout del SDK contra MP (`MERCADOPAGO_TIMEOUT_MS`). En
`payments.holds`:

| attempt | status | status_detail | Lectura |
|---|---|---|---|
| 1 | `rejected` | `superseded` | el emisor reintentó con otra tarjeta: el intento sin respuesta se cerró para abrir otro (`hold.service.ts`, `closeAttempt(…, "superseded")`) |
| 2–4 | `rejected` | `abandoned` | MP no tenía el pago a los 10 min: el intento se cierra (`"intento de hold abandonado: MP no tiene el pago"`) |

Ninguno tiene `mp_payment_id`, no hay un hold vivo huérfano y la plata del emisor no quedó retenida.
Las reservas de deuda del transportista (`fee_offset`, $515,25 en cada intento) se anularon con los
holds, como corresponde. **Esa deuda sigue sin cobrar**, porque con el pago simulado no se crea ningún
hold que la reserve.

Los logs de `svc-payments` de ese momento se perdieron con el deploy de las 21:48 (#4), así que no se
puede ver el `mpHttpStatus` exacto. El código prevé esta caída tal como pasó (variante A de la
referencia). Lo que faltó fue una salida operativa, y para eso se deployó a mitad de la prueba el pago
simulado (DD-055, MOVO-333).

**Propuesta.** Nada en el código. Para la próxima prueba, tener `ALLOW_SIMULATED_PAYMENTS=true` en dev
desde antes (ya lo está) y decidir de antemano si se usa. No hay alerta de Telegram para "MP no responde
al crear holds": hoy solo hay alertas para la liquidación escalada y el webhook agotado. Un contador de
`"MP no respondió al crear el hold"` en una ventana sería una alerta útil. Queda como idea, sin ticket.

## 3. El barrido de timeout revirtió la asignación durante la caída

**Evidencia.** `assignment_pending → published` a las 21:16:15, `reason = "El emisor no completó el pago
dentro del plazo"`. Los 30 min (`FUNDING_PAYMENT_TIMEOUT_MINUTES`) se cuentan desde
`last_status_changed_at` (la aceptación de las 20:40), no desde el último intento de pago
(`fundingPayUntil`, `funding.service.ts`). El emisor reintentó a las 20:59 y el plazo igual venció a las
21:10. Entre las 21:10 y el barrido, `GET /funding` respondió 409 `SHIPMENT_FUNDING_NOT_AVAILABLE`
(21:15:35 y 21:15:49 en nginx). Hubo que repetir oferta y aceptación.

La segunda espera (desde las 21:17:24) también superó los 30 min antes del forzado de las 21:50:27:

- **Sin el deploy**, el barrido del contenedor viejo corría a los :x1:15 / :x6:15, así que habría
  revertido a las ~21:51:15. **El forzado le ganó por 48 s.**
- Con el deploy, el barrido arranca con `setInterval` sin una corrida inicial (`plugins/register-sweep.ts`)
  y corrió por primera vez a las 21:53:58. A las 21:58:58 revirtió otro envío de un script de prueba
  (`3003899d`).

**Lectura.** Funciona según DD-037: la saga no puede dejar a un transportista reservado sin pago. Pero
ante una caída del proveedor, el plazo castiga al emisor por algo que no controla, y cada reversión
obliga al transportista a ofertar de nuevo.

**Propuesta, a decidir (DD).** Que un intento de pago con una respuesta pendiente o con error del
proveedor (`502 PAYMENT_PROVIDER_ERROR`) extienda el plazo, por ejemplo +15 min desde el último intento,
con un tope. Alternativa sin código: documentar que, ante una caída de MP, el admin fuerza a `assigned`
con pago simulado (dev) o espera. No es urgente: en prod esta caída es rara y el retiro "el mismo día"
es el peor caso.

## 4. Deploys durante la prueba (proceso)

**Evidencia.** Reinicios de contenedores a las ~19:20, 19:52, 20:47 y 21:48 (`journalctl -u docker` y
`connect() failed (111: Connection refused)` en nginx), cada uno con su ráfaga de 500/502 en la app.
El de las 21:48 **recreó los contenedores, y `json-file` borra los logs del contenedor viejo**: de
gateway, users, shipments, payments y admin solo quedó lo posterior. Sobrevivieron `proxy` (nginx) y
pricing, que no se recrearon.

**Propuesta.** Ya incorporada a la referencia: congelar `develop` (o pausar `ci-dev.yml`) durante una
prueba y bajar los logs antes de cualquier deploy. A más largo plazo, un envío de logs fuera del
contenedor (CloudWatch agent o similar) haría que un deploy no los borre. Hoy no hay ninguno (ver la
infra de logs en la referencia).

## 5. El optimizador de rutas siempre da timeout

**Evidencia.** `svc-shipments`: 5 `my_route_solver_failed` y 1 `trip_start_route_warmup_failed`, todos
con `"El servicio de ruteo superó el tiempo límite de espera."` (21:51–21:53 y 23:31). La app cayó a la
heurística (AC6 de MOVO-205). Pricing sí terminaba: hay `POST /optimize/route 200` en su access log.

**Causa.** `createPricingLogisticsClient` (`src/adapters/pricing-logistics-client.ts`) usa
`DEFAULT_TIMEOUT_MS = 1000` para **todas** sus llamadas, y `shipments.routes.ts` no le pasa otro.
Ese 1 s se definió para `/routes/evaluate-candidates` (HISTORIAL, MOVO-161). Pero `/optimize/route`
corre OR-Tools con `ROUTING_TIME_LIMIT_SECONDS = 1.0`, redondeado hacia arriba a un mínimo de 1 s
(`vrptw_solver.py`), más la matriz de distancias contra Google Routes: **no puede responder en menos de
1 s**. El optimizador real nunca le llega al transportista.

**Propuesta.** Un timeout propio para `optimizeRoute` (por ejemplo 5 s, vía `timeoutMs` por método o una
env var `PRICING_OPTIMIZE_TIMEOUT_MS`, con los tres lugares de siempre), dejando 1 s para
`evaluate-candidates`. El warm-up al iniciar el viaje es fire-and-forget y puede tener uno aún mayor.

## 6. 503 de nginx al volver la app a primer plano

**Evidencia.** 43 líneas `limiting requests, excess: 20.x by zone "api"` en nginx (20:32, 20:34, 20:41,
20:44, 20:54, 21:16 ×13, 21:50, 22:39–22:40, 22:51). Son los 503 sueltos de `users/me`,
`users/me/blocked`, `users/:id`, `chat/read`, `events`, `shipments/mine`… que no aparecen en los logs
del gateway ni de los servicios. Los rechaza nginx antes de que la request llegue al gateway.

**Causa.** `infra/nginx/templates/default.conf.template`: `limit_req zone=api burst=20 nodelay` a
`10r/s` por IP, y `limit_req` responde **503** por defecto. La app dispara más de 20 requests en paralelo
al volver a primer plano: React Query refetchea todo lo montado, más los chequeos de sesión y chat. Además,
varios testers compartían una IP (`190.96.126.29`, misma red/NAT), así que el burst se suma. El 503 hace
que la app lo trate como servicio caído y no como "frená".

**Propuesta.**

- `limit_req_status 429;` en nginx, para que el cliente distinga el rate limit de una caída y aplique su
  backoff. El gateway ya tiene su propio rate limit por IP y usuario (200/min), y el de nginx es una
  primera barrera.
- Subir el `burst` (por ejemplo 60) o la tasa para la zona `api`. El límite real de abuso ya lo pone el
  gateway.
- Del lado mobile, reducir la ráfaga de refetch al volver a foreground (`refetchOnWindowFocus` /
  `focusManager` selectivo).

## 7. El panel reconecta el WebSocket de soporte en loop

**Evidencia.** En `svc-admin`, desde el deploy: 1813 × `support_ws_origin_rejected`
(`origin: "https://admin-dev.movosend.app"`), 2146 `POST /admin/support/realtime-ticket` y 4209
`/admin/session`. En nginx, `realtime-ticket` ~cada 2 s (≈ 200–280 por cada 10 min entre 21:16 y 21:50).
Las ráfagas de `GET /users/me` ~1 por segundo desde el BFF (`node`) a las 22:40 son el mismo loop: cada
ticket pasa por `requireAdmin()`, que consulta `/users/me` y `/admin/session`.

**Causa.** Son dos problemas:

1. **Config de dev**: `SUPPORT_WS_ALLOWED_ORIGINS` no está cargada en Secrets Manager (pendiente
   transversal de MOVO-322 en el `CLAUDE.md` raíz), así que rige el default `https://localhost:3000` y
   el origen real del panel (`admin-dev.movosend.app`) se rechaza.
2. **Bug del cliente**: `svc-admin` acepta el upgrade y **después** cierra con
   `SUPPORT_WS_CLOSE.FORBIDDEN` (`support.routes.ts`, handler del WS). En el panel,
   `lib/support/realtime/feed.ts` pone `failures = 0` en `onopen`. Cada intento cuenta como conexión
   exitosa seguida de una caída, el backoff nunca crece (1 s × jitter) y nunca se pasa a polling tras 3
   fallos. Un servidor que corta enseguida genera un loop infinito de tickets.

**Propuesta.**

- Cargar `SUPPORT_WS_ALLOWED_ORIGINS` (panel + previews de Vercel) y `SUPPORT_WS_PUBLIC_URL` en dev y en
  prod, como ya lista el pendiente.
- En `feed.ts`, resetear `failures` recién después de que el socket estuvo abierto un rato (por ejemplo
  al primer mensaje o a los 10 s), o no resetearlo si se cierra con un código de rechazo (`FORBIDDEN`,
  `TOKEN`) y pasar directo a polling.

## 8. `GET /trips/:id/matches` da 409 con el viaje activo

**Evidencia.** 131 × 409 en el período (115 para el viaje de la prueba `b84ffbb4`, 549 en total para
otro viaje `2cb9c3a0`), uno por poll.

**Causa.** `hooks/use-active-trip-match-alert.ts` vigila el primer viaje `declared` **o `active`**
(comentario de MOVO-221). Pero desde MOVO-258 (D5) `getTripMatches` (`trips.service.ts`) solo acepta
`declared` y responde 409 `TRIP_NOT_AVAILABLE` a un viaje iniciado ("un viaje iniciado tiene sus paquetes
fijos"). Las 16 sobre `46143929` son el mismo caso con un viaje ya `expired`, porque la lista de "Mis
viajes" que alimenta al hook estaba desactualizada.

**Propuesta.** Filtrar solo `declared` en el hook (y actualizar su comentario). Es inofensivo para el
usuario, pero ensucia el access log y gasta cuota del rate limit (#6).

## 9. `GET /shipments/undefined/ratings` (400)

**Evidencia.** 12 × 400 (por ejemplo a las 23:28, build Movo/1).

**Causa.** En `app/(app)/shipments/[id].tsx`, `useShipmentRatings` recibe `undefined` mientras el envío
no está en un estado terminado, y el `enabled` del hook lo frena. Pero el `refetchRatings()` que se llama
en el pull-to-refresh y al volver a la pantalla (líneas ~206, ~240 y ~435) **ignora `enabled`**, así que
React Query corre el `queryFn` con `shipmentId!` = `undefined`.

**Propuesta.** Llamar a `refetchRatings()` solo si hay id de ratings, o usar
`queryClient.invalidateQueries`, que respeta `enabled`.

## 10. Datos residuales de pruebas anteriores en dev

| Envío | Estado | Qué tiene |
|---|---|---|
| `d4db6b5d` | `delivered` (trabado) | hold `captured` con `mp_payment_id = manual-d4db6b5d` y liquidación `escalated` (MP responde 404 al leer el desglose de un pago que no existe) |
| `f92faa3a` | `completed` | hold `manual-f92faa3a`, liquidación `credited` |
| `dae4ece7`, `16d2352c` | `assigned` | holds `authorized` `manual-*`, creados a las 21:25 por un script (user-agent `node`) |
| `e4ba4b26` | `delivered` desde el 08/10 | sin hold: el sweep loguea `settlement_retry_failed` / `HOLD_NOT_FOUND` |

Los `manual-*` no salen de ningún código del repo: son de inserts a mano o de un script local. Ensucian
los barridos y el panel (alertas, liquidaciones escaladas). **Propuesta:** limpiarlos, o pasarlos a un
estado terminal con el cambio forzado, y de ahora en más usar el pago simulado (DD-055) en vez de holds
inventados.

## Observaciones menores (sin acción)

- `photos` 403 para el transportista a las 21:16:47: el envío acababa de volver a `published` (#3) y dejó
  de ser parte. Es lo esperado.
- La segunda aceptación no reusó el viaje que el transportista había declarado (`786c5c03`, salida 21:00):
  la oferta nueva se hizo sin viaje y se auto-creó `b84ffbb4` con "Vehículo sin especificar", porque el
  perfil todavía no tenía vehículo (lo cargó a las 23:46). `786c5c03` quedó `expired` a las 21:26. No se
  investigó por qué `pickReusableTrip` no lo eligió.
- pricing: `fuel_price_fetch_failed error=TimeoutError()` en cada cotización: la API de Energía no
  respondió y se usó el último valor conocido (`fuelSource: "lkg"`, $2229/l). Es lo previsto en ADR-021.
- `svc-users` y `svc-shipments` loguean `reputation_fetch_failed` / `active_shipment_counterparty_lookup_failed`
  en el segundo posterior a un deploy, porque arrancan en paralelo. Es ruido de arranque.
- Node 20 en los contenedores: el SDK de AWS avisa que desde enero de 2027 exige Node ≥ 22.
