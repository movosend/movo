# DD-056 — Resolución de disputas: matriz de pago, estado final y reembolsos

**Estado:** propuesto (MOVO-337, backend de MOVO-34). Borrador para pegar en
`[Movo] 011-Registro de Decisiones de Diseño` en Drive. Complementa DD-021 (los 11 estados), DD-044
(cuenta corriente), DD-052 (no-retiro) y DD-054 (disputa desde `completed`) sin modificarlos, y
cierra el hueco que dejaban: `disputed` no tenía salida. Va como DD y no como ADR (acordado con el
equipo): es una regla de negocio de un módulo, no fija stack, proveedor ni modelo de seguridad.

## Contexto

Una disputa abierta (MOVO-334) deja el envío en `disputed` sin salida. Un admin la resuelve desde el
panel (MOVO-338) y esa resolución tiene que (1) mover la plata según en qué momento se abrió la
disputa, (2) llevar el envío a un estado final, (3) levantar el bloqueo del transportista, (4) avisar
a las tres partes y (5) habilitar la calificación del ganador. Todo con la regla de conflicto de
interés y la bitácora de MOVO-286.

## Decisión

### 1. Matriz de resolución

El resultado es `sender` (a favor del emisor), `carrier` (a favor del transportista) o `partial`
(reparto). La acción de pago depende del estado del envío **cuando se abrió** la disputa (el
`fromStatus` del evento que lo pasó a `disputed`):

| Resultado | `assigned` (hold ya liberado por el barrido, DD-052) | `in_transit` (hold sin capturar) | `delivered` / `completed` (ya capturado) |
| --- | --- | --- | --- |
| A favor del emisor | nada | liberar el hold | reembolso total |
| A favor del transportista | crédito en su cuenta corriente | captura total | nada |
| Parcial | crédito en su cuenta corriente | captura parcial | reembolso parcial |

Regla única en `@movo/shared` (`config/dispute-resolution.ts`: `disputePaymentAction`,
`splitDisputeStake`, `minimumPartialCaptureArs`); `svc-admin` y `svc-shipments` no la reimplementan.

### 2. Monto en juego y reparto parcial

El **monto en juego** es lo que hay en `svc-payments` hoy: el hold (`in_transit`), lo reembolsable
del cobro acreditado (`delivered`/`completed`) o el **neto del envío** (`assigned`: precio acordado
menos la comisión de Movo, que es lo que el transportista hubiera cobrado).

`partial` lleva **un porcentaje del set `DISPUTE_PARTIAL_PRESETS` (25, 50, 75) o un monto libre**,
nunca los dos. Ambos expresan **lo que conserva el transportista**; el resto es del emisor. El monto
libre tiene que ser mayor que cero y menor que el total (un monto igual al total es un resultado
`carrier`). Se persiste el monto final (`carrier_amount_ars` y `sender_amount_ars`) más el porcentaje
elegido, si lo hubo.

**Piso de la captura parcial (AC6).** Mercado Pago solo acepta capturar si al transportista le queda
neto (MOVO-306): lo capturado menos el estimado de la comisión de MP tiene que superar el
`application_fee` del hold. `svc-admin` lo valida **antes** de llamar, con `minimumPartialCaptureArs`
sobre la vista previa de `svc-shipments`, y responde `422 DISPUTE_PARTIAL_BELOW_MINIMUM` con
`details.minimumArs` para que el panel lo muestre. `svc-shipments` lo vuelve a validar (el hold pudo
cambiar) antes de guardar nada.

### 3. Estado final del envío, sin estados nuevos

El equipo no quiso sumar un estado: se resuelve con los que existen, con dos aristas nuevas
`disputed → completed` y `disputed → cancelled`.

- **A favor del emisor → `cancelled`**: el transportista no cobra y el envío no se concretó.
- **A favor del transportista o parcial → `completed`**: hubo cobro para el transportista.

El resultado, el monto y el razonamiento viven en la disputa, no en el estado del envío: por eso
`cancelled`/`completed` de una disputa no se confunden con una cancelación ni con una entrega normal.
Las dos aristas las usa únicamente el servicio de resolución (el repositorio exige
`UpdateStatusOptions.resolveDispute` para salir de `disputed`) y no forman parte de
`FORCED_TRANSITION_MATRIX` (DD-055): un envío en disputa solo sale por la resolución.

Efectos de las aristas:

- `→ cancelled` cierra las ofertas del envío (`shipment_cancelled`) como cualquier cancelación.
- `→ completed` desde `in_transit` fija `deliveredAt` en el momento de la resolución (no hubo
  handshake de entrega): es el ancla de la ventana de calificación.
- La resolución es **definitiva**: un envío `completed` cuya disputa ya se resolvió no admite abrir
  otra, aunque siga dentro de los 7 días de DD-054 (`422 DISPUTE_NOT_ALLOWED`).

### 4. Recuperar lo ya acreditado (`delivered`/`completed`)

Si el resultado es a favor del emisor o parcial, el cobro ya está en la cuenta del transportista. La
recuperación es la del reembolso de MOVO-336, sin lógica propia en este servicio:

1. El reembolso sale de la cuenta de MP del transportista (`POST .../settlements/by-shipment/:id/refund`).
2. Si esa cuenta **no tiene saldo**, `svc-payments` no reintenta contra MP: deja la deuda del
   transportista en su **cuenta corriente** (`manual_adjustment`, DD-044) y el intento queda
   `fallback_to_ledger`.

`fallback_to_ledger` cuenta como acción de pago confirmada (la disputa se resuelve), pero el **emisor
todavía no cobró**: se alerta al equipo (`dispute_refund_fallback_to_ledger`) y devolverle la plata
es un caso manual. Es el costo aceptado de no tener un fondo propio de Movo para adelantar reembolsos.

En `assigned` no hay reembolso ni hold: lo que se acredita al transportista es un **ajuste manual
negativo** (a su favor) en la cuenta corriente, por el neto o su porcentaje. Es un saldo a favor que
descuenta futuras deudas, no un pago en efectivo.

### 5. Idempotencia y falla de la acción de pago

La resolución se hace en pasos y cada uno se puede repetir sin mover la plata dos veces:

1. **Guardar el resultado.** La disputa pasa de `open` a `resolving` con resultado, monto, acción y
   razonamiento (`FOR UPDATE`, un solo admin a la vez; además un lock en Redis por disputa).
2. **Acción de pago.** Idempotente por construcción: el hold se libera/captura una vez por envío; el
   reembolso lleva la clave `dispute-<id>`; el crédito, `dispute-<id>-credit`.
3. **Cerrar.** En una sola transacción el envío pasa a su estado final y la disputa a `resolved`
   (con admin y fecha).

Si la acción de pago falla (**AC7**), la disputa **no** queda `resolved`: queda `resolving` (estado
intermedio consultable en el listado y el expediente), con alerta (`dispute_payment_failed`) y
`502 DISPUTE_PAYMENT_FAILED`. Se reintenta con **los mismos datos**: otro resultado, monto o
razonamiento sobre una disputa `resolving` o `resolved` es `409 DISPUTE_RESOLUTION_MISMATCH`, porque
la plata pudo haberse movido ya. Una disputa `resolving` sigue bloqueando al transportista. Un
rechazo de negocio de payments **antes** de mover nada (p. ej. `HOLD_NOT_RELEASABLE`) devuelve la
disputa a `open` y se relanza su código: el admin puede resolver con otros datos. Resolver una
disputa ya `resolved` con los mismos datos responde `replayed: true` sin tocar nada.

### 6. Desbloqueo, avisos y calificación

- **Desbloqueo (MOVO-278 AC9).** El requisito `no_open_dispute` del transportista se lee de la
  entidad (`open` o `resolving`, motivo distinto de `pickup_no_show`): al quedar `resolved` y no
  tener otra, se levanta solo.
- **Push (AC11)** a las tres partes con `data.type: "dispute_resolved"`, el resultado visto por cada
  uno (`favorable`, `unfavorable`, `partial`; `neutral` para el receptor) y el razonamiento, **sin
  montos** ni en el texto ni en `data`. `data.ratingPending` marca al ganador (en `partial`, emisor y
  transportista).
- **Calificación (AC12).** `ratings.service.ts` es el único lugar de la regla de quién califica un
  envío no entregado: tras una disputa resuelta califica el ganador (en `partial`, las dos partes),
  dentro de las 72 h desde la resolución; el perdedor y el receptor no. Un envío cancelado por el
  barrido de no-retiro con `attribution: carrier` lo califica solo el emisor, al transportista,
  dentro de las 72 h desde la cancelación. Ningún otro cancelado se califica. **Sin penalización
  automática de reputación** en ningún caso (decisión del equipo, como MOVO-307).

### 7. Acceso

El panel solo habla con `svc-admin`. Resolver exige el rol admin y la regla de conflicto de interés
(`403 ADMIN_CONFLICT_OF_INTEREST` si el admin es parte del envío, incluidos los receptores
anteriores) y deja una fila de bitácora (`dispute.resolve`, objetivo `dispute`), también los rechazos.
Las notas internas (`dispute.note_add`) viven en `svc-admin` (`admin.admin_dispute_notes`, solo
agregar): las partes no pueden verlas porque no están en el servicio que las partes consultan.

## Alternativas descartadas

- **Un estado nuevo (`dispute_resolved`)**: el más expresivo, pero toca el enum de Postgres, los 11
  estados de DD-021, el mobile y el panel. El equipo prefirió no agregar estados.
- **Estado final por origen de la disputa** (`completed` si el paquete llegó, `cancelled` si no): un
  "a favor del transportista" en tránsito quedaría `cancelled` aunque cobre.
- **Siempre `cancelled`/`completed`**: un envío entregado y cobrado figuraría como cancelado en
  historiales, reputación y contadores (o al revés).
- **Marcar la disputa `resolved` antes de mover la plata**: es exactamente lo que prohíbe AC7.
- **Compensar `assigned` con la penalidad de DD-047** en vez del neto del envío: más chica y trata el
  no-retiro como una cancelación culpable del emisor; se eligió el neto porque la disputa discute si
  el transportista debió cobrar el viaje.

## Consecuencias y límites aceptados

- **Reembolso en `fallback_to_ledger`**: el emisor puede quedar sin cobrar hasta que el equipo lo
  resuelva a mano.
- **Crédito de `assigned`**: es saldo a favor en la cuenta corriente, no plata; el transportista lo
  usa contra deudas futuras.
- **`delivered` sin cobro acreditado** (la captura espera su reintento): no se puede resolver
  (`422 SETTLEMENT_NOT_REFUNDABLE`) hasta que se acredite.
- **`dispute_partial`**: la captura parcial de una disputa se liquida con su propio `kind` en `svc-payments` (misma mecánica que
  `cancellation_penalty`: monto sobre el `application_fee`, MP libera el resto). Así el ledger, el panel y la lógica de la penalidad
  de MOVO-306 no la confunden con una cancelación tardía. Una captura rechazada por MP (`failed`) se reemplaza por otro monto o
  resultado solo si MP confirma que el pago no se capturó.
- **Una captura parcial no libera el resto de forma explícita**: se apoya en que MP libera lo no
  capturado (MOVO-306); el hold queda `authorized` para el plan B de MOVO-307.
- **Hecho**: `PICKUP_NO_SHOW_RATING_INVITE_ENABLED` (MOVO-270, AC12) pasa a prendido por defecto (env, `.env.example` y compose), ya que
  la calificación está habilitada y la push de no-retiro invita a calificar. La pantalla del panel es MOVO-338 y la
  del mobile (ver el resultado y calificar) no está hecha.
