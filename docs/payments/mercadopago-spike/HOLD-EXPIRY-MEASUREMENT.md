# Medición del plazo real de un hold de Mercado Pago (MOVO-215)

**Estado: cerrada el 21/10/2026.** El sandbox no canceló ninguno de los dos holds en ~188 h
(7,8 días), más que los dos plazos que documenta MP. Resultado y decisión al final y en
ADR-050 (`docs/payments/adr-050-plazo-del-hold.md`).

> **Usar la Visa `4075 5957 1648 3764`.** Con un vendedor conectado por OAuth, la Visa
> `4509 9535 6623 3704` (la de SOLUCION-FINAL) y la Mastercard de prueba hacen que
> `POST /v1/payments` responda `500 internal_error` sin causa, con cualquier pagador,
> vendedor o app (11/10/2026). Con la 4075 el hold se crea normal.

## Qué se mide y por qué

La documentación de MP da tres plazos distintos para capturar un pago con `capture:false`
en Argentina: 5 días (Checkout API v2), 7 días (Checkout API Payments) y "7 días de
validez" en otra página. De ese plazo salen dos valores que hoy son provisorios:

| Variable | Servicio | Valor provisorio | Qué decide |
| --- | --- | --- | --- |
| `MP_HOLD_VALIDITY_DAYS` | `svc-payments` | 5 | `expires_at` del hold (MOVO-209) |
| `FUNDING_NEAR_PICKUP_DAYS` (N) | `svc-shipments` | 3 | Ruta cercana o lejana de la saga (MOVO-210) |

La restricción es `N + tránsito máximo <= plazo del hold`, porque el hold se captura al
entregar (MOVO-212), no al retirar (ver el comentario de `FUNDING_NEAR_PICKUP_DAYS` en
`services/movo-svc-shipments/src/config/env.ts`).

## Procedimiento

1. Seguir el setup de `README.md` (credenciales sandbox, túnel, `.env`).
2. `node mp-spike-cli.js` → `2` (OAuth del vendedor) → `3` (tokenizar) → `5` (hold con
   split) → `w` (registrar el hold, con una etiqueta que diga el medio de pago).
   **No capturarlo ni cancelarlo.**
3. Repetir el paso 2 con cada medio de pago que acepte captura diferida (la opción `1`
   lista cuáles tienen `deferred_capture: supported`). Para cambiar de tarjeta, editar
   `MP_TEST_CARD_NUMBER` y `MP_TEST_PAYMENT_METHOD_ID` en el `.env` y volver a tokenizar.
   Las tarjetas de prueba de Argentina están en la documentación de MP ("Tarjetas de
   prueba"); como mínimo, un crédito y un débito. Si ningún débito o prepaga acepta
   captura diferida, anotarlo: también es un resultado (el hold solo se puede pedir con
   crédito).
4. Programar `node hold-expiry-watch.js` cada 6 horas. En Windows, desde esta carpeta
   (si la ruta tiene espacios, usar `cmd /c cd /d "<ruta>"` dentro de un `.cmd` aparte):

   ```powershell
   schtasks /Create /TN "MOVO-215 hold watch" /SC HOURLY /MO 6 /TR "cmd /c cd /d $PWD && node hold-expiry-watch.js >> hold-expiry-watch.out.txt 2>&1"
   ```

   Se puede correr a mano también; lo que importa es no pasar más de un día sin consultar.
   Con la PC apagada no se consulta, pero no se pierde precisión: la hora real de la
   cancelación sale de `date_last_updated` del pago, no de la consulta.
5. Cuando todos los holds dejen de estar `authorized`, `node hold-expiry-watch.js --report`
   imprime la tabla para pegar abajo y en MOVO-215. Borrar la tarea con
   `schtasks /Delete /TN "MOVO-215 hold watch"`.

`hold-watch.json` guarda el access_token `TEST-` del vendedor (está en el `.gitignore`).
`hold-expiry-log.jsonl` tiene una línea por consulta, sin tokens: se commitea al cerrar el
spike como evidencia.

## Qué mirar en el resultado

- **Horas entre `date_created` y la cancelación**, por medio de pago. El diseño usa el
  **mínimo** de todos (AC3), no el promedio.
- **`status_detail` final.** El webhook de MOVO-268 (todavía no mergeado en `develop`)
  asume `cancelled` + `expired` en `src/modules/webhooks/mp-webhook.service.ts` de
  `svc-payments`. Si MP usa otro valor, se cambia ahí.
- **Si el sandbox nunca cancela el hold** (sigue `authorized` pasados 10 días), el sandbox
  no simula el vencimiento y se usan los 5 días documentados. No se consulta a soporte
  de MP (se sacó del alcance el 11/10, ver comentario en MOVO-215): lo que el sandbox no
  muestra (producción, banco emisor) va al ADR como limitación aceptada.
- Si el webhook de MOVO-268 está registrado contra el ambiente donde se mide, la
  notificación de la cancelación tiene que quedar en `payments.mp_webhook_notifications`.

## Resultados

Medición del 13/10 al 21/10/2026, 16 consultas (`hold-expiry-log.jsonl`), todas `200`.
Ningún hold cambió: `date_last_updated` siguió siendo la de creación y
`date_of_expiration`/`money_release_date` siguieron en `null`.

| Hold | Medio | Cobra | Creado (ART) | Última consulta (ART) | Horas abierto | Estado final |
| --- | --- | --- | --- | --- | --- | --- |
| `1353638591` | Visa crédito 4075…3764 | Transportista (OAuth, `application_fee` 150/1000) | 13/10 19:46:39 | 21/10 17:06:56 | ≥188,3 (abierto) | `authorized / pending_capture` |
| `1353644127` | Visa crédito 4509…3704 | Movo S.A (dueña de la app) | 13/10 19:29:43 | 21/10 17:06:56 | ≥188,6 (abierto) | `authorized / pending_capture` |

**Se cerró antes de los 10 días previstos**: el AC2 de MOVO-215 ya se cumple con una medición
mayor que lo documentado (pasaron los 5 y los 7 días), y esperar al 23/10 no cambia el
plazo de diseño. Si el sandbox cancelara después, solo aportaría el `status_detail`.

Solo se probó Visa crédito; el débito no se llegó a medir (en producción el plazo lo
fija el banco emisor de todos modos, y queda como limitación aceptada).

**Plazo usado para el diseño:** **5 días** (`MP_HOLD_VALIDITY_DAYS=5`), el mínimo documentado,
porque el sandbox no simula el vencimiento. **N = 3** (`FUNDING_NEAR_PICKUP_DAYS=3`).

**`status_detail` de un hold vencido: sin confirmar.** El webhook de MOVO-268 sigue asumiendo
`cancelled` + `expired`; si MP manda otra cosa, el hold igual pasa a `cancelled` (evento
`cancelled` en vez de `expired`). Va al ADR-050 como limitación.

Los dos holds quedaron abiertos en el sandbox, sin capturar ni cancelar.
