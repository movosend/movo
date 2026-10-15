# ADR-044 — Cuenta corriente del usuario

**Estado:** aceptado (MOVO-309, 15/10/2026) · **Servicio:** `movo-svc-payments` · **Contrato:** `@movo/shared` (`types/user-ledger.ts`)

## Contexto

Emisor y transportista son roles contextuales: la misma persona puede enviar hoy y transportar mañana. Las penalidades por cancelar (MOVO-226) y la comisión de los envíos en efectivo (MOVO-37) son deudas de una persona, no de un rol, y se saldan por el medio que haya: una captura parcial del hold propio (MOVO-307), el `application_fee` de la próxima operación en cualquier rol (MOVO-311) o un pago voluntario con tarjeta (MOVO-312). Hace falta un registro único de lo que cada usuario debe o tiene a favor.

## Decisión

Una tabla `payments.user_ledger_entries` por **usuario**, con **saldo con signo** (positivo = debe, negativo = a favor).

- **Un movimiento por fila.** Tipos: `cancellation_penalty`, `penalty_capture`, `cash_commission`, `fee_offset`, `payment_surcharge`, `voluntary_payment`, `manual_adjustment`. `role_at_origin` (`sender`/`carrier`) es solo informativo: no condiciona cómo se salda.
- **Estados:** `pending`, `reserved` (se está cobrando), `settled`, `voided`. El saldo es la suma de todo lo que **no** está `voided`; un movimiento `settled` sigue contando, y lo que lo cancela es un movimiento negativo aparte (p. ej. `penalty_capture`). Así el saldo se explica solo, sin reglas por estado.
- **Solo inserción, impuesto por la base.** Triggers `BEFORE DELETE`/`BEFORE UPDATE` en la migración: no se borra nada y de un `UPDATE` solo se acepta el cambio de `status`. Un error se corrige anulando (`voided`) o con un movimiento inverso, nunca editando. Se eligió trigger y no solo disciplina del repositorio porque la tabla es evidencia de plata que se le cobra a una persona.
- **Idempotencia por `idempotency_key` única** más un hash del cuerpo (`request_fingerprint`): el mismo reintento devuelve el movimiento original (200); la misma key con otro cuerpo es `409 LEDGER_IDEMPOTENCY_CONFLICT`. La base resuelve la carrera (P2002): tres altas simultáneas terminan con una fila.
- **`oldestUnpaidAt`** = el movimiento de deuda (monto positivo) `pending`/`reserved` más viejo, y `null` si el saldo no es positivo. Es lo que va a mirar el bloqueo por deuda vencida (MOVO-313).
- **Monto:** `Decimal(12,2)` en la base, `number` con 2 decimales en el contrato HTTP (igual que holds y liquidaciones). Distinto de cero y con tope de ±$10.000.000 por movimiento (frena un typo). Los decimales se validan en el service (Ajv compara en float).
- **El signo no se deduce del tipo.** El ledger no impone que `cancellation_penalty` sea positivo ni que `voluntary_payment` sea negativo: quien registra manda el signo. Se evaluó validarlo y se descartó por ahora porque los tickets que lo van a consumir (307, 311, 312) todavía no fijaron sus casos borde; si se vuelve útil se agrega un chequeo sin migrar datos.
- **Ajuste manual** (`manual_adjustment`): solo por endpoint interno, `reason` obligatorio (también como `CHECK` en la base) y `adminId` para la auditoría.
- **Sin FK** a usuarios y envíos (ADR-003); solo `hold_id` es FK, porque `holds` es del mismo schema.

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

## Alternativas descartadas

- **Cuenta corriente del transportista:** no cubre al emisor que cancela con hold propio ni la comisión en efectivo del emisor.
- **Un saldo mutable por usuario** (una fila con `balance`): no deja evidencia ni permite reconstruir cómo se llegó a un monto en una disputa.
- **Tabla totalmente inmutable** (el `status` como movimientos nuevos): obligaría a derivar el estado vigente con una consulta más compleja en cada lectura, sin ganancia real.

## Consecuencias y trade-offs aceptados

- Los consumidores (307, 310, 311, 312, 313) arman sus propias `idempotencyKey`; una key mal construida puede registrar una deuda dos veces o descartar una legítima. Convención sugerida: `<tipo>:<shipmentId>` (ej. `penalty:<id>`).
- Un movimiento `reserved` cuenta para el saldo y para `oldestUnpaidAt`; si la reserva se cae, quien la hizo tiene que volverla a `pending` o anularla. No hay barrido que lo haga solo.
- No hay endpoint HTTP para cambiar el `status` todavía: lo expone el service (`transition`) y lo van a abrir 311/312 cuando lo necesiten.
- La plata de la deuda no pasa por Mercado Pago hasta que 311/312 la cobren; hasta entonces es un registro contable, no un cobro.
