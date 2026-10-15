# Spike MOVO-305: captura parcial y `application_fee` variable

Resultado del sandbox de Mercado Pago del **15/10/2026**, con la cuenta Vendedor "Transportista - Tomas",
el Comprador "Emisor - Alena" y la Visa de prueba (titular `APRO`). Lo usan la penalidad de cancelación
(`MOVO-226`, `MOVO-306`/`MOVO-307`) y la cuenta corriente del usuario (`MOVO-309`/`MOVO-311`/`MOVO-312`).

Test reproducible: `services/movo-svc-payments/test/partial-capture.sandbox.test.ts` (pega directo a la API
de MP; se saltea sin credenciales, ver su encabezado).

## Resumen

| Pregunta | Resultado |
| --- | --- |
| ¿Se puede capturar parte de un hold? | **Sí.** `PUT /v1/payments/{id}` con `{ capture: true, transaction_amount }` → `approved`. MP libera el resto solo: el pago queda con `transaction_amount` igual a lo capturado. |
| ¿Qué pasa con el `application_fee`? | **Se cobra entero, no se prorratea.** Hold de $1.150 con fee $150, captura de $287,50: Movo $150, MP $11,79, transportista $125,71. |
| ¿Se puede capturar un monto menor que el `application_fee`? | **No.** `400`, código `4201` ("transaction_amount must be bigger than application_fee"). El hold sigue `authorized`. |
| ¿Se puede capturar dos veces? | **No.** Un segundo `capture` sobre un pago ya capturado responde `200` con el mismo pago, sin cobrar de nuevo. |
| ¿Hasta qué `application_fee` acepta un hold? | Hasta cualquier valor **menor** que el monto: 30 %, 50 % y 90 % → `authorized`; 100 % y 110 % → `400`, código `4038` ("application_fee cannot be bigger or equal than transaction_amount"). |
| ¿El split funciona con un fee alto? | **Sí.** Fee del 50 % sobre $1.000, captura total: Movo $500, MP $41, transportista $459. |
| ¿Movo puede cobrar directo (pagar mi saldo)? | **Con tarjeta tokenizada, todavía no**: el token `TEST-` de Movo S.A. se obtiene (`client_credentials`), pero un `card_token` hecho con la `public_key` de un Vendedor da `403` ("At least one policy returned UNAUTHORIZED"); hace falta la `public_key` `TEST-` de Movo S.A., que sigue sin identificarse (`MOVO-283`, punto 2). **Con Checkout Pro sí**: Movo crea la preferencia (`collector_id` = Movo S.A.) y devuelve `init_point`; no se completó el pago en el navegador. |

## Detalle

### A. Captura parcial del 25 %

| | Monto |
| --- | --- |
| Hold (`transaction_amount`) | $1.150 |
| `application_fee` fijado al crear el hold | $150 |
| Capturado | $287,50 |
| `mercadopago_fee` (4,1 % de lo capturado) | $11,79 |
| `application_fee` cobrado | **$150 (entero)** |
| `net_received_amount` (transportista) | $125,71 |

El MP fee sí se calcula sobre lo capturado; el `application_fee` no.

### C. Captura menor que el fee

Hold de $1.150 con fee $150, captura de $100 → `400 4201`. El hold queda `authorized` y hay que liberarlo o
capturar otro monto.

### D. Tope del `application_fee`

| Fee sobre $1.000 | Resultado |
| --- | --- |
| 30 % | `201 authorized` |
| 50 % | `201 authorized` |
| 90 % | `201 authorized` |
| 100 % | `400 4038` |
| 110 % | `400 4038` |

## Qué cambia en las issues

Se aplica la fila "cobra la comisión entera" del plan decidido en `MOVO-305`: **se acepta y se documenta
como limitación de MP en ADR-043**. Además:

1. **`MOVO-306`/`MOVO-307`: la captura parcial tiene que ser mayor que el `application_fee` del hold.** Con
   la penalidad del 25 % y la comisión de Movo (~13,04 % del bruto) siempre se cumple, pero deja de cumplirse si
   el hold lleva además deuda del emisor (`MOVO-311` suma la deuda al `application_fee`). Ejemplo: precio
   $1.000, comisión $130,43 + deuda $300 → fee $430,43; penalidad $250 → `4201`. Regla: si la penalidad no
   supera el fee del hold, se aplica el plan B (liberar el hold y registrar la penalidad como deuda, `MOVO-309`).
2. **Compensación real del transportista:** penalidad − comisión de Movo − fee de MP ≈ **11 % del precio**
   (el 25 % menos ~13 % menos ~1 %). La app tiene que mostrar ese monto, no el 25 %.
3. **`MOVO-311`:** MP acepta un `application_fee` de hasta casi el 100 % del monto, así que el tope de 30 %
   decidido entra sin problema. Solo hay que garantizar `application_fee < transaction_amount`.
4. **`MOVO-312`:** el pago directo con tarjeta a Movo depende de la `public_key` de Movo S.A. (`MOVO-283`).
   Alternativa sin ese bloqueo: Checkout Pro (preferencia de Movo + `init_point` en un navegador embebido,
   confirmación por webhook). Recomendación: Checkout Pro para "Pagar mi saldo".
