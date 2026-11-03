# DD-054 — Disputa sobre un envío `completed`: la arista `completed → disputed`

**Estado:** aceptado (MOVO-334). Borrador para pegar en
`[Movo] 011-Registro de Decisiones de Diseño` en Drive. Complementa DD-021 (los 11 estados) y DD-045 sin
modificarlos. La política de reembolso de una disputa con el cobro ya acreditado no va acá:
la define DD-056 (MOVO-337).

## Contexto

MOVO-30 prevé que una parte pueda reclamar después de la entrega ("llegó roto", "no era lo que
mandé"). El grafo tenía `delivered → disputed` para eso, y `completed` era terminal (MOVO-208:
entregado y pagado, no hay nada después).

Pero el handshake de entrega captura el hold y pasa el envío a `completed` **en el momento**
(`captureAndComplete`, MOVO-212). Un envío solo queda en `delivered` mientras la captura no se
confirma (la reintenta el barrido de liquidaciones). En la práctica, cuando el receptor abre el
paquete y ve el daño, el envío ya está `completed` y la arista `delivered → disputed` casi nunca
se puede usar.

Demorar la captura para dejar abierta una ventana de reclamo no es viable: el hold de Mercado
Pago dura 5 días (DD-050), menos que la ventana que se quiere dar, y retener el cobro del
transportista en cada envío para cubrir la minoría que se disputa castiga al caso normal.

## Decisión

1. **Arista nueva `completed → disputed`.** `completed` deja de ser terminal: su única salida
   es la disputa.
2. **Ventana de 7 días desde `deliveredAt`** (`DISPUTE_WINDOW_DAYS` en `@movo/shared`), la misma
   para `delivered` y `completed`. Fuera de la ventana: `422 DISPUTE_WINDOW_EXPIRED`. El reloj
   arranca con el handshake de entrega, no con la captura, así que una captura demorada no
   alarga el plazo.
3. **Solo la usa una de las partes** (emisor, receptor o transportista) desde
   `POST /shipments/:id/disputes`. Ningún barrido la usa: las disputas automáticas salen de
   `in_transit` (DD-045) o de `assigned` (DD-052).
4. **No se toca la plata al abrir.** Con el envío `completed` no hay hold: el cobro ya está
   capturado y acreditado al transportista. Qué se devuelve y cómo se recupera lo acreditado
   (deuda en la cuenta corriente, DD-044) lo decide la resolución (MOVO-34) con la matriz de
   MOVO-337.
5. **Mientras dure la disputa, el envío deja de contar como cumplido.** `disputed` no está en
   `FULFILLED_SHIPMENT_STATUSES`: el envío sale de la reputación y el ranking
   (`countCompletedTransactions`, `countDeliveredAsCarrierByIds`), del historial compartido y
   de las calificaciones pendientes. Es el mismo comportamiento que ya tenía
   `delivered → disputed`. La ventana de calificación se congela mientras tanto
   (`rating-window.ts`). Al resolverse, MOVO-34 decide a qué estado vuelve.

La disputa (entidad `shipments.disputes`, MOVO-334) se crea en la misma transacción que la
transición. Una sola abierta por envío (índice único parcial).

## Alternativas descartadas

- **Demorar la captura hasta que venza la ventana.** El hold de MP no dura 7 días (DD-050) y
  posterga el cobro de todos los envíos.
- **Un estado nuevo (`completed_disputed`).** Duplica la lógica de `disputed` (bloqueo del
  transportista, baja de cuenta, chat en solo lectura, purga de la traza) sin ganar nada: la
  diferencia ("ya se cobró") ya está en el `fromStatus` del evento y en la liquidación.
- **Reclamo fuera del grafo** (ticket de soporte sin cambiar el estado). El envío seguiría
  sumando reputación y el transportista no quedaría bloqueado, distinto de una disputa en
  tránsito.

## Consecuencias

- Una disputa resuelta a favor del emisor sobre un `completed` necesita recuperar plata ya
  acreditada: no hay hold que liberar. Queda para MOVO-337 (cuenta corriente, DD-044).
- La reputación de un transportista puede bajar temporalmente por una disputa que después se
  resuelve a su favor.
- La traza GPS de un envío disputado no se purga (DD-023), así que con una ventana de 7 días
  la traza todavía existe (retención de 30 días).
