# DD-044 — Cuenta corriente del usuario

**Estado:** aceptado (MOVO-309, 15/10/2026) · **Servicio:** `movo-svc-payments` · **Contrato:** `@movo/shared` (`types/user-ledger.ts`)

## Contexto

Emisor y transportista son roles contextuales: la misma persona puede enviar hoy y transportar mañana. Las penalidades por cancelar (MOVO-226) y la comisión de los envíos en efectivo (MOVO-37) son deudas de una persona, no de un rol, y se saldan por el medio que haya: una captura parcial del hold propio (MOVO-307), el `application_fee` de la próxima operación en cualquier rol (MOVO-311) o un pago voluntario con tarjeta (MOVO-312). Hace falta un registro único de lo que cada usuario debe o tiene a favor.

## Decisión

Una tabla `payments.user_ledger_entries` por **usuario**, con **saldo con signo** (positivo = debe, negativo = a favor).

- **Un movimiento por fila.** Tipos: `cancellation_penalty`, `penalty_capture`, `cash_commission`, `fee_offset`, `payment_surcharge`, `voluntary_payment`, `manual_adjustment`. `role_at_origin` (`sender`/`carrier`) es solo informativo: no condiciona cómo se salda.
- **Estados:** `pending`, `reserved` (se está cobrando), `settled`, `voided`. El saldo es la suma de todo lo que **no** está `voided`; un movimiento `settled` sigue contando, y lo que lo cancela es un movimiento negativo aparte (p. ej. `penalty_capture`). Así el saldo se explica solo, sin reglas por estado.
- **Solo inserción, impuesto por la base.** Triggers `BEFORE DELETE`/`BEFORE UPDATE` en la migración: no se borra nada y de un `UPDATE` solo se acepta el cambio de `status`. Las transiciones de `status` también las limita la base: `voided` es terminal y de `settled` solo se sale anulando (`reserved` puede volver a `pending`). Un error se corrige anulando (`voided`) o con un movimiento inverso, nunca editando. Se eligió trigger y no solo disciplina del repositorio porque la tabla es evidencia de plata que se le cobra a una persona.
- **Idempotencia por `idempotency_key` única** más un hash del cuerpo (`request_fingerprint`): el mismo reintento devuelve el movimiento original (200); la misma key con otro cuerpo es `409 LEDGER_IDEMPOTENCY_CONFLICT`. La base resuelve la carrera (P2002): tres altas simultáneas terminan con una fila.
- **`oldestUnpaidAt`** = el cargo más viejo que compone la deuda actual: se recorren los cargos positivos `pending`/`reserved` del más nuevo al más viejo hasta cubrir el saldo, y `null` si el saldo no es positivo. Así una penalidad ya compensada por un movimiento negativo, pero que quedó `pending`, no figura como deuda vieja cuando después entra una deuda nueva. Es lo que va a mirar el bloqueo por deuda vencida (MOVO-313). Saldo, `oldestUnpaidAt` y la página de movimientos se leen en una sola transacción `REPEATABLE READ`.
- **Monto:** `Decimal(12,2)` en la base, `number` con 2 decimales en el contrato HTTP (igual que holds y liquidaciones). Distinto de cero y con tope de ±$10.000.000 por movimiento (frena un typo). Los decimales se validan en el service (Ajv compara en float).
- **El signo no se deduce del tipo.** El ledger no impone que `cancellation_penalty` sea positivo ni que `voluntary_payment` sea negativo: quien registra manda el signo. Se evaluó validarlo y se descartó por ahora porque los tickets que lo van a consumir (307, 311, 312) todavía no fijaron sus casos borde; si se vuelve útil se agrega un chequeo sin migrar datos.
- **Ajuste manual** (`manual_adjustment`): solo por endpoint interno, `reason` obligatorio (también como `CHECK` en la base) y `adminId` para la auditoría. El `reason` es evidencia interna del admin y se oculta (`null`) en el endpoint del usuario (`GET /payments/balance`).
- **Sin FK** a usuarios y envíos (ADR-003); solo `hold_id` es FK, porque `holds` es del mismo schema. Si el `holdId` no existe se rechaza con `404 HOLD_NOT_FOUND`.

### Endpoints

| Endpoint | Quién | Qué |
| --- | --- | --- |
| `GET /internal/payments/users/:userId/balance` | servicios | `{ balanceArs, oldestUnpaidAt }` |
| `POST /internal/payments/users/:userId/ledger-entries` | `svc-shipments` | alta idempotente (201 / 200) |
| `POST /internal/payments/users/:userId/manual-adjustments` | `svc-admin` | ajuste con motivo |
| `GET /payments/balance` | app (gateway) | saldo + movimientos paginados por cursor, con rol y envío de origen |

## Decisiones de producto (15/10/2026)

- La plata de las penalidades que se cobran como deuda **queda para Movo**. No hay crédito al emisor perjudicado; se puede sumar después como un movimiento negativo sobre el mismo saldo con signo.
- El saldo a favor está permitido en el diseño aunque hoy nada lo genere.

## Consumidores

- **Penalidades de cancelación (DD-047)**: la del emisor (`penalty:<shipmentId>`, cobrada del hold si alcanza) y,
  desde MOVO-310, la del transportista que se baja de un envío asignado con menos de 12 h
  (`withdrawal_penalty:<offerId>`, `roleAtOrigin: carrier`): no hay hold suyo, así que siempre queda como deuda y se
  descuenta de su próximo cobro (MOVO-311).

### Bloqueo por deuda vencida (MOVO-313, 15/10/2026)

`svc-shipments` consulta `GET /internal/payments/users/:userId/balance` dentro de
`resolveCarrierEligibility` (DD-036), en paralelo con KYC, MP y disputas. Si
`balanceArs > 0` y `oldestUnpaidAt` es de hace más de `USER_DEBT_OVERDUE_DAYS` (14), el
transportista no puede declarar viaje, ofertar, editar una oferta ni iniciar un viaje: 403
`USER_DEBT_OVERDUE` con `details.missingRequirements: ["no_overdue_debt"]`.

- **Decidido (15/10):** la deuda vencida bloquea **solo operar como transportista**. Como emisor
  se puede seguir operando porque su próximo pago ya incluye la deuda (MOVO-311).
- **Decidido (15/10):** el umbral es por **antigüedad** (más de 14 días sin saldar), **sin umbral
  de monto**: quien sigue operando con tarjeta la salda sola; el bloqueo apunta a quien no la
  salda por esa vía (efectivo, MOVO-37).
- **No necesita cambios en `svc-payments`:** `oldestUnpaidAt` ya es "el cargo más viejo que
  compone la deuda actual" (ver arriba), justo la edad que mide el bloqueo. La interpretación del
  umbral vive en `svc-shipments` (`domain/user-debt.ts`), que es quien tiene la env var.
- **Sin cache, falla cerrado:** se consulta en cada operación protegida; saldar la deuda (311/312)
  levanta el bloqueo en la siguiente consulta. Si `svc-payments` no responde, 502.
- **Un saldo positivo con `oldestUnpaidAt: null` bloquea.** Pasa cuando el saldo lo compone un
  movimiento positivo ya `settled` sin contrapartida (el cálculo de `oldestUnpaidAt` solo recorre
  cargos `pending`/`reserved`): no hay una edad que medir, pero se debe plata y no se puede probar
  que sea reciente. Se levanta al compensar el saldo con un movimiento negativo. Quien registre un
  cargo positivo directo en `settled` tiene que saber que el bloqueo por deuda entra de inmediato.
- Detalle del bloqueo y sus consecuencias (aceptar oferta, viajes recurrentes) en DD-036.

### Cobro en el próximo hold (MOVO-311, 16/10/2026)

La deuda se cobra en el `application_fee` del próximo hold, en el rol que el usuario use primero.
Detalle y ejemplo en `flujo-de-pagos.md` §6.1.

- **Decidido (15/10):** también se cobra al pagar como emisor (recargo al monto), y el tope es el
  **30% del precio** del envío, el mismo para los dos roles (`DEBT_COLLECTION_MAX_RATE`).
- **Decidido (16/10):** con el recargo al emisor, **Movo absorbe** la comisión de MP sobre el
  recargo: el `application_fee` lleva el recargo menos el estimado de esa comisión, y al emisor se le
  acredita el recargo completo. Así el transportista recibe lo mismo que sin recargo.
- **La reserva es un movimiento negativo `reserved`** (`fee_offset` del transportista,
  `payment_surcharge` del emisor). Es la excepción a "los pagos entran directo en `settled`"
  (abajo): un hold autorizado retiene la plata, y que otro cobro ya la vea tomada es lo que impide
  que cobre la misma deuda. Hay tres lecturas del saldo, cada una con su propósito (revisión de la PR #266):
  1. **Saldo informado** (`GET .../balance`, `GET /payments/balance`, `readLedgerBalance`): suma lo no
     anulado **sin** las reservas negativas. Es el que ve el usuario y el que mide el bloqueo por deuda
     (MOVO-313): una reserva no es un cobro, así que un hold en curso no destraba a nadie; si el hold se
     cae, la deuda sigue ahí y el bloqueo no se levantó. Se baja recién cuando la reserva pasa a `settled`.
  2. **Deuda sin reservar** (`readBalanceNetOfReservations`): el saldo informado menos lo que ya
     reservaron los holds en curso. Es el máximo que puede pagar "Pagar mi saldo" (MOVO-312).
  3. **Saldo cobrable** (`readCollectableBalance`): lo anterior menos los pagos de saldo abiertos
     (`creating`/`pending`, todavía sin asiento). Es sobre lo que un hold calcula el descuento o el recargo.
- **La anulación es un trigger de `holds`**, no código de cada camino: cuando un hold pasa a
  `rejected` o `cancelled` (creación, liberación, `?sync`, webhook), sus movimientos `reserved` pasan
  a `voided` en la misma transacción. Cubre la regla de abajo ("quien reserva tiene que anular").
- **Al capturar** la reserva pasa a `settled` si MP retuvo lo pedido; si retuvo otra cosa, como el
  monto no se puede editar, se anula y se inserta un `settled` por lo real. Se asienta antes de
  acreditar la liquidación, así una liquidación `credited` siempre tiene la deuda asentada.
- **Concurrencia:** el alta del hold lee el saldo cobrable y reserva con los dos usuarios bloqueados
  (`pg_advisory_xact_lock`). El pago de saldo de MOVO-312 toma **el mismo lock** al abrir su intento
  (lee la deuda sin reservar y crea el intento en esa transacción), y los intentos abiertos descuentan del
  saldo cobrable de los holds: un hold y un pago de saldo en paralelo no cobran la misma deuda.
- **El emisor paga lo que confirmó:** `GET /shipments/:id/funding` devuelve `totalArs` y el pago lo manda como
  `expectedTotalArs`; si al abrir el intento (con el saldo leído bajo el lock) el total que corresponde es otro
  porque la deuda cambió, se responde 409 `HOLD_AMOUNT_CHANGED` con `details.totalArs` y no se crea nada. Si un
  build viejo omite `expectedTotalArs`, puede pagar el precio acordado, pero un recargo por deuda responde 409
  sin crear el hold: nunca se cobra un monto mayor sin confirmación.

### Limitación conocida: reintegro o contracargo de un pago que cobró deuda

La deuda cobrada queda `settled` cuando se captura. Si ese pago después se **reintegra o tiene un contracargo**,
el webhook de MP lo registra en `payment_provider_events` y alerta, pero **no repone la deuda**: la plata vuelve
al emisor y el ledger sigue dando la deuda por saldada. Es la misma pata que el cobro ya acreditado ante un
contracargo (qué pasa con la liquidación queda para disputas, MOVO-30/34). Mientras tanto la reposición es manual:
un `manual_adjustment` positivo por el monto de la deuda cobrada. Se acepta porque el reintegro de un pago de un
envío con deuda es el caso raro de un caso raro, y repararlo bien requiere decidir antes qué se devuelve al emisor
(MOVO-34).

### Envíos pagados en efectivo (MOVO-37, 27/10/2026)

El emisor elige la modalidad al crear el envío (`paymentMethod`: `card` o `cash`, solo cambia mientras no haya
ofertas). En efectivo le paga al transportista **el monto acordado completo, en mano, al retiro**; el receptor no
participa de la parte económica. Sin hold no hay saga: al aceptar la oferta el envío pasa directo
`published → assigned` y las demás ofertas se cierran en la misma transacción. Todo lo que Movo cobra o reparte en
un envío en efectivo pasa por esta cuenta corriente:

- **Comisión como deuda del transportista, al entregar.** Con el handshake de entrega, `svc-shipments` pide a
  `svc-payments` (`POST /internal/payments/cash-shipments/:id/commission`) que registre un `cash_commission` por la
  comisión de Movo sobre el precio, con la **misma función** que el `application_fee` con tarjeta
  (`decomposeOfferGrossPrice`), y recién después pasa el envío a `completed`. Se registra en la entrega y no en el
  retiro: queda atada al servicio completado. Idempotente por envío; la misma operación crea la fila de
  `cash_shipment_payments` que el historial (MOVO-303) muestra como `cash_shipment`. La cobran los mecanismos de
  siempre: el `application_fee` de su próxima operación con tarjeta (311), "Pagar mi saldo" (312) y el bloqueo (313).
- **Tope de deuda del transportista.** Con una deuda total (vencida o no) mayor que
  `CASH_SHIPMENT_MAX_CARRIER_DEBT_ARS` (30.000 por defecto) no puede ofertar ni editar una oferta en un envío en
  efectivo (403 `CASH_DEBT_LIMIT_EXCEEDED`, requisito `cash_debt_within_limit`), ni se le puede aceptar una (409
  `OFFER_CARRIER_NOT_ELIGIBLE`, sin `details`: quien acepta es el emisor). Complementa al bloqueo por antigüedad de
  313: este frena el acumulado antes de que venza. Falla cerrado si payments no responde.
- **Emisor con deuda: no puede pagar en efectivo.** Con cualquier saldo deudor no puede crear (ni pasar a) un envío
  en efectivo (403 `CASH_PAYMENT_SENDER_HAS_DEBT`, requisito `no_pending_debt`); con tarjeta sí, porque su pago ya
  cobra la deuda (311). Es una excepción acotada a "como emisor no se bloquea" de 313: no se le bloquea operar,
  solo la modalidad, porque si no un emisor que solo usa efectivo nunca saldaría sus penalidades.
- **Penalidad del emisor sin hold y compensación al transportista.** Una cancelación con menos de 12 h (DD-047) no
  tiene hold que capturar: `POST /internal/payments/cash-shipments/:id/cancellation-penalty` registra la penalidad
  como `cancellation_penalty` del emisor y, en la misma transacción, un `cancellation_compensation` negativo y
  `settled` (un crédito) al transportista por lo mismo que le dejaría la captura parcial con tarjeta:
  penalidad − comisión de Movo sobre el precio − estimado del fee de MP sobre la penalidad
  (`cashPenaltyCompensationArs`, ≈ 11 % del precio). Así cancelar en efectivo no le sale gratis al emisor respecto
  del transportista. La baja del transportista no cambia (310: su penalidad ya era deuda).

**Limitación aceptada: en efectivo no rige "el transportista no cobra si no entrega".** Cobra al retirar. Si no
entrega, no se le registra la comisión y el reclamo del emisor va por disputa (MOVO-34), que sin hold solo puede
ajustar cuentas corrientes. Las mitigaciones son el KYC, el handshake de retiro como evidencia de custodia y el
bloqueo por deuda. Tampoco se verifica el pago en mano entre las partes: la evidencia es el handshake de entrega.

**Trade-off aceptado: un transportista que solo hace envíos en efectivo nunca tiene un `application_fee` del que
descontar.** Su deuda depende del pago voluntario y del bloqueo; el tope de deuda lo acota. Lo mismo vale para la
compensación: Movo la acredita aunque el emisor todavía no haya pagado su penalidad.

## Alternativas descartadas

- **Débito automático de la comisión a una tarjeta guardada del transportista (MOVO-37 antes del 19/10):** exigía
  cobrar una tarjeta sin CVV y falló en el sandbox de MP (`3031 security_code_id can't be null`); la cuenta corriente
  resuelve lo mismo con lo ya construido.
- **Cuenta corriente del transportista:** no cubre al emisor que cancela con hold propio ni la comisión en efectivo del emisor.
- **Un saldo mutable por usuario** (una fila con `balance`): no deja evidencia ni permite reconstruir cómo se llegó a un monto en una disputa.
- **Tabla totalmente inmutable** (el `status` como movimientos nuevos): obligaría a derivar el estado vigente con una consulta más compleja en cada lectura, sin ganancia real.

## Consecuencias y trade-offs aceptados

- Los consumidores (307, 310, 311, 312, 313) arman sus propias `idempotencyKey`; una key mal construida puede registrar una deuda dos veces o descartar una legítima. Convención sugerida: `<tipo>:<shipmentId>` (ej. `penalty:<id>`).
- Un movimiento `reserved` **positivo** (un cargo) cuenta para el saldo y para `oldestUnpaidAt`; si la reserva se cae, quien la hizo tiene que volverla a `pending` o anularla. No hay barrido que lo haga solo. Las reservas **negativas** de 311 no bajan el saldo informado (ver arriba) y las anula el trigger de `holds`.
- Los movimientos negativos (pagos o créditos) reducen el saldo siempre que no estén `voided`. Las operaciones que saldan deudas (307 captura parcial, 312 pago voluntario) registran los movimientos directamente en `settled` una vez acreditados; no se deben crear pagos en `pending` que reduzcan la deuda antes de que el cobro se concrete. La excepción es la reserva de 311 (arriba), atada a un hold con los fondos retenidos.
- No hay endpoint HTTP para cambiar el `status`: 311 mueve sus reservas dentro de `svc-payments` (trigger y captura) y 312 inserta directo en `settled`, así que ninguno lo necesitó.
- La captura parcial de 307 todavía no cobra deuda; 311 y 312 sí.
