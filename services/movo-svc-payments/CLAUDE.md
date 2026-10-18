# CLAUDE.md — services/movo-svc-payments

Estado de implementación de `movo-svc-payments`. Ver el `CLAUDE.md` de la raíz del
repo para contexto general del proyecto (stack, ADRs, convenciones, git/PR).

Diseño del flujo de pagos y orden de los tickets: `docs/payments/flujo-de-pagos.md`.
Evidencia del sandbox de Mercado Pago (requests reales, cuentas, SDK vs REST):
`docs/payments/mercadopago-spike/SOLUCION-FINAL.md`.

## Historial de implementación

El historial por US (qué se hizo, en qué archivos, decisiones no obvias, qué quedó pendiente) vive en `HISTORIAL.md`, al lado de este archivo, y **no se carga solo**. Antes de tocar un módulo o una feature, buscá con grep en `HISTORIAL.md` su MOVO-id, nombre de archivo o concepto: muchas entradas documentan gotchas y decisiones que el código no explica. Al cerrar una US, la entrada nueva va al final de `HISTORIAL.md` (skill `cerrar-us`).

### Pagos / Mercado Pago (MOVO-49, spike)

- Referencia para todas las US de pagos (MOVO-267, 209, 111, 212, 213, 268, 100, 101,
  110, 112, 215, 225): `docs/payments/flujo-de-pagos.md` (flujo y orden de
  implementación) y `docs/payments/mercadopago-spike/SOLUCION-FINAL.md` (hold +
  split verificado en sandbox, script reproducible `mp-spike-cli.js`).
- Decisiones no obvias: en sandbox las tres partes (app, vendedor, pagador) tienen que
  ser cuentas de prueba (si no, error 2034); se tokeniza con la `public_key` del
  transportista y se cobra con su `access_token` OAuth; SDK oficial `mercadopago` v3
  en `svc-payments`; el hold se crea siempre con el emisor presente (card-on-file no
  validado en marketplace).
- Credenciales de sandbox (app, cuentas de prueba): no se versionan, se comparten por
  fuera del repo — ver `docs/payments/mercadopago-spike/README.md`.
