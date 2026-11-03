-- Extracción del rastro en BD de UN envío, para comparar contra docs/pruebas/flujo-esperado-e2e.md.
-- Uso (en la EC2):
--   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d movo \
--     -v shipment_id=<uuid> -f - < flujo-esperado-e2e.sql > envio-<uuid>.txt
-- Una sola instancia, un esquema por servicio (ADR-003): todo sale de la misma conexión.
-- Cada bloque dice qué se espera en el camino natural (N) y con pago simulado (S).

\pset pager off
\x auto

\echo '== 1. Envío'
-- N: status=completed, payment_simulated=false, carrier_id y agreed_price_ars no nulos,
--    delivered_at y delivery_handshake_started_at no nulos, transit_anomaly_* nulos.
-- S: igual pero payment_simulated=true.
SELECT id, status, payment_simulated, sender_id, receiver_id, carrier_id,
       suggested_price_ars, calculation_method, high_demand, agreed_price_ars,
       pickup_date, pickup_time_window_start, pickup_time_window_end,
       original_pickup_date, original_pickup_time_window_start, original_pickup_time_window_end,
       estimated_delivery_date, receiver_confirmation_deadline,
       chat_started_at, delivery_handshake_started_at, delivered_at,
       transit_anomaly_flagged_at, transit_anomaly_warned_at,
       last_status_changed_at, created_at, updated_at
FROM shipments.shipments WHERE id = :'shipment_id';

\echo '== 2. Línea de tiempo de estados (shipment_events)'
-- N, ruta cercana (7 filas, todas kind=normal):
--   null→awaiting_receiver_confirmation (sender) · →published (receiver)
--   →assignment_pending (sender, "Oferta … aceptada · ruta cercana: …")
--   →assigned (sender, "Reserva de fondos confirmada")
--   →in_transit (carrier, "Handshake de retiro confirmado")
--   →delivered (receiver, "Handshake de entrega confirmado")
--   →completed (actor null, "Pago capturado y acreditado al transportista")
-- S: la fila →assigned tiene kind=manual, actor_id=admin, actor_name y el motivo del admin.
--    Si también se forzó delivered→completed: kind=manual y actor_id=admin.
SELECT created_at, from_status, to_status, kind, actor_id, actor_name,
       assignment_carrier_id, attribution, reason,
       created_at - lag(created_at) OVER (ORDER BY created_at) AS desde_anterior
FROM shipments.shipment_events WHERE shipment_id = :'shipment_id' ORDER BY created_at;

\echo '== 3. Ofertas'
-- N: la aceptada en status=accepted con responded_at; las demás superseded (o withdrawn/expired).
SELECT id, carrier_id, status, price_offered, trip_id, offered_date,
       offered_pickup_time_window_start, offered_pickup_time_window_end,
       expires_at, created_at, viewed_at_by_sender, responded_at
FROM shipments.offers WHERE shipment_id = :'shipment_id' ORDER BY created_at;

\echo '== 4. Viaje (vía la oferta aceptada)'
-- N: status=completed (lo cierra trip-expiry-sweep apenas el envío está delivered), started_at no nulo,
--    started_at <= primer handshake.
SELECT t.id, t.status, t.departure_at, t.started_at, t.cancelled_at, t.vehicle_type,
       t.series_id, t.created_at, t.updated_at
FROM shipments.trips t
WHERE t.id IN (SELECT trip_id FROM shipments.offers WHERE shipment_id = :'shipment_id' AND status = 'accepted');

\echo '== 5. Handshakes'
-- N: 2 filas. pickup (actor=carrier, counterparty=sender) y delivery (actor=receiver, counterparty=carrier),
--    distance_m <= 100. El handshake no se fuerza: si falta una fila, esa custodia no se transfirió por QR.
SELECT created_at, stage, actor_id, counterparty_id, distance_m,
       actor_lat, actor_lng, counterparty_lat, counterparty_lng
FROM shipments.handshake_events WHERE shipment_id = :'shipment_id' ORDER BY created_at;

\echo '== 6. Evidencia de llegada al retiro (DD-052)'
-- N: 1 fila con carrier_id = el asignado, arrived_at no nulo y anterior al handshake de retiro.
--    Sin fila o arrived_at nulo: el teléfono no reportó cerca del retiro (≤ 250 m con precisión ≤ 100 m).
SELECT * FROM shipments.pickup_evidence WHERE shipment_id = :'shipment_id';

\echo '== 7. Fotos'
-- N: creation >= 2, pickup 1..5, delivery >= 1.
SELECT stage, count(*), min(created_at), max(created_at)
FROM shipments.shipment_photos WHERE shipment_id = :'shipment_id' GROUP BY stage ORDER BY min(created_at);

\echo '== 8. Posiciones GPS: resumen'
-- N: solo hay filas entre el handshake de retiro y el de entrega (antes del retiro se difunden pero no se
--    guardan). Filas ≈ duración del tránsito / 45 s si el teléfono reportó todo el tiempo.
--    mocked debe ser false/null; un max_gap grande = el teléfono dejó de reportar (fondo, sin señal, app cerrada).
WITH p AS (
  SELECT captured_at, recorded_at, accuracy_m, mocked,
         captured_at - lag(captured_at) OVER (ORDER BY captured_at) AS gap
  FROM shipments.carrier_positions WHERE shipment_id = :'shipment_id'
), h AS (
  SELECT max(created_at) FILTER (WHERE stage = 'pickup') AS pickup_at,
         max(created_at) FILTER (WHERE stage = 'delivery') AS delivery_at
  FROM shipments.handshake_events WHERE shipment_id = :'shipment_id'
)
SELECT count(*) AS filas, min(captured_at) AS primera, max(captured_at) AS ultima,
       (SELECT pickup_at FROM h) AS handshake_retiro, (SELECT delivery_at FROM h) AS handshake_entrega,
       round(extract(epoch FROM ((SELECT delivery_at FROM h) - (SELECT pickup_at FROM h))) / 45) AS filas_esperadas_aprox,
       max(gap) AS max_gap, round(avg(extract(epoch FROM gap))) AS gap_promedio_s,
       count(*) FILTER (WHERE mocked) AS mocked, round(avg(accuracy_m), 1) AS precision_media_m,
       max(recorded_at - captured_at) AS max_demora_ingesta
FROM p;

\echo '== 9. Posiciones GPS: huecos de más de 2 min'
SELECT captured_at - gap AS desde, captured_at AS hasta, gap
FROM (SELECT captured_at, captured_at - lag(captured_at) OVER (ORDER BY captured_at) AS gap
      FROM shipments.carrier_positions WHERE shipment_id = :'shipment_id') x
WHERE gap > interval '2 minutes' ORDER BY desde;

\echo '== 10. Disputas y calificaciones'
-- N: sin disputas. Ratings: hasta una por (rater, ratee) después de delivered.
SELECT id, reason, status, opened_by, opened_by_role, opened_at FROM shipments.disputes WHERE shipment_id = :'shipment_id';
SELECT created_at, role, rater_id, ratee_id, score FROM shipments.ratings WHERE shipment_id = :'shipment_id' ORDER BY created_at;

\echo '== 11. Holds (payments)'
-- N: 1 fila (attempt=1) status=captured, was_authorized=true, mp_payment_id no nulo, expires_at=null tras la captura.
--    Reintentos por caída de MP: filas extra en creating (sin mp_payment_id) o rejected (status_detail mp_http_*/abandoned).
-- S: 0 filas. Si aparece alguna, alguien pagó de verdad sobre un envío simulado (ver funding_orphan_hold).
SELECT attempt, id, status, was_authorized, status_detail, failure_reason, mp_payment_id, collector_id,
       amount_ars, application_fee_ars, commission_ars, debt_offset_ars, debt_surcharge_ars, mp_fee_ars,
       card_brand, card_last4, expires_at, released_at, created_at, updated_at
FROM payments.holds WHERE shipment_id = :'shipment_id' ORDER BY attempt;

\echo '== 12. Liquidación (payments)'
-- N: 1 fila kind=delivery, status=credited, attempts=0 o más, captured_at no nulo,
--    gross_amount_ars = holds.amount_ars, gross ≈ mp_fee + commission + net.
-- S: 0 filas (la liquidación del simulado es sintética, no se persiste).
SELECT id, kind, status, attempts, failure_reason, status_detail, last_error, next_attempt_at,
       escalated_at, escalation_reason, gross_amount_ars, mp_fee_ars, commission_ars, net_amount_ars,
       carrier_gross_amount_ars, carrier_mp_fee_ars, mp_payment_id, captured_at, created_at, updated_at
FROM payments.settlements WHERE shipment_id = :'shipment_id';

\echo '== 13. Cuenta corriente ligada al envío'
-- N sin deuda previa: 0 filas. Con deuda: fee_offset / payment_surcharge reserved → settled.
SELECT created_at, user_id, role_at_origin, type, amount_ars, status, hold_id, idempotency_key, reason
FROM payments.user_ledger_entries
WHERE shipment_id = :'shipment_id' OR hold_id IN (SELECT id FROM payments.holds WHERE shipment_id = :'shipment_id')
ORDER BY created_at;

\echo '== 14. Webhooks de MP de los pagos del envío'
-- N: >=1 por pago (authorized, approved). status=processed; outcomes típicos no_change, approved_left_to_capture.
--    pending con attempts>1 y last_error = MP caído al verificar; failed = se agotaron los 10 intentos.
SELECT received_at, topic, action, mp_payment_id, status, attempts, outcome, last_error,
       pending_hold_event, processed_at
FROM payments.mp_webhook_notifications
WHERE mp_payment_id IN (SELECT mp_payment_id FROM payments.holds WHERE shipment_id = :'shipment_id' AND mp_payment_id IS NOT NULL)
ORDER BY received_at;

\echo '== 15. Eventos externos de MP (chargeback/refund/mediation)'
-- N: 0 filas.
SELECT created_at, kind, mp_status, mp_status_detail, amount_ars, hold_status, alerted_at
FROM payments.payment_provider_events WHERE shipment_id = :'shipment_id';

\echo '== 16. Bitácora del panel (admin.audit_log)'
-- N: 0 filas. Forzado: una fila por INTENTO (incluidos rechazos: outcome=failed + error_code).
--    context: from, to, forced, risk, idempotencyKey, simulatePayment (si aplica), replayed.
SELECT created_at, admin_id, action, outcome, error_code, request_id,
       context->>'from' AS desde, context->>'to' AS hacia, context->>'simulatePayment' AS simulado,
       context->>'replayed' AS replay, context->>'rateLimited' AS rate_limited, reason
FROM admin.audit_log WHERE target_type = 'shipment' AND target_id = :'shipment_id' ORDER BY created_at;
