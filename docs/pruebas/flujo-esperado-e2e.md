# Flujo esperado de un envío de punta a punta: logs y BD

Referencia para comparar una prueba real contra lo que el código **debería** dejar, paso por
paso. Cubre el camino natural (ruta cercana de la saga, pago real con MP) y dos variantes:
el sandbox de MP caído y el estado forzado desde el panel (DD-055), con pago simulado o sin él.
Las queries viven en [`flujo-esperado-e2e.sql`](./flujo-esperado-e2e.sql).

Las citas `archivo:línea` son relativas a `services/<svc>/src/` y corresponden al código al
26/10/2026: si una no coincide, buscar el literal con grep.

## 1. Cómo usarlo

1. **Bajar los logs primero, y no deployar en medio de una prueba.** Un deploy recrea los
   contenedores y **borra sus logs** (pasó en la prueba del 25/10: de gateway y los servicios
   Node solo quedó lo posterior al deploy; sobrevivieron `proxy` y pricing, que no se
   recrearon). El access log de nginx (`proxy`) queda como respaldo: tiene hora, IP, URL,
   status y user-agent de cada request. Docker guarda `json-file` con 10 MB × 3 por contenedor
   (`infra/docker-compose.yml`, ancla `x-logging`) y no hay envío a ningún otro lado: un
   servicio con mucho tráfico (gateway, shipments por las posiciones) rota en horas. En la EC2:

   ```bash
   cd ~/movo && mkdir -p dump
   for s in proxy gateway movo-svc-users movo-svc-shipments movo-svc-payments movo-svc-admin movo-svc-pricing-logistics; do
     docker compose logs --no-color --timestamps --since 2026-10-25T08:00:00 --until 2026-10-26T03:00:00 "$s" > "dump/$s.log"
   done
   ```

   `docker compose logs` antepone `<servicio>  | ` a cada línea. Para usar `jq` hay que
   quitarlo: `sed 's/^[^|]*| [^ ]* //' dump/movo-svc-shipments.log | jq -c 'select(...)'`.
   Así se quitan el prefijo y el timestamp de Docker, que pino ya trae en `time`.
2. **Sacar la BD del envío** con el `.sql` (ver su encabezado). Con eso se tienen los ids:
   `trip_id`, `carrier_id`, `mp_payment_id`, `hold_id`.
3. **Comparar paso a paso** con la §4 y repasar el checklist de la §7.

## 2. Qué se ve y qué no en los logs

- **Formato.** Gateway y servicios Node: pino JSON (`level` 30=info, 40=warn, 50=error).
  Pricing: texto `asctime LEVEL name msg` más el access log de uvicorn. Nginx (`proxy`):
  formato combined en texto.
- **Cada request** deja dos líneas en el gateway y dos en el servicio destino:
  `"incoming request"` (`req.method`, `req.url`) y `"request completed"`
  (`res.statusCode`, `responseTime`).
- **No hay un id que cruce servicios en esas líneas.** El `reqId` (`req-1`, `req-2`…) es un
  contador por proceso que se reinicia con cada deploy. El `x-request-id` del gateway viaja al
  servicio, pero solo aparece en logs de error (`"Unhandled error"`), en el body de los
  errores y en `admin.audit_log.request_id`. Para cruzar servicios se usa la **URL**, que lleva
  el `shipmentId`, y la **hora**.
- **El camino feliz casi no loguea.** Los `ApiError` (4xx de negocio) no se loguean: solo
  aparecen como `statusCode` en `request completed`. Shipments, users y admin loguean casi
  únicamente fallos best-effort (`warn`). Las pushes con `PUSH_PROVIDER=mock` no dejan nada.
  **La ausencia de logs de app en un paso es lo esperado.** La evidencia del paso es la fila
  en BD más el `request completed` con un 2xx.
- **Pricing no sabe de qué envío cotiza**: `pricing_quote_computed` no lleva `shipmentId`.
  Se correlaciona por hora con el `POST /shipments/quote` del gateway.
- **Configuración que cambia lo que se ve** (defaults de compose):
  - `FUNDS_RELEASE_NOTIFIER=payments`: `delivered → completed` es automático tras la entrega.
    Con `console` se ve `[ConsoleFundsReleaseNotifier] Envío …` en texto plano y el envío se
    queda en `delivered`.
  - `ROUTES_PROVIDER=mock` / `FUEL_PRICE_PROVIDER=mock`: la cotización dice
    `"distanceSource": "haversine_mock"` y `"fuelSource": "mock"`.
  - `ALLOW_SIMULATED_PAYMENTS=false` por defecto. Si el pago simulado funcionó, en ese ambiente
    está en `true`.

## 3. Comandos de logs

Las variables las da el `.sql`: `S=<shipmentId>`, `T=<tripId>`, `P=<mp_payment_id>`.

```bash
# Todo lo del envío en un servicio, ordenado (URL + campos estructurados)
grep -h "$S" dump/movo-svc-shipments.log dump/movo-svc-payments.log dump/movo-svc-admin.log

# Requests del envío vistas por el gateway: hora, reqId, método, URL
# ("request completed" no trae req.url: su status se busca por el mismo reqId)
sed 's/^[^|]*| [^ ]* //' dump/gateway.log | jq -r --arg s "$S" '
  select(.msg=="incoming request" and ((.req.url // "") | contains($s)))
  | [.time, .reqId, .req.method, .req.url] | @tsv'

# Solo logs de app (sin access log) de shipments y payments, con event y msg
for f in dump/movo-svc-shipments.log dump/movo-svc-payments.log; do
  sed 's/^[^|]*| [^ ]* //' "$f" | jq -c 'select(.msg!="incoming request" and .msg!="request completed")
    | {time, level, event, msg, shipmentId, holdId, tripId}' ; done

# Warnings y errores de todo el período (lo primero a mirar)
for f in dump/*.log; do echo "== $f"; sed 's/^[^|]*| [^ ]* //' "$f" | jq -c 'select(.level>=40) | {time, level, event, msg, err: .err.message}' 2>/dev/null; done

# Handshakes, funding y forzado (URLs)
grep -hE "/shipments/$S/(handshake|funding|photos)|/offers/[^/]+/accept|/force-status|/trips/$T/start" dump/gateway.log dump/movo-svc-shipments.log dump/movo-svc-admin.log

# Ingesta GPS: cuántos POST de posiciones aceptó el gateway, por status (comparar con §8 del .sql)
sed 's/^[^|]*| [^ ]* //' dump/movo-svc-shipments.log | jq -r 'select(.msg=="incoming request" and (.req.url|test("/positions$"))) | .reqId' > dump/pos-req
sed 's/^[^|]*| [^ ]* //' dump/movo-svc-shipments.log | jq -r --rawfile ids dump/pos-req 'select(.msg=="request completed") | .reqId as $r | select($ids|contains($r+"\n")) | .res.statusCode' | sort | uniq -c
# (reqId se reinicia con cada deploy: acotar el dump a la ventana del viaje)
# 200 = lote procesado (el rechazo por punto va en `results[]`, no en el status); 401 = token vencido; 403 SHIPMENT_NOT_TRACKABLE = viaje no activo / envío fuera de assigned|in_transit;
# 422 INVALID_CAPTURED_AT = reloj del teléfono corrido > 2 min; 429 = rate limit (30/min por IP)

# Pagos: todo lo de MP del pago
grep -h "$P" dump/movo-svc-payments.log
# Pricing (texto)
grep -h "pricing_quote_computed\|quote_routes_provider\|fuel_price_" dump/movo-svc-pricing-logistics.log
# WebSocket de tracking
grep -h "realtime:" dump/movo-svc-shipments.log | grep "$S"
```

## 4. Camino natural, paso a paso

Notación: `tabla.columna = valor` (esquema `shipments` salvo indicación). "Gateway" es la ruta
pública bajo `/api/v1`; las internas (`/internal/...`) no pasan por el gateway.

### Paso 1. Cotizar y crear el envío (emisor)

| | |
|---|---|
| Endpoints | `POST /shipments/quote` → `POST /shipments` → `POST /shipments/:id/photos/presign` + `/photos/confirm` (≥ 2 fotos `creation`) |
| Llamadas | pricing `POST /quote` (si no hay `quoteId` congelado); users `GET /users/:id` (receptor y emisor), `/internal/users/:id/block-relations`, `POST /geocode/reverse` ×2; users `POST /internal/notifications/push` (al receptor) |
| BD | `shipments` INSERT: `status = awaiting_receiver_confirmation`, `payment_simulated = false`, `carrier_id`/`agreed_price_ars` = null, `suggested_price_ars`/`calculation_method`/`high_demand` del quote (null si pricing cayó), `receiver_confirmation_deadline = min(now+48h, fin de ventana de retiro)`. `shipment_events`: `null → awaiting_receiver_confirmation`, `actor_id = sender`. `shipment_photos`: `stage = creation`, `s3_key = shipments/<id>/creation/<uuid>.jpg` |
| Logs esperados | pricing: `pricing_quote_computed {…"suggestedPriceArs"…, "distanceSource", "fuelSource"…}` (`app/services/pricing.py`); el resto es solo access log |
| Logs de falla | shipments `warn` `pricing_quote_unavailable` (`modules/shipments/shipments.service.ts:1420` quote, `:1510` create); pricing `quote_routes_provider_failed_using_haversine`, `fuel_price_fetch_failed`; `photo_pending_track_failed` |

### Paso 2. El receptor acepta

| | |
|---|---|
| Endpoint | `POST /shipments/:id/accept` (receptor) |
| BD | `shipments.status = published`; `shipment_events` `awaiting_receiver_confirmation → published`, `actor_id = receiver` |
| Logs esperados | solo access log. Pushes al emisor y "viaje que matchea" a transportistas |
| Logs de falla | `warn` `notification_dispatch_failed` |

### Paso 3. El transportista declara el viaje y oferta

| | |
|---|---|
| Endpoints | `POST /trips` · `POST /shipments/:id/offers` |
| Llamadas | gate DD-036 en ambos: users `GET /internal/users/:id/kyc-status`, payments `GET /internal/payments/mp-connect/:id/status`, `GET /internal/payments/users/:id/balance` |
| BD | `trips` INSERT `status = declared`, `started_at = null`. `offers` INSERT `status = pending`, `price_offered` (bruto), `trip_id`, `expires_at`, snapshots `*_at_offer`. `shipments` **no cambia** y no hay `shipment_events`. Cuando el emisor mira las ofertas: `offers.viewed_at_by_sender` |
| Logs esperados | solo access log |
| Logs de falla | `notification_dispatch_failed` ("No se pudo enviar la push de oferta nueva"); 403/409 de los gates como `statusCode` en el access log |

### Paso 4. El emisor acepta la oferta (inicio de la saga, DD-037)

| | |
|---|---|
| Endpoint | `POST /offers/:id/accept` |
| Llamadas | gate del transportista (kyc-status, mp-connect, balance), block-relations, users `GET /users/:id` (vehículo) |
| BD (una transacción) | `shipments`: `status = assignment_pending` (retiro a ≤ `FUNDING_NEAR_PICKUP_DAYS` = 3 días) o `assigned_unfunded` (> 3 días); `carrier_id`, `agreed_price_ars = offers.price_offered`, `chat_started_at = now`, `pickup_*` ← los de la oferta y los originales en `original_pickup_*`, `estimated_delivery_*`. `shipment_events`: `published → assignment_pending`, `actor_id = sender`, `reason = "Oferta <id> aceptada · ruta cercana: retiro en N días (dentro de 3); el emisor paga al aceptar"` (`repositories/offer-repository.ts:643`). `offers`: la elegida `status = accepted`, `responded_at`. Las demás **siguen `pending`** hasta el paso 5. Si la oferta no tenía viaje, se reusa un `trips` `declared` o se crea uno |
| Logs esperados | solo access log |
| Logs de falla | `auto_trip_vehicle_lookup_failed`, `notification_dispatch_failed` |

### Paso 5. Pago: hold de MP → `assigned`

| | |
|---|---|
| Endpoints | `GET /shipments/:id/funding` → `POST /shipments/:id/funding` (emisor, con `cardToken`) |
| Llamadas | shipments → payments `POST /internal/payments/holds/checkout-data`, `POST /internal/payments/holds/` (timeout 20 s); payments → MP `POST /v1/payments` (`capture:false`, `external_reference = shipmentId`, key `movo-hold-<shipmentId>-<attempt>`) |
| BD payments | `payments.holds` INSERT `attempt = 1`, `status = creating`, montos (`amount_ars = base_amount_ars = precio`, `application_fee_ars = commission_ars`, deuda 0) → UPDATE `status = authorized`, `was_authorized = true`, `status_detail = pending_capture`, `mp_payment_id`, `expires_at = now + 5 días` (DD-050), `card_brand`/`card_last4`. Sin deuda previa no hay `user_ledger_entries` |
| BD shipments | `shipments.status = assigned`, `payment_simulated = false`. `shipment_events` `assignment_pending → assigned`, `actor_id = sender`, `reason = "Reserva de fondos confirmada"`, `kind = normal`. `offers`: las otras `pending` → `superseded` |
| Logs esperados | payments `info` `"creando hold en MP"` (`modules/holds/hold.service.ts:639`, con `shipmentId, holdId, attempt, amountArs, applicationFeeArs…`) → `info` `"hold procesado por MP"` (`:554`, `mpPaymentId, mpStatus: "authorized", mpStatusDetail: "pending_capture"`). Después llega el webhook (§4 bis) |
| Logs de falla | ver Variante A. Un rechazo de tarjeta **no** es error: 201 con `holds.status = rejected` + `failure_reason`, y el envío queda en `assignment_pending` |

**Webhook asociado (asíncrono, segundos después):** `POST /payments/webhooks/mercadopago`.
Payments loguea `info` `"notificación de MP recibida"` (`modules/webhooks/mp-webhook.routes.ts:80`,
`stored: true`). Un barrido posterior loguea `info` `"notificación de MP procesada"`
(`mp-webhook.service.ts:488`, `status: "processed"`, `outcome: "no_change"`), porque el hold ya
estaba `authorized`. Queda una fila en `payments.mp_webhook_notifications` con `status = processed`.
Si la notificación tiene firma inválida: `warn` `"notificación de MP con firma inválida"` y un 401.

### Paso 6. El transportista inicia el viaje (DD-034)

| | |
|---|---|
| Endpoint | `POST /trips/:id/start` |
| Llamadas | gate del transportista; pricing (warm-up del VRPTW, fire-and-forget); routes provider (ETA para la push) |
| BD | `trips.status = active`, `started_at = now`. Ofertas `pending` del viaje quedan con `trip_id = null`. **El envío no cambia** (sigue `assigned`, sin `shipment_events`) |
| Logs esperados | solo access log. Pushes "viaje iniciado" a emisor y receptor |
| Logs de falla | `trip_start_route_warmup_failed`, `trip_started_route_matrix_failed`, `trip_started_push_failed`; 409 `TRIP_START_TOO_EARLY` / `TRIP_PACKAGES_NOT_READY` / `TRIP_ALREADY_HAS_ACTIVE_TRIP` en el access log |

### Paso 7. Tracking hacia el retiro

Desde que el viaje está `active`, el mobile manda posiciones. En primer plano: captura
inmediata y una cada 25 s (`movo-mobile/src/location/location-service.ts`). En segundo plano:
cada 45 s o 30 m (`tracking-task.ts`). Todo va en lotes a `POST /shipments/positions`: un punto
por request con red, hasta 100 al recuperar señal.

| | |
|---|---|
| BD | **no hay `carrier_positions` todavía**: con el envío `assigned` las posiciones solo se difunden por WS y se guardan en Redis (`position:last:<tripId>`). `pickup_evidence` upsert: `arrived_at`/`arrived_lat`/`arrived_lng`/`arrived_accuracy_m` la primera vez a ≤ 250 m del retiro con precisión ≤ 100 m; contadores `far_positions_in_window` / `gray_positions_in_window` |
| Logs esperados | shipments `info` `{event: "carrier_arrived_pickup", shipmentId, accuracyM}` `"Llegada del transportista al retiro registrada"` (`services/position-service.ts:354`), **una vez**. Si el emisor/receptor abre el mapa: `info` `"realtime: conexión de tracking aceptada"` (`modules/tracking/tracking.routes.ts:100`) / `"realtime: cliente de tracking desconectado"` (`:152`). Push de proximidad a 2 km |
| Logs de falla | `proximity_check_failed`, `notification_dispatch_failed` (con `stage`); access log 403 `SHIPMENT_NOT_TRACKABLE` / 422 `INVALID_CAPTURED_AT` / 429 |

### Paso 8. Handshake de retiro (ADR-018)

Cedente: el emisor. Escanea: el transportista. Antes, foto `pickup` (1 a 5).

| | |
|---|---|
| Endpoints | emisor `POST /shipments/:id/handshake/generate` `{lat,lng}` → transportista `POST /shipments/:id/handshake/confirm` `{nonce, signature, lat, lng}` |
| Llamadas | users `GET /internal/users/<emisor>/device-key` (clave pública registrada con `POST /users/me/device-key`) |
| BD | `generate`: solo Redis `handshake:pending:<id>`, TTL **15 s**. `confirm` (una transacción): `shipments.status = in_transit`; `shipment_events` `assigned → in_transit`, `actor_id = carrier`, `reason = "Handshake de retiro confirmado"` (`modules/handshake/handshake.service.ts:333`); `handshake_events` `stage = pickup`, `actor_id = carrier`, `counterparty_id = sender`, `nonce_hash`, coordenadas de ambos, `distance_m ≤ 100` |
| Logs esperados | solo access log (generate 2xx, confirm 2xx). Pushes de custodia al emisor y al receptor |
| Logs de falla | access log con 410 `HANDSHAKE_QR_EXPIRED` (QR de más de 15 s: esperable en pruebas, se regenera), 422 `HANDSHAKE_INVALID_SIGNATURE`, 422 `HANDSHAKE_DISTANCE_EXCEEDED`, 409 `HANDSHAKE_CEDENTE_KEY_MISSING`, 409 `HANDSHAKE_PICKUP_DEADLINE_PASSED`, `PICKUP_EVIDENCE_MISSING`; `warn` `handshake_pending_cleanup_failed` |

### Paso 9. En tránsito: ingesta GPS (ADR-020)

| | |
|---|---|
| BD | `carrier_positions` INSERT **como máximo una cada 45 s por viaje** (`CARRIER_POSITION_MIN_PERSIST_INTERVAL_MS`, Redis `position:cadence:<tripId>:<bucket>`), solo con el envío `in_transit`: `lat`, `lng`, `accuracy_m`, `captured_at` (reloj del teléfono), `recorded_at` (servidor), `mocked`. Filas esperadas ≈ duración del tránsito / 45 s. Con primer plano a 25 s se descarta casi una de cada dos: **hay más POST 200 que filas, y eso es lo esperado** |
| Logs esperados | solo access log (un `POST /shipments/positions` 200 (el lote; el individual `/:id/positions` da 202) cada ~25–45 s). Push de proximidad a la entrega a 2 km |
| Qué mirar | huecos > 2 min (query §9 del .sql) = el teléfono dejó de reportar; `mocked = true` = GPS simulado; `recorded_at − captured_at` grande = lote encolado sin señal y enviado después |

### Paso 10. Handshake de entrega

Cedente: el transportista, que **muestra** el QR. Escanea: el receptor. Antes, foto `delivery`.

| | |
|---|---|
| Endpoints | transportista `POST /shipments/:id/handshake/generate` → receptor `POST /shipments/:id/handshake/confirm` |
| BD | `generate`: `shipments.delivery_handshake_started_at = now` (y cancela una transferencia de receptor pendiente, DD-038). `confirm`: `shipments.status = delivered`, `delivered_at = now`; `shipment_events` `in_transit → delivered`, `actor_id = receiver`, `reason = "Handshake de entrega confirmado"`; `handshake_events` `stage = delivery`, `actor_id = receiver`, `counterparty_id = carrier` |
| Logs esperados | solo access log. Las conexiones WS de tracking se cierran: `info` `"realtime: cerrando tracking por cambio de estado"` (`plugins/realtime.ts:137`). Pushes de custodia y de "calificá" a las tres partes. Inmediatamente después arranca el paso 11 |
| Logs de falla | los del paso 8; `warn` `funds_release_notify_failed` (`handshake.service.ts:367`) = no se pudo disparar la captura (la retoma el `settlement-sweep`) |

### Paso 11. Captura y `completed`

| | |
|---|---|
| Llamadas | shipments → payments `POST /internal/payments/holds/by-shipment/:id/capture` (timeout 50 s); payments → MP `PUT /v1/payments/:id` `{capture: true}` (key `movo-hold-capture-<holdId>`) + `GET /v1/payments/:id` (desglose) |
| BD payments | `payments.settlements` INSERT `kind = delivery`, `status = processing` (**antes** de hablar con MP), `gross_amount_ars = holds.amount_ars` → UPDATE `status = credited`, `mp_fee_ars`, `commission_ars`, `net_amount_ars`, `captured_at`. `payments.holds`: `status = captured`, `expires_at = null` |
| BD shipments | `shipments.status = completed` (`delivered_at` no cambia); `shipment_events` `delivered → completed`, `actor_id = null`, `reason = "Pago capturado y acreditado al transportista"`. Luego `trip-expiry-sweep` pasa `trips.status = completed` (ya con el envío en `delivered`) |
| Logs esperados | payments `info` `"capturando hold en MP"` (`modules/settlements/capture.service.ts:677`) → `info` `"hold capturado y liquidación acreditada"` (`:444`, `grossArs, mpFeeArs, commissionArs, netArs`) → shipments `info` `{event: "shipment_completed", settlementId}` `"envío completado: hold capturado y pago acreditado"` (`modules/settlements/settlement.service.ts:293`) → shipments `info` `{event: "trip_auto_completed", tripId, reason: "all_packages_finished"}` (`plugins/trip-expiry-sweep.ts:88`, ≤ 15 min después). Webhook `approved` en payments: `warn` `"MP informa el pago como approved y el hold no figura capturado…"` **solo** si llega antes de que termine la captura (carrera inofensiva) |
| Logs de falla | Variante A. shipments `warn` `settlement_not_credited` (`settlement.service.ts:265`) |
| Después | `POST /shipments/:id/ratings` → `ratings` (una por calificador y calificado). La reputación la calcula shipments; users solo la cachea en Redis 60 s, **no escribe nada en su BD** |

### Resumen esperado del envío completo

| Tabla | Filas (camino natural, sin deuda, 1 intento de pago) |
|---|---|
| `shipments.shipment_events` | 7: `null→awaiting_receiver_confirmation→published→assignment_pending→assigned→in_transit→delivered→completed` |
| `shipments.handshake_events` | 2 (`pickup`, `delivery`) |
| `shipments.offers` | 1 `accepted` + el resto `superseded` |
| `shipments.trips` | 1 `completed` con `started_at` |
| `shipments.carrier_positions` | ≈ duración del tránsito / 45 s |
| `shipments.shipment_photos` | `creation` ≥ 2, `pickup` ≥ 1, `delivery` ≥ 1 |
| `payments.holds` | 1 `captured` |
| `payments.settlements` | 1 `credited` |
| `payments.mp_webhook_notifications` | ≥ 1, todas `processed` |
| `payments.user_ledger_entries` / `payment_provider_events` / `admin.audit_log` | 0 |

## 5. Variante A: sandbox de MP caído

MP caído = timeout de 10 s (el SDK reintenta una vez, ~22 s en el peor caso), 5xx, 408/429 o
un 4xx no reconocido. **Ninguno de estos puntos manda alerta a Telegram**, salvo la liquidación
escalada y el webhook agotado.

| Dónde cae | Log | BD | Respuesta |
|---|---|---|---|
| Crear el hold (paso 5) | payments `error` `"MP no respondió al crear el hold"` (`hold.service.ts:693`, `mpHttpStatus`, `reason`) | `holds` queda `status = creating`, **sin `mp_payment_id`**; el envío sigue en `assignment_pending` | 502 `PAYMENT_PROVIDER_ERROR` hasta el mobile. El reintento con la misma tarjeta **reusa** la fila y la key |
| Hold en `creating` > 10 min | `warn` `"intento de hold abandonado: MP no tiene el pago"` (`:880`), o `warn` `"hold en creating adoptado desde MP"` (`:427`) si MP sí lo había creado | `rejected` + `status_detail = abandoned`, o `authorized` | lo dispara un `GET …?sync=true` (funding sweep cada 5 min, o el `GET /funding` del emisor) |
| Saga sin pago | shipments `info` `funding_timeout_sweep` (`funding.service.ts:748`) | a los 30 min (`FUNDING_PAYMENT_TIMEOUT_MINUTES`) el envío vuelve a `published`, `reason = "El emisor no completó el pago dentro del plazo"`, la oferta pasa a `assignment_lapsed` y se limpian `carrier_id`/`agreed_price_ars` | — |
| Consultar/liberar el hold | `error` `"falló la consulta del hold a MP"` (`:723`) / `"falló la liberación del hold"` | sin cambios | 502 |
| Captura (paso 11) | payments `error` `"captura fallida"` (`capture.service.ts:314`, `reason: "provider_error"`); shipments `warn` `settlement_retry_failed` en el sweep | `settlements.status = failed`, `attempts += 1`, `last_error`, `next_attempt_at` +5 / +30 / +120 min; el envío queda en `delivered` | reintenta `capture-retry` cada 1 min (`info` `"barrido de reintentos de captura"`) y `settlement-sweep` cada 5 min |
| Captura agotada | `error` `"liquidación escalada a proceso manual"` (`capture.service.ts:264`) + Telegram `settlement_escalated` | `settlements.status = escalated`, `escalation_reason`, `escalated_at` | push "cobro demorado" al transportista |
| Webhook (verificar el pago) | `info` `"notificación de MP procesada"` con `status: "pending"`, `outcome: "retry_scheduled"` | `mp_webhook_notifications.status = pending`, `attempts` sube, `last_error = "Payment.get falló (…)"`, backoff 1 min × 2ⁿ (tope 6 h) | a los 10 intentos pasa a `failed` + Telegram `mp_webhook_failed` |

## 6. Variante B: estado forzado desde el panel (DD-055)

Cadena: panel → svc-admin `POST /admin/shipments/:id/status` (exige step-up y un motivo de
≥ 20 caracteres) → svc-shipments `POST /internal/admin/shipments/:id/force-status`. Transiciones
permitidas (`shared/movo-shared/src/config/forced-transition-matrix.ts`): `assignment_pending`
o `assigned_unfunded` → `assigned` (`kind = manual`; `simulatePayment` solo vale acá), `→ published`
/ `→ cancelled`, y `delivered → completed` (`kind = manual`). **`in_transit` y `delivered` no
se pueden forzar**: si figuran, fue un handshake real.

**Rastro de cada intento:**

- `admin.audit_log`: **una fila por intento**, incluidos los rechazados (`outcome = failed` +
  `error_code`: `STEP_UP_REQUIRED`, `TYPED_CODE_MISMATCH`, `STATUS_CHANGED`,
  `TRANSITION_NOT_ALLOWED`…). `outcome = unknown` si shipments no respondió.
  `action = "shipment.status_change"`; `context` lleva `from`, `to`, `forced`, `risk`,
  `idempotencyKey`, `simulatePayment` y `replayed`. Un doble clic con la misma clave aparece como
  `replayed: true`, sin efecto nuevo.
- shipments `warn` `{event: "shipment_status_forced", shipmentId, from, to, kind, adminId}`
  `"Un admin cambió el estado de un envío"` (`modules/admin-internal/force-status.service.ts:447`).
- Con simulación, además: `warn` `{event: "payment_simulated", shipmentId, adminId}`
  `"Envío asignado con el pago simulado: no habrá cobro real"` (`modules/funding/funding.service.ts:341`).
- svc-admin no loguea el éxito: lo que queda es su `request completed` y la fila en `audit_log`.

**Diferencias en la BD con el camino natural:**

| | Natural | Forzado a `assigned` + pago simulado |
|---|---|---|
| `shipments.payment_simulated` | `false` | `true` |
| `shipment_events` → `assigned` | `kind = normal`, `actor_id = sender`, `"Reserva de fondos confirmada"` | `kind = manual`, `actor_id = admin`, `actor_name`, el motivo del admin |
| `payments.holds` | 1 `captured` | **0** (si hay alguna, alguien pagó de verdad: ver checklist) |
| `payments.settlements` | 1 `credited` | **0**: la captura la contesta `adapters/simulated-payments-client.ts` con una liquidación sintética `credited` de $0 que no se guarda |
| `payments.mp_webhook_notifications` | ≥ 1 | 0 |
| `shipment_events` → `completed` | `actor_id = null`, `"Pago capturado y acreditado al transportista"` | lo mismo, con el log `shipment_completed` (con `settlementId` = el `shipmentId`, porque la liquidación es sintética); o `kind = manual` + admin si además se forzó `delivered → completed` |
| Pushes | `fundingConfirmed*` | `shipmentStatusForced*` a las partes (no van `fundingConfirmed*`) |
| `offers` desplazadas | `superseded` | `superseded` (igual) |

Pasos 6 a 10 (inicio del viaje, tracking y handshakes) se ven **idénticos** al camino natural.
Lo único que cambia es que las llamadas a payments del envío se contestan localmente: no hay
líneas `"creando hold"` / `"capturando hold"` en payments para ese `shipmentId`.

**Forzado a `assigned` sin simulación** (confirmar un hold que MP sí autorizó): `kind = manual`
y `actor_id = admin`, pero `payment_simulated = false` y el hold real existe en `authorized`.
**Forzado `delivered → completed` sin simulación** dispara la captura real: con MP caído
falla con 502 `FORCE_STATUS_EFFECT_FAILED`, `error` `force_status_failed` (`:281`) y alerta,
y el envío queda en `delivered`.

Errores típicos del forzado en el access log de shipments: 403 `PAYMENT_SIMULATION_DISABLED`
(`ALLOW_SIMULATED_PAYMENTS` apagado), 409 `HOLD_ALREADY_EXISTS` (ya había un hold vivo),
409 `FORCE_STATUS_IN_PROGRESS`, 409 `IDEMPOTENCY_KEY_REUSED`, 422 `VALIDATION_FAILED`
(`simulatePayment` con destino ≠ `assigned`).

## 7. Checklist de anomalías

- [ ] **Hold huérfano**: con `payment_simulated = true` y una fila en `payments.holds` `authorized`
      o `creating`. Buscar `funding_orphan_hold` (`funding.service.ts:358`/`:673`). Si quedó
      `authorized`, la plata del emisor está retenida hasta que MP la venza: liberarla.
- [ ] **Hold en `creating` que nunca se resolvió** (sin `mp_payment_id` y sin el log
      `"intento de hold abandonado"`): el funding sweep no lo volvió a mirar.
- [ ] **`shipment_events` con saltos**: cada `to_status` tiene que ser el `from_status` de la
      fila siguiente. Un hueco = escritura fuera de `updateStatus` (no debería pasar).
- [ ] **`in_transit`/`delivered` sin su `handshake_events`**: no debería ser posible; si pasa, es un bug.
- [ ] **`handshake_events.distance_m` cerca de 100** o muchos 422 `HANDSHAKE_DISTANCE_EXCEEDED`:
      la precisión del GPS en el punto de entrega.
- [ ] **`carrier_positions` vacío o muy por debajo de lo esperado** en tránsito, y huecos > 2 min:
      tracking en segundo plano cortado (permisos "siempre", ahorro de batería).
- [ ] **POST de posiciones con 403/422/429** (comando de §3).
- [ ] **`mocked = true`** en alguna posición.
- [ ] **Envío en `delivered` que no pasó a `completed`**: `settlement_not_credited`,
      `funds_release_notify_failed` o `settlements.status ≠ credited`.
- [ ] **`trips.status` ≠ `completed`** tras la entrega (`trip_auto_completed` ausente).
- [ ] **`transit_anomaly_flagged_at` no nulo** (`transit_anomaly_flagged`, DD-045): el tránsito
      superó la entrega estimada.
- [ ] **`audit_log` con `outcome = unknown`**: no se sabe si el cambio se aplicó. Contrastar con
      `shipment_events`.
- [ ] **Todo `level >= 40`** del período (comando de §3) explicado.

## 8. Barridos que pueden loguear durante o después del viaje

Corren con lock de Redis; si no hay candidatos, no loguean nada.

| Barrido (servicio) | Cada | Log `info` cuando hizo algo |
|---|---|---|
| funding (shipments) | 5 min | `funding_timeout_sweep`, `funding_window_sweep` |
| trip expiry (shipments) | 15 min | `trip_auto_completed`, `trip_auto_expired` |
| transit anomaly (shipments) | 15 min | `transit_anomaly_flagged` (`warn`), `transit_anomaly_disputed` (`warn`) |
| pickup missed (shipments) | 15 min, 24 h de gracia | `pickup_missed_sweep`, `pickup_no_show_disputed` (`warn`) |
| settlement (shipments) | 5 min | `settlement_retry_failed` (`warn`) |
| capture retry (payments) | 1 min | `"barrido de reintentos de captura"` |
| webhook inbox (payments) | 1 min | `"notificación de MP procesada"` |
| carrier position purge (shipments) | 60 min | `carrier_positions_purged`: borra posiciones de envíos cerrados hace > 30 días (DD-023) |
