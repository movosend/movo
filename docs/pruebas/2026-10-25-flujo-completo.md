# Prueba de flujo completo, 25/10/2026 (dev)

Primera prueba real de punta a punta: un envío creado, ofertado, pagado, retirado con QR, seguido en vivo
y entregado con QR, con dispositivos reales en la calle. Este informe contrasta lo que quedó en la BD y en
los logs de dev contra la referencia de [`flujo-esperado-e2e.md`](./flujo-esperado-e2e.md) y documenta
cada problema encontrado, con evidencia, causa y propuesta. Cada punto cierra con un bloque **Para el issue**
(título en el formato de PR del repo, tipo y criterios de aceptación) para crear el ticket de Linear sin
volver a investigar. Las referencias `archivo:línea` son al código del 26/10/2026.

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
| 11 | El receptor ve "Listo. Se lo entregaste." después de escanear el QR de entrega | Media (UX) | `movo-mobile` | Causa identificada |
| 12 | **Feature:** emisor y receptor deberían ver la ruta del transportista, no solo su posición | — (feature) | `movo-mobile` + `svc-shipments` | Propuesta |
| 13 | "Sin conexión a internet" al iniciar el viaje, con internet | Media | `movo-mobile` (tracking) | Red descartada (todo 200). Causa en el cliente, a acotar con telemetría |
| 14 | "Mi ruta" une las paradas con líneas rectas, no con el camino por calles | Media | `svc-shipments` + `movo-mobile` | Causa identificada |
| 15 | Llegada estimada de la próxima parada corrida 3 h (22:44 en vez de 19:44) | Alta | `svc-pricing-logistics` + `svc-shipments` | Causa identificada |
| 16 | Validación de 100 m de la entrega contra la dirección cargada, no contra el receptor | Media | `movo-mobile` (wizard de entrega) | Causa identificada |
| 17 | La card de envío activo del emisor solo tiene chat y la acción del estado | Baja (UX) | `movo-mobile` (home) | Propuesta |
| 18 | Dos mapas en el detalle del envío, y "En vivo" no parece un botón | Media (UX) | `movo-mobile` (detalle) | Propuesta, se junta con el 12 |
| — | `POST /users/me/legal-acceptance` 422 | — | build viejo (Movo/14) | Conocido, fuera de alcance |

## Agrupación sugerida para crear los issues

Para no abrir 18 tickets, los puntos se pueden juntar en **8 issues** (más una tarea manual sin ticket). Se
agrupan por paquete y por tipo de cambio, para que cada uno sea un solo PR revisable. Los bloques **Para el
issue** de cada sección se concatenan como criterios de aceptación del issue agrupado.

| Issue | Puntos | Qué junta | Notas |
|---|---|---|---|
| **A. Sesión del transportista en segundo plano** | 1 | Keychain, orden de `setSession`, cuándo se llama a `clearSession()` | Solo, por ser crítico y bloqueante de una próxima prueba. Va primero |
| **B. Fixes menores de `movo-mobile`** | 8, 9, 11 | Matches de viaje activo (409), `refetchRatings` con `undefined`, texto de éxito del receptor | Los tres son cambios chicos y de UI/hooks de la misma app; un solo PR |
| **C. Backend: plazos y timeouts ante servicios caídos o lentos** | 2, 3, 5 | Alerta cuando MP no responde al crear holds, plazo de pago que se extiende ante un 502 del proveedor, timeout propio del optimizador | Node (`svc-payments`, `svc-shipments`). El punto 3 necesita un DD antes del código: si se demora, se puede sacar y dejar C con 2 y 5 |
| **D. Infra y configuración de dev** | 4, 6, 7 | Logs que sobreviven a un deploy, nginx con 429 y burst mayor, `SUPPORT_WS_ALLOWED_ORIGINS` en dev y prod, backoff del WS de soporte en el panel | Mayormente `movo-infra`/Secrets Manager/nginx. El único código es `feed.ts` del panel (7). Del 6 se puede dejar afuera el ajuste del refetch del mobile |
| **E. Feature: ruta del transportista para emisor y receptor** | 12, 18 | Endpoint para las partes + un único mapa en el detalle | Solo, porque es una US nueva con refinamiento previo (qué tramo, privacidad). El 18 define dónde se muestra |
| **F. Ruta del transportista: trazado y horarios** | 14, 15, (5) | Polyline por calles en "Mi ruta", hora de partida con zona en el optimizador | `svc-shipments` + pricing + mobile. El 15 es el más grave y se puede sacar solo como fix chico. El timeout del 5 hace que el optimizador real llegue, así que conviene probarlos juntos |
| **G. Tracking y entrega del transportista** | 13, 16 | Cartel de "Sin conexión" falso, gate de 100 m de la entrega | `movo-mobile`. El 16 necesita decidir antes qué valida el paso 1 de la entrega |
| **H. Card de envío activo del emisor** | 17 | Acceso al detalle desde la card y el stepper | `movo-mobile`, chico. Puede ir en B |
| *(sin ticket)* | 10 | Limpiar envíos de prueba en dev | Se hace a mano con el cambio forzado del panel; no requiere código |

Si hay que reducir todavía más: **B** puede absorber el ajuste del refetch del punto 6, y **C** y **D** pueden
fusionarse en un único issue de "robustez de dev" si el equipo prefiere un solo PR de infra y backend, a costa
de una revisión más larga.

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

**Para el issue**

- **Título:** `fix(mobile): no perder la sesión al refrescar el token con el teléfono bloqueado`
- **Tipo:** bug, crítico. **Área:** `movo-mobile` (`src/lib/secure-store.ts`, `src/store/auth-store.ts`,
  `src/api/http-client.ts`).
- **Criterios de aceptación:**
  - Con un viaje activo y el iPhone bloqueado, vencer el access token no cierra la sesión: el refresh
    se aplica y el tracking sigue sin hueco en `carrier_positions`.
  - Un fallo al persistir la sesión no llama a `clearSession()`. La sesión nueva queda en memoria y se
    reintenta guardarla.
  - `clearSession()` solo corre si `/auth/refresh` respondió un rechazo del servidor.
  - Las keys `session*` se guardan con `AFTER_FIRST_UNLOCK`, y una instalación existente migra en el
    próximo refresh.
  - Test unitario del interceptor: un `onTokensRefreshed` que rechaza no termina en `onAuthFailure`.

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

**Para el issue**

- **Título:** `feat(svc-payments): alertar cuando MP no responde al crear holds`
- **Tipo:** mejora operativa, baja prioridad. **Área:** `svc-payments` (`hold.service.ts`, `alert-notifier.ts`).
- **Criterios de aceptación:** N errores `"MP no respondió al crear el hold"` en una ventana (por ejemplo
  3 en 10 min) mandan una alerta `mp_hold_create_unavailable` a Telegram, una sola vez por ventana.
- La deuda del transportista de esta prueba ($515,25) no necesita un issue: es efecto esperado del pago
  simulado.

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

**Para el issue**

- **Título:** `feat(svc-shipments): extender el plazo de pago cuando falla el proveedor [DD-0xx]`
- **Tipo:** decisión de diseño + feature, media. **Área:** `svc-shipments` (`funding.service.ts`,
  `fundingPayUntil`). Primero el DD en el registro de diseño y en `docs/decisiones/README.md`.
- **Criterios de aceptación:**
  - Un `POST /funding` que termina en `502 PAYMENT_PROVIDER_ERROR` extiende el plazo de `assignment_pending`
    (propuesta: +15 min desde ese intento, tope de 2 extensiones o el fin de la ventana de retiro).
  - El barrido y `GET /funding` usan el mismo plazo extendido: no hay 409 mientras el plazo sigue abierto.
  - Un rechazo de tarjeta (`rejected`) no extiende nada.

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

**Para el issue**

- **Título:** `chore(infra): no perder logs al deployar durante una prueba`
- **Tipo:** proceso/infra, media. **Área:** `.github/workflows/ci-dev.yml`, `movo-infra`.
- **Criterios de aceptación** (cualquiera de los dos, o los dos):
  - Los logs de los contenedores van a un destino que sobrevive al recreate (CloudWatch Logs con el driver
    `awslogs`, o el agente de CloudWatch sobre los archivos `json-file`), con retención acotada.
  - O, como mínimo, el workflow de deploy vuelca `docker compose logs` de cada servicio a un archivo con
    fecha en la EC2 antes de recrear los contenedores.
- Proceso, sin ticket: avisar en el grupo y no mergear a `develop` durante una prueba.

## 5. El optimizador de rutas siempre da timeout

**Evidencia.** `svc-shipments`: 5 `my_route_solver_failed` y 1 `trip_start_route_warmup_failed`, todos
con `"El servicio de ruteo superó el tiempo límite de espera."` (21:51–21:53 y 23:31). La app cayó a la
heurística (AC6 de MOVO-205). Pricing sí terminaba: hay `POST /optimize/route 200` en su access log.
Cuatro llamadas con una sola parada (21:54:44–21:55:10) sí llegaron a tiempo; ver el punto 15, que es
justamente lo que destapan.

**Causa.** `createPricingLogisticsClient` (`src/adapters/pricing-logistics-client.ts`) usa
`DEFAULT_TIMEOUT_MS = 1000` para **todas** sus llamadas, y `shipments.routes.ts` no le pasa otro.
Ese 1 s se definió para `/routes/evaluate-candidates` (HISTORIAL, MOVO-161). Pero `/optimize/route`
corre OR-Tools con `ROUTING_TIME_LIMIT_SECONDS = 1.0`, redondeado hacia arriba a un mínimo de 1 s
(`vrptw_solver.py`), más la matriz de distancias contra Google Routes: **no puede responder en menos de
1 s**. El optimizador real nunca le llega al transportista.

**Propuesta.** Un timeout propio para `optimizeRoute` (por ejemplo 5 s, vía `timeoutMs` por método o una
env var `PRICING_OPTIMIZE_TIMEOUT_MS`, con los tres lugares de siempre), dejando 1 s para
`evaluate-candidates`. El warm-up al iniciar el viaje es fire-and-forget y puede tener uno aún mayor.

**Para el issue**

- **Título:** `fix(svc-shipments): timeout propio para el optimizador de rutas`
- **Tipo:** bug, media. **Área:** `svc-shipments` (`src/adapters/pricing-logistics-client.ts`,
  `config/env.ts`, `.env.example`, `infra/docker-compose.yml`).
- **Criterios de aceptación:**
  - `optimizeRoute` usa un timeout configurable (`PRICING_OPTIMIZE_TIMEOUT_MS`, default 5000), más largo
    que `ROUTING_TIME_LIMIT_SECONDS` + la matriz. `evaluate-candidates` sigue en 1000 ms.
  - En dev, la pantalla "Mi ruta" del transportista con un viaje activo muestra el orden optimizado y
    `svc-shipments` no loguea `my_route_solver_failed`.
  - El warm-up de `POST /trips/:id/start` no loguea `trip_start_route_warmup_failed` en el caso normal.

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

**Para el issue**

- **Título:** `fix(infra): rate limit de nginx con 429 y burst acorde a la app`
- **Tipo:** bug, media. **Área:** `infra/nginx/templates/default.conf.template`, y opcionalmente
  `movo-mobile` (refetch al volver a primer plano).
- **Criterios de aceptación:**
  - `limit_req_status 429;` en la zona `api`: un exceso devuelve 429 con el cuerpo de error del contrato, no 503.
  - Abrir la app desde segundo plano, con 2 dispositivos detrás de la misma IP, no produce ningún 503/429
    (subir `burst`, por ejemplo a 60).
  - Probado contra la EC2 de dev (nginx se recarga con el deploy).

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

**Para el issue** (dos tickets, uno de config y uno de código)

- **Título 1:** `chore(infra): cargar SUPPORT_WS_ALLOWED_ORIGINS y SUPPORT_WS_PUBLIC_URL en dev y prod`
  - **Criterio:** en dev, el panel abre el WS de soporte y queda `live` (sin `support_ws_origin_rejected`
    en `svc-admin`).
- **Título 2:** `fix(movo-admin): backoff del WS de soporte cuando el servidor cierra al conectar`
  - **Área:** `movo-admin/lib/support/realtime/feed.ts`.
  - **Criterios:** un servidor que acepta y cierra enseguida (código `FORBIDDEN`/`TOKEN`) hace crecer el
    backoff y pasa a polling a los 3 intentos. Test en `feed.test.ts` con un socket que abre y cierra en
    el mismo tick. Como máximo un ticket cada 30 s en ese escenario.

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

**Para el issue**

- **Título:** `fix(mobile): no pedir matches de un viaje iniciado`
- **Tipo:** bug, baja. **Área:** `movo-mobile/src/hooks/use-active-trip-match-alert.ts`.
- **Criterios de aceptación:** con un viaje `active` no hay requests a `/trips/:id/matches`, y con uno
  `declared` el aviso sigue funcionando. El comentario del hook refleja MOVO-258 D5.

## 9. `GET /shipments/undefined/ratings` (400)

**Evidencia.** 12 × 400 (por ejemplo a las 23:28, build Movo/1).

**Causa.** En `app/(app)/shipments/[id].tsx`, `useShipmentRatings` recibe `undefined` mientras el envío
no está en un estado terminado, y el `enabled` del hook lo frena. Pero el `refetchRatings()` que se llama
en el pull-to-refresh y al volver a la pantalla (líneas ~206, ~240 y ~435) **ignora `enabled`**, así que
React Query corre el `queryFn` con `shipmentId!` = `undefined`.

**Propuesta.** Llamar a `refetchRatings()` solo si hay id de ratings, o usar
`queryClient.invalidateQueries`, que respeta `enabled`.

**Para el issue**

- **Título:** `fix(mobile): no refrescar calificaciones de un envío sin terminar`
- **Tipo:** bug, baja. **Área:** `movo-mobile/app/(app)/shipments/[id].tsx`.
- **Criterios de aceptación:** el pull-to-refresh y el foco de la pantalla de un envío no terminado no
  disparan `GET /shipments/undefined/ratings`. Si se usa `invalidateQueries`, respeta el `enabled` del hook.

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

**Para el issue**

- **Título:** `chore: limpiar envíos de prueba con holds manuales en dev`
- **Tipo:** chore (datos), baja. Sin código: pasar `d4db6b5d`, `dae4ece7`, `16d2352c` y `e4ba4b26` a un
  estado terminal con el cambio forzado del panel (queda en la bitácora). Borrar filas a mano rompe la
  bitácora y los triggers append-only de payments.

## 11. El receptor ve "Se lo entregaste." al confirmar la entrega

**Síntoma.** El receptor escanea el QR del transportista y la pantalla de éxito dice **"Listo. Se lo
entregaste."**, que es el texto del transportista. El receptor no entregó nada: recibió.

**Causa.** El receptor confirma desde `app/(app)/shipments/[id]/handshake-scan.tsx`, a la que llega por
el CTA de `src/lib/shipment-format.ts:206`. Esa pantalla reusa `HandshakeConfirmationResult`
(`components/handshake/handshake-confirmation-result.tsx`), que arma el texto **solo según el stage**,
desde la perspectiva del que entrega:

```ts
// handshake-confirmation-result.tsx:147-148
const title1 = isPickup ? "Lo tenés vos." : "Listo.";
const title2 = isPickup ? (…"Ahora, a la entrega.") : "Se lo entregaste.";
```

En el retiro el texto está bien, porque quien escanea es el transportista ("Lo tenés vos."). En la entrega
quien escanea es el receptor, pero el componente se escribió para el éxito del wizard del transportista
(`delivery/success.tsx`, MOVO-199) y no distingue quién lo ve. El comentario de `handshake-scan.tsx` dice
además que la pantalla "todavía no tiene CTA real", y eso ya no es cierto: el CTA lo agregó el home del
receptor.

En el mismo componente, el bloque del retiro dice `"{nombre} · destinataria"`, en femenino fijo. Lo ve el
transportista sobre el receptor, sea quien sea.

**Para el issue**

- **Título:** `fix(mobile): texto de éxito del handshake según quién confirma`
- **Tipo:** bug de UX, media (es lo último que ve el receptor del flujo). **Área:**
  `movo-mobile/components/handshake/handshake-confirmation-result.tsx`, `handshake-scan.tsx`.
- **Criterios de aceptación:**
  - El componente recibe el rol de quien ve la pantalla (o lo deduce del usuario contra el envío):
    receptor en la entrega → algo como "Listo. Ya lo tenés." / "Recibiste tu paquete.".
  - El transportista, en `delivery/success.tsx`, sigue viendo "Se lo entregaste.".
  - "destinataria" se reemplaza por un texto neutro ("Destinatario" o "Recibe: {nombre}").
  - Test de render por rol (receptor/transportista) y por stage.
  - Actualizar el comentario desactualizado de `handshake-scan.tsx`.

## 12. Feature: el emisor y el receptor ven la ruta del transportista

**Hoy.** El seguimiento en vivo del emisor y del receptor (`app/(app)/shipments/[id]/tracking.tsx` +
`components/tracking/live-map.tsx`) muestra solo **la última posición del transportista** (WS
`/shipments/:id/track` + `GET /shipments/:id/positions/latest`, vía `useLivePosition`) y el destino. No
dibuja ni el camino recorrido ni el que falta, así que no se entiende por dónde viene ni cuánto le queda.
No es un bug: no está en el alcance de ninguna US hecha.

**Lo que ya existe y se puede reusar.**

- El panel ya tiene exactamente esto: `GET /admin/shipments/:id/tracking` (MOVO-327,
  `svc-shipments/src/modules/admin-internal/admin-tracking.service.ts`) arma la **ruta planificada**
  (polyline de Google Routes, distancia y duración), la **traza real** (`carrier_positions`, recortada
  con `capTrace`) y la última posición. El mapa de MOVO-328 dibuja el tramo recorrido sólido y el
  faltante punteado desde el vértice más cercano.
- `GET /shipments/route` ya devuelve la ruta origen→destino para el mapa del transportista.
- La traza solo existe desde el retiro (`carrier_positions` se guarda con el envío `in_transit`, ver la
  referencia), y se purga a los 30 días (DD-023).

**Para el issue**

- **Título:** `feat(mobile): ruta del transportista en el seguimiento del emisor y el receptor`
- **Tipo:** feature (US nueva, EP-04 Ejecución del Envío). **Área:** `svc-shipments` (endpoint para las
  partes) + `movo-mobile` (mapa).
- **Decisiones a tomar en el refinamiento:**
  - **Qué ruta se muestra.** Hacia la entrega desde el retiro (simple, la del envío) o la del viaje entero
    con otras paradas. La del viaje expone retiros y entregas de otros usuarios: no corresponde
    mostrársela a un emisor o receptor ajeno. Propuesta: solo el tramo de este envío.
  - **Antes del retiro.** ¿El emisor ve al transportista acercándose al punto de retiro? Hoy las
    posiciones de esa etapa se difunden por WS pero no se guardan, así que habría traza solo en vivo.
  - **Privacidad.** La traza revela por dónde anduvo el transportista. Acotarla al tramo del envío y a
    mientras dure (sin historial después de `delivered` para las partes) es coherente con la Política de
    Privacidad 0.2 (ubicación en segundo plano). Revisar si hace falta tocar el texto legal.
- **Criterios de aceptación (propuesta):**
  - Endpoint para emisor y receptor del envío (`GET /shipments/:id/tracking` o ampliar
    `positions/latest`) con ruta planificada y traza del tramo del envío, reusando
    `admin-tracking.service.ts`. 403 para cualquier otro usuario.
  - El mapa del emisor y del receptor dibuja el recorrido hecho (sólido), lo que falta (punteado) y la
    posición en vivo, que sigue llegando por WS.
  - Sin señal (`signalLost`), el último tramo se ve atenuado con la hora del último punto, como en el panel.
  - Con el envío `delivered`, el mapa deja de actualizarse y la traza deja de estar disponible para las
    partes.

---

Los puntos 13 a 18 los reportaron después quienes hicieron la prueba (lo que vieron en pantalla). La causa sale
del código. La evidencia de servidor que falta revisar en el dump de la EC2 se indica en cada punto.

## 13. "Sin conexión a internet" apenas el transportista inicia el viaje

**Síntoma.** Al iniciar el viaje, el indicador de tracking del transportista muestra "Sin conexión a internet"
("Tu ubicación se transmitirá… una vez que se restablezca"), con internet. Se vio varias veces, no solo en
esta prueba.

**Qué muestra en realidad el cartel.** `components/location/tracking-active-indicator.tsx` no mira la red:
muestra "Sin conexión" cuando `pendingQueueCount > 0`, es decir, cuando la copia **en memoria** de la cola de
posiciones de `LocationService` tiene algo. Esa copia solo se relee del archivo en los ticks de primer plano
(`location-service.ts:344` y `:384`, cada 25 s).

**Evidencia del servidor** (access log de nginx, build `Movo/15`, IP `190.96.126.29`):

```
21:51:49.698  POST /trips/b84ffbb4…/start      200
21:51:50.079  POST /shipments/positions        200  217 B  ← 2 posiciones: una ya estaba en la cola
21:52:15.055  POST /shipments/positions        200  115 B  ← 1 posición, y así cada 25 s exactos
…             (todas 200 hasta las 22:15:35)
```

- **No hubo ningún problema de red.** Todos los `POST /shipments/positions` desde el inicio (21:51:50)
  hasta el corte de sesión del punto 1 (22:16:51) dieron 200. No hay 5xx, 429 ni huecos en la cadencia de
  25 s.
- **No se acumuló nada.** Cada tick de primer plano lleva una sola posición (114–115 B). Los lotes más
  grandes (3 a 11 posiciones, desde las 22:09) son entregas diferidas de la tarea de fondo con el auto en
  movimiento (iOS las agrupa, `deferredUpdatesInterval` de 45 s), y también salieron con 200. El único lote
  que sugiere un atraso es el de las 23:24:43 (35 posiciones), después de un hueco de 8 min sin ningún
  request: la app estuvo suspendida.
- **La cola no arrancó vacía.** El primer lote tras el inicio llevó 2 posiciones: una había quedado en el
  archivo de una sesión anterior.

Así que el cartel **no refleja un fallo de envío**. Sale de un estado del cliente que dura poco o que queda
desactualizado, y no se ve en el servidor.

**Causas posibles en el código** (sin telemetría del cliente no se puede saber cuál pesó más):

1. **Cola con restos al iniciar.** `startTracking` (`location-service.ts:133`) carga la cola persistida y
   emite el estado *antes* de pedir el GPS. Con un resto de una sesión anterior, el cartel aparece
   **apenas se inicia el viaje** y dura hasta que el primer envío termina. Con el GPS en frío (precisión
   `Balanced`) eso puede tardar varios segundos.
2. **La cuenta se actualiza antes de enviar.** En cada tick, `captureAndReportTick` asigna `offlineQueue`
   con la posición recién encolada (`location-service.ts:344`) y recién después la envía. Cualquier
   `emitStatus` en ese intervalo muestra "Sin conexión": el coordinador lo llama en cada poll de
   `transporting`/`trips` (cada 15 s) y en cada vuelta a primer plano. Es un parpadeo, pero se repite.
3. **Un vaciado que vuelve sin enviar.** `flushQueue` vuelve sin emitir si ya hay otro en curso
   (`isProcessingFlush`), y `flushBatchQueue` vuelve sin enviar si la tarea de fondo está vaciando
   (`tracking-task.ts:124`). En los dos casos, la posición del tick queda contada y el cartel se queda hasta
   el próximo tick, 25 s después. Además, cuando la tarea de fondo termina de vaciar, no le avisa a
   `LocationService`.

**Una forma de quedar trabado que sí es real.** `flushBatchQueue` solo descarta posiciones ante un rechazo
por ítem (`rejected`). Si la request entera falla con un 4xx que no es 429 (401 de sesión vencida, 400 de
validación), las posiciones quedan en la cola para siempre (`tracking-task.ts:200`) y el cartel no se va.
Pasó en el punto 1, entre las 22:16 y las 22:42: el lote de las 22:42:06 llevó 9 posiciones.

En los tres casos el problema de fondo es el mismo: el cartel interpreta "hay algo en la cola" como "no hay
internet".

**Para el issue**

- **Título:** `fix(mobile): el indicador de tracking no muestra "sin conexión" con la cola vaciándose`
- **Tipo:** bug, media. **Área:** `movo-mobile/src/location/location-service.ts`, `tracking-task.ts`,
  `components/location/tracking-active-indicator.tsx`.
- **Criterios de aceptación:**
  - El estado "Sin conexión" sale de un fallo real del último envío (error de red o 5xx), no de que la cola
    tenga ítems en un momento dado. Un resto en la cola al iniciar el viaje no muestra el cartel.
  - Si un vaciado está en curso, el segundo espera a que termine (la misma promesa) en vez de volver sin hacer
    nada. Al terminar un vaciado de fondo, `LocationService` relee la cola y emite el estado.
  - Un 4xx de la request entera que no sea 429 ni 401 descarta el lote. Un 401 lo deja en la cola, pero no
    muestra "Sin conexión".
  - Test: un tick de primer plano durante un vaciado de fondo no deja `pendingQueueCount > 0` después de que
    los dos terminan.

## 14. "Mi ruta" dibuja líneas rectas entre paradas

**Síntoma.** En la pantalla de ruta del transportista, el camino recomendado se ve como una línea recta de
parada a parada, no por calles.

**Causa.** No es una falla puntual: el camino por calles **nunca se pide** fuera del modo demo.

- `components/route/route-map.tsx:174-179`: si no recibe `polylineCoordinates`, dibuja `routePoints`, que son
  la posición del transportista y las paradas unidas en orden. Son rectas.
- `app/(app)/route/index.tsx:481`: le pasa `polylineCoordinates={demoPolylineCoordinates}`, que es `undefined`
  fuera del modo demo.
- `GET /shipments/my-route` no devuelve geometría: ni el optimizador (`/optimize/route` trabaja con una matriz
  de distancias y devuelve paradas y horarios) ni la degradación heurística (`buildDegradedRoute`).

El polyline por calles ya existe en el backend (`RoutesProvider.computeRoute`, el de `GET /shipments/route` y
del mapa del detalle del viaje), pero solo para un tramo origen→destino.

**Configuración descartada.** En dev, `ROUTES_PROVIDER=google` en `svc-shipments` (verificado en el
contenedor el 28/10). El default de compose es `mock`, que también devuelve una recta codificada
(`mock-routes-provider.ts`), pero no es el caso: los mapas del detalle del envío y del viaje usan el camino
real, y solo "Mi ruta" dibuja rectas.

**Para el issue**

- **Título:** `feat(svc-shipments): camino por calles en la ruta del transportista`
- **Tipo:** bug/feature, media. **Área:** `svc-shipments` (`shipments.service.ts`, `getMyRoute`; los
  adapters de rutas), `movo-mobile` (`app/(app)/route/index.tsx`).
- **Criterios de aceptación:**
  - `GET /shipments/my-route` devuelve un `polyline` del recorrido completo en el orden de las paradas
    (Routes API con `intermediates`, desde la posición del transportista), también en la ruta degradada.
  - Si Routes API falla, la respuesta sigue llegando sin `polyline` y el mapa cae a las rectas, como hoy.
  - "Mi ruta" dibuja ese polyline. El tramo hasta la próxima parada se destaca del resto.
  - El polyline se cachea por viaje y orden de paradas, para no pedirlo en cada poll (costo de Routes API).
  - Confirmado `ROUTES_PROVIDER=google` en dev y prod.

## 15. Llegada estimada corrida 3 horas

**Síntoma.** A las 18:55 (ART), con un tramo de unos 49 min hasta la entrega, "Mi ruta" estimó la llegada a
las **22:44**. Lo correcto era **19:44**. Son 3 h exactas, el offset de Argentina con UTC.

**Causa.** Coincide al minuto con la hora UTC de ese momento (21:55 UTC + 49 min = 22:44), mostrada como si
fuera local:

1. `getMyRoute` llama a `pricingLogisticsClient.optimizeRoute({ carrierLocation, stops })`
   (`shipments.service.ts:3296`) **sin `departureAt`**.
2. Sin hora de partida, el solver usa `base_dt = datetime.now()` (`vrptw_solver.py:137` y `:139`): un
   `datetime` **sin zona**, que en el contenedor es UTC.
3. `estimated_arrival_at=arr_dt.isoformat()` (`vrptw_solver.py:443`) sale como `"2026-10-25T22:44:00"`, sin
   `Z` ni offset.
4. El mobile (`toClock`, `src/lib/time-format.ts`) hace `new Date(value)`. Un ISO sin offset se interpreta
   como **hora local** del teléfono → 22:44.

Para comparar las ventanas horarias contra la hora de partida, el solver las pasa a la zona del sistema
(`astimezone()`), así que en un contenedor en UTC **el orden y los minutos están bien**. Solo está mal la hora
que se devuelve. Si alguna vez el contenedor corriera con otra `TZ`, también se correría el cálculo.

**Por qué apareció justo esta vez.** Cruzando el access log de nginx, los `my_route_solver_failed` de
`svc-shipments` y el access log de pricing:

| Hora (UTC) | `GET /my-route` | Resultado |
|---|---|---|
| 21:51:50 | (warm-up de `POST /trips/:id/start`) | timeout → `trip_start_route_warmup_failed` |
| 21:52:10, 21:52:26, 21:53:26 | 896 B, con `tripId`, antes del retiro (2 paradas) | timeout → ruta degradada, sin hora |
| **21:54:44, 21:55:04, 21:55:07, 21:55:10** | 557 B, después del retiro (1 parada) | **el optimizador respondió a tiempo** (`/optimize/route 200` en pricing a la misma hora, sin `my_route_solver_failed`) |
| 23:31:22 | — | timeout |

La ruta degradada devuelve `estimatedArrivalAt: null` y el mobile muestra "+49 min", que está bien. Las
cuatro llamadas de 21:54:44–21:55:10, con una sola parada y la matriz de Google ya resuelta, terminaron en
menos de 1 s: son las que mostraron "22:44", justo a las 18:55 ART. Esto también corrige al punto 5: el
optimizador no da timeout *siempre*, pero sí casi siempre que hay más de una parada. Cuando se arregle ese
timeout, la hora corrida **va a aparecer en todas las rutas**.

**Para el issue**

- **Título:** `fix(pricing): llegada estimada de la ruta con zona horaria`
- **Tipo:** bug, alta (aparece siempre que el optimizador responda). **Área:**
  `svc-pricing-logistics/app/services/vrptw_solver.py`, `svc-shipments` (`getMyRoute`).
- **Criterios de aceptación:**
  - El solver nunca trabaja con `datetime` sin zona: sin `departure_time` usa `datetime.now(timezone.utc)`, y
    una `departure_time` sin offset se rechaza (422) o se asume UTC de forma explícita.
  - `estimated_arrival_at` y `estimated_departure_at` salen con offset (`+00:00` o `Z`).
  - `getMyRoute` manda `departureAt` (ahora, en ISO con `Z`).
  - Test de pricing: sin `departure_time`, la respuesta tiene offset. Test del mobile: `formatTimeOfDay` de un
    ISO con `Z` muestra la hora de Argentina.

## 16. La entrega valida 100 m contra la dirección cargada, no contra el receptor

**Hoy hay dos chequeos de distancia en la entrega:**

1. **El paso 1 del wizard del transportista** (`app/(app)/shipments/[id]/delivery/index.tsx:24-25` →
   `ProximityGeoScreen` → `useProximityCheck`): solo en el mobile, compara el GPS del transportista con
   `deliveryLat/deliveryLng`, el punto que marcó el **emisor** al crear el envío. Sin estar a ≤100 m de ese
   punto, "Continuar" queda deshabilitado y no hay forma de saltearlo.
2. **El handshake** (`handshake.service.ts:294`): compara la posición de quien generó el QR (transportista)
   con la de quien lo escanea (receptor), ≤100 m. Este **ya valida contra el receptor**: en la prueba dio
   21 m.

**El problema es el 1.** El receptor puede estar en otro lugar que el pin: en la puerta de un edificio, en la
esquina, en otra dirección cercana, o el pin del emisor puede estar mal puesto. El transportista queda
bloqueado aunque esté junto al receptor, y el chequeo que importa (el 2) nunca llega a correr. En el retiro el
gate tiene sentido, porque el punto de retiro es la evidencia del no-retiro (DD-052).

**Propuesta (a decidir).** El gate del paso 1 de la **entrega** deja de bloquear: muestra la distancia a la
dirección como información ("Estás a 350 m de la dirección de entrega") y deja continuar. La validación de
proximidad queda en el handshake (transportista ↔ receptor, en el servidor). Alternativa más cara: que el
receptor comparta su ubicación al abrir la entrega y el gate use esa. No suma seguridad, porque el handshake ya
lo exige, y agrega un permiso de ubicación al receptor.

**Para el issue**

- **Título:** `fix(mobile): la entrega valida la distancia al receptor, no a la dirección cargada`
- **Tipo:** bug, media. **Área:** `movo-mobile` (`delivery/index.tsx`, `components/shipments/proximity-geo-screen.tsx`).
- **Criterios de aceptación:**
  - En la entrega, estar a más de 100 m del punto de entrega no impide avanzar: se muestra la distancia y un
    aviso.
  - El handshake de entrega sigue rechazando con `HANDSHAKE_DISTANCE_EXCEEDED` a más de 100 m entre
    transportista y receptor.
  - El retiro sigue igual (bloquea a más de 100 m del punto de retiro).
  - Actualizar el comentario de `use-proximity-check.ts` (hoy dice que los dos wizards bloquean).

## 17. La card de envío activo del emisor tiene pocas acciones

**Hoy.** En el home, la card del envío activo (`components/home/active-shipment-card.tsx`) solo tiene dos
cosas que se pueden tocar: el chat y el CTA del estado (`activeShipmentCta`): "Generar retiro" en
`assigned`, "Ver en el mapa" en `in_transit`. El cuerpo de la card y el stepper (Retiro, En camino, Llegando,
Entrega) no son tocables, así que **no hay forma de ir al detalle del envío desde la card**. Con el viaje del
transportista ya iniciado y el envío todavía `assigned`, el emisor tampoco tiene acceso directo al seguimiento
en vivo, aunque ya está disponible (`liveTrackingAvailability` con `carrierTripActive`).

**Propuesta.**

- El cuerpo de la card (encabezado y stepper) abre el detalle del envío (`/shipments/:id`).
- Opcional: cada paso del stepper abre el detalle en la parte que corresponde (el paso actual con el
  seguimiento si está disponible, uno ya hecho con la línea de tiempo). Ojo con el área táctil: los nodos
  miden 38 px y los labels se desbordan. Que toda la fila sea un único botón al detalle es más simple y
  accesible.
- Con el viaje iniciado y el envío `assigned`, sumar "Ver en el mapa" junto a "Generar retiro".

**Para el issue**

- **Título:** `feat(mobile): acceso al detalle desde la card de envío activo`
- **Tipo:** mejora de UX, baja. **Área:** `movo-mobile/components/home/active-shipment-card.tsx`,
  `src/lib/active-shipment-format.ts`.
- **Criterios de aceptación:** tocar la card (fuera de los botones) abre el detalle del envío. Los botones
  de chat y CTA siguen haciendo lo suyo sin abrir el detalle. Con el viaje activo y el envío `assigned`, el
  emisor puede abrir el seguimiento desde la card. Test de navegación.

## 18. Dos mapas en el detalle, y "En vivo" no parece un botón

**Hoy.** En el detalle del envío, emisor y receptor ven la card "Ruta" (`RouteTrackingChatCard`,
`app/(app)/shipments/[id].tsx`, alrededor de la línea 631): un mapa con la ruta retiro→entrega
(`RouteMapCard`, `GET /shipments/route`) **sin el transportista**. Debajo, una franja con un punto y el texto
"EN VIVO / Mirá en el mapa dónde está el transportista" (`route-tracking-chat-card.tsx:56-89`). Esa franja es
un `Pressable` que abre **otra pantalla** con otro mapa (`shipments/[id]/tracking.tsx` + `LiveMap`), donde está
el transportista pero no la ruta (punto 12). Visualmente es una etiqueta: no tiene borde, flecha ni fondo de
botón, así que no se descubre.

**Propuesta.** Un solo mapa, en el detalle: la ruta del envío, la posición en vivo del transportista
(WS `/shipments/:id/track`, como ya hace `tracking.tsx`) y su ruta del día acotada a este envío (punto 12). La
pantalla `tracking` queda como pantalla completa del mismo mapa (tocar el mapa la abre), no como un mapa
distinto. Mientras no haya posición, el mapa del detalle es el de hoy, con "Se activa al iniciar el recorrido".

Se junta con el punto 12 en el issue **E**: el 12 define qué datos se muestran, el 18 dónde.

**Para el issue** (criterios a sumar a E)

- El detalle del envío tiene un único mapa con la ruta del envío y, con el seguimiento disponible, el
  marcador en vivo del transportista. No hay un segundo mapa distinto.
- Tocar el mapa abre la vista a pantalla completa del mismo mapa. Si queda un acceso de texto, se ve como
  botón (borde o fondo y chevron) y tiene `accessibilityRole="button"`.
- El receptor y el emisor ven lo mismo. El transportista sigue con su vista de "Compartiendo".

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
