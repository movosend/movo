# DD-050 — Plazo del hold de Mercado Pago (5 días) y N de la saga (3 días)

**Estado:** aceptado (MOVO-215). Borrador para pegar en
`[Movo] 011-Registro de Decisiones de Diseño` en Drive. Complementa ADR-022 (deja de ser provisorio el plazo
que este parametrizó) sin modificarlo.

## Contexto

El hold (`capture: false`, ADR-022) se crea cuando el emisor paga y se captura al entregar
(MOVO-212). Si Mercado Pago lo cancela antes, el transportista entrega y no cobra. De ese
plazo salen dos valores de configuración:

- `MP_HOLD_VALIDITY_DAYS` (`svc-payments`): el `expires_at` que se persiste del hold (MOVO-209).
- `FUNDING_NEAR_PICKUP_DAYS`, la "N" de la saga (`svc-shipments`, MOVO-210): un retiro a N días
  o menos toma la ruta cercana (el emisor paga al aceptar); a más de N, la ruta lejana
  (`assigned_unfunded` + ventana de confirmación que se abre N días antes del retiro).

La documentación de MP para Argentina se contradice: 5 días (Checkout API v2), 7 días
(Checkout API Payments) y "7 días de validez" en otra página.

## Medición (spike MOVO-215)

Dos holds en sandbox con Visa crédito, uno con la configuración real (vendedor conectado
por OAuth + `application_fee`), consultados con `GET /v1/payments/:id` del 13/10 al
21/10/2026 (`docs/payments/mercadopago-spike/HOLD-EXPIRY-MEASUREMENT.md` y
`hold-expiry-log.jsonl`). **Ninguno se canceló en ~188 h (7,8 días)**: siguieron
`authorized / pending_capture`, sin cambio en `date_last_updated` y con
`date_of_expiration` en `null`. El sandbox no simula el vencimiento del hold.

## Decisión

1. **`MP_HOLD_VALIDITY_DAYS = 5`**: el mínimo que documenta MP. La medición no lo puede
   subir (el sandbox no vence) y no hay confirmación de MP para producción, así que se
   toma el plazo más corto publicado.
2. **`FUNDING_NEAR_PICKUP_DAYS` (N) = 3.** La restricción es `N + tránsito máximo <= plazo
   del hold`, porque el hold se crea hasta N días antes del retiro y se captura al
   entregar. Con N = 3 quedan 2 días entre el retiro y el vencimiento: un envío doméstico
   tarda horas o un día, y el día restante es el margen de seguridad (demoras, un `in_transit` demorado de DD-045, la confirmación
   tardía del handshake).
3. Los dos siguen siendo **configuración** (env var en los tres lugares), no constantes:
   si MP confirma otro plazo o se mide en producción, se cambia el secret sin tocar código.

## Alternativas consideradas

- **7 días** (lo que dicen dos de las tres páginas): daría N = 5 y menos envíos por la ruta
  lejana, pero si el plazo real es 5, los envíos con retiro a 4-5 días vencerían antes de
  entregar. El costo de equivocarse para arriba (el transportista no cobra) es mucho mayor
  que el de equivocarse para abajo (más envíos por la ventana de confirmación).
- **Esperar 10 días de medición**: no cambiaba la decisión; la medición ya superaba los dos
  plazos documentados.
- **Preguntar a soporte de MP**: sacado del alcance el 11/10 (ver MOVO-215). La respuesta
  solo podía bajar el plazo de diseño, nunca subirlo sin confirmación escrita.

## Consecuencias y limitaciones aceptadas

- **El plazo no está confirmado para producción ni por banco emisor.** En producción la
  red y el banco pueden acortar la retención; el sandbox no tiene bancos reales. Si un hold
  vence antes, la captura falla y se clasifica como `hold_expired` (MOVO-212).
- **Solo se midió Visa crédito**: el débito no se probó.
- **`status_detail` de un hold vencido sin confirmar.** El webhook de MOVO-268 asume
  `cancelled` + `expired`; si MP manda otro detalle, el hold igual pasa a `cancelled` y
  shipments recibe el evento `cancelled` en vez de `expired`. Se ajusta en
  `holdEventFor` (`mp-webhook.service.ts`) cuando se vea un vencimiento real.
- Con N = 3, un retiro a 4 días o más pasa por la ruta lejana: el emisor tiene que volver
  a confirmar el pago cuando se abre la ventana.

## Referencias

- Tickets: MOVO-215, MOVO-209, MOVO-210, MOVO-212, MOVO-268, MOVO-12
- ADR-022 (arquitectura de cobro), DD-045 (`in_transit` demorado)
