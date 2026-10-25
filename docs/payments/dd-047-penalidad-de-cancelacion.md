# DD-047 — Penalidad por cancelar un envío asignado

**Estado:** propuesto (MOVO-307, 15/10/2026) · **Servicios:** `movo-svc-shipments` (decide y orquesta), `movo-svc-payments` (captura parcial, MOVO-306; cuenta corriente, DD-044) · **Contrato:** `@movo/shared` (`config/cancellation-penalty.ts`)

## Contexto

Hasta MOVO-307 el emisor no podía cancelar un envío `assigned`: respondía `409 SHIPMENT_CANCELLATION_PENALTY_NOT_SUPPORTED`. En ese estado el transportista ya tiene el envío en su viaje y el hold del emisor está autorizado. Una cancelación a último momento le hace perder el viaje al transportista, así que MOVO-226 decidió cobrar una penalidad. Faltaba resolver cuándo se cobra, cuánto, de dónde sale la plata y qué pasa cuando no se puede cobrar.

El spike MOVO-305 (`docs/payments/spike-movo-305-captura-parcial.md`) mostró cómo se comporta Mercado Pago en una captura parcial: captura parte del hold y libera el resto, pero cobra el `application_fee` **entero**, sin prorratearlo. Si lo capturado no supera esa comisión, MP rechaza la captura (`4201`) y el hold sigue `authorized`.

## Decisión

1. **Dos tramos, medidos contra el inicio de la ventana de retiro acordada.** Es la ventana del envío después de aceptar la oferta (MOVO-258 D3).
   - Con 12 h o más hasta el retiro (12 h justas incluidas), es **sin cargo** y el hold se libera entero.
   - Con menos de 12 h y la ventana todavía abierta, la penalidad es el **25 % del precio acordado**, redondeado a centavos.
   - Con la ventana ya cerrada, es **sin cargo**, porque el que faltó fue el transportista.

   Solo aplica a `assigned`: antes no hay fondos reservados.
2. **Una sola regla, en `@movo/shared`.** `computeCancellationPenalty` la usan el backend (cotiza y cobra) y el mobile (muestra el monto). Las constantes son `CANCELLATION_PENALTY_FREE_HOURS` (12) y `CANCELLATION_PENALTY_RATE` (0,25).
3. **El emisor confirma el monto que vio.** `GET /shipments/:id/cancellation-quote` devuelve `{ penaltyArs, reason, freeUntil }`. `POST /shipments/:id/cancel` recibe ese monto como `expectedPenaltyArs`; si no viene, cuenta como 0. Si no coincide con el cálculo del momento, responde `409 CANCELLATION_PENALTY_MISMATCH` con `details.penaltyArs` y no cancela. Es el mismo criterio que la cotización congelada (DD-028): nunca se cobra un monto que el emisor no vio.
4. **Primero se cancela, después se cobra.** La cancelación usa compare-and-swap (`expectedFrom: assigned`), así un handshake de retiro concurrente gana y la cancelación da 409. La penalidad se guarda en el envío en la misma transacción (`cancellation_penalty_ars`, `cancellation_penalty_status = pending`): aunque el proceso se caiga antes de llamar a payments, no se pierde lo que hay que cobrar.
5. **Cobro, idempotente y retomable.** Lo hace `settleCancellationPenalty`, al que llaman la cancelación en línea y el barrido de liquidaciones:
   1. registra la deuda en la cuenta corriente del emisor (`cancellation_penalty`, key `penalty:<shipmentId>`);
   2. captura esa parte del hold (`POST .../capture` con `kind: cancellation_penalty`, MOVO-306);
   3. con la captura acreditada, registra el cobro (`penalty_capture`, negativo y `settled`, key `penalty_capture:<shipmentId>`). El saldo queda en cero y el envío pasa a `captured`.
6. **Cuando el hold no alcanza, la penalidad queda como deuda.**
   - Si la penalidad no cubre la comisión del hold más el fee de MP (`422 CAPTURE_BELOW_APPLICATION_FEE`, plan B), se libera el hold entero. MP solo acepta una captura parcial que le deje neto al transportista (escenario H del spike MOVO-305).
   - Si el hold venció o no existe, no hay nada que liberar.

   En los dos casos el envío pasa a `debt`, la deuda queda en la cuenta corriente y se cobra en la próxima operación del emisor (MOVO-311). Un fallo transitorio deja la penalidad `pending` para el barrido.
7. **Avisos.** Con la captura, el transportista recibe su compensación neta y el emisor el monto cobrado. Con la deuda, solo se le avisa al emisor. La cancelación con penalidad no afecta la reputación del emisor.

8. **Baja del transportista (MOVO-310), misma regla.** `POST /shipments/:id/carrier-withdrawal` (cotización en `GET /shipments/:id/carrier-withdrawal-quote`, mismo `expectedPenaltyArs` y mismo 409). El envío vuelve a `published` y el hold se libera entero: el emisor no paga nada. La penalidad, con los mismos tramos, no se cobra de ningún hold: va como deuda a la cuenta corriente del transportista (`cancellation_penalty`, `roleAtOrigin: carrier`, key `withdrawal_penalty:<offerId>`) y se descuenta de su próximo cobro (MOVO-311). Se guarda `pending` en la oferta (`carrier_withdrawn`) en la misma transacción que la transición y la retoma el barrido si payments no responde. Es por oferta y no por envío porque el envío puede volver a asignarse y tener otra baja. A diferencia del emisor (`computeCarrierWithdrawalPenalty`), aplica también desde `assignment_pending`/`assigned_unfunded` (la deuda no depende de que haya fondos reservados) y también con la ventana ya cerrada, hasta que el barrido de retiro no realizado (MOVO-258, 24 h después) cancele el envío: ahí el que faltó es el transportista. Al republicarse, el emisor vuelve a ver el precio base (`suggestedPriceArs`) y los transportistas pueden contraofertar como siempre.

## Limitación de Mercado Pago aceptada

Como MP cobra el `application_fee` entero en la captura parcial, el emisor paga el 25 % pero el transportista recibe bastante menos. Por ejemplo, sobre $1.150: la penalidad es $287,50, la comisión de Movo $150 y la de MP $11,79, así que el transportista recibe **$125,71 (≈ 11 % del precio)**. Se acepta tal cual y la app muestra el monto real, no el 25 %. La alternativa era bajar el `application_fee` del hold, pero eso exige crear el hold con otra comisión y deja de ser la de una operación normal.

## Alternativas descartadas

- **Tope monetario o porcentaje distinto por tramo de horas.** Se eligió un solo umbral para que la regla sea fácil de explicar en la app y en los Términos (MOVO-316).
- **Cobrar la penalidad como deuda siempre, sin captura parcial.** El emisor ya está presente y con el hold autorizado. Cobrar en el momento evita una deuda que puede no cobrarse nunca.
- **Recalcular en silencio si cambió el monto.** Descartado por el mismo motivo que en DD-028.

## Consecuencias y trade-offs aceptados

- El transportista recibe ≈ 11 % del precio, no el 25 %: es la limitación de MP de arriba.
- En el plan B y con el hold vencido, la plata de la penalidad se cobra después (MOVO-311) y queda para Movo, como toda deuda (DD-044). El transportista no recibe compensación en ese caso.
- Mientras la penalidad está `pending`, el saldo del emisor muestra la deuda aunque la captura esté por concretarse.
- Si el hold lleva deuda previa del emisor (recargo de MOVO-311), el `application_fee` incluye ese recargo y puede superar a la penalidad: MP rechaza la captura parcial (`CAPTURE_BELOW_APPLICATION_FEE`) y se aplica el plan B. Visto en dev: hold de $9.061 con fee de $2.895,79 (incluye $2.091 de deuda) y penalidad de $1.742,50. Se acepta: la penalidad queda como deuda y no se cobra del hold. La alternativa descartada por ahora era capturar fee + neto mínimo y cotizarlo en `cancellation-quote`, que cambia el monto que ve el emisor.
- La penalidad del transportista que se baja queda para Movo (DD-044), no compensa al emisor: él recupera el hold entero y el envío vuelve a publicarse. Se aplica sin mirar el motivo de la baja; la atribución por GPS del no-retiro es MOVO-270. Mientras tanto queda un incentivo a no bajarse: si el transportista simplemente no aparece, el barrido de MOVO-258 cancela sin culpables y no paga nada.
- `svc-shipments` no tiene un canal de alertas propio. Un hold vencido al cobrar la penalidad deja un log `error` (`cancellation_penalty_hold_unavailable`) en vez de una alerta.
