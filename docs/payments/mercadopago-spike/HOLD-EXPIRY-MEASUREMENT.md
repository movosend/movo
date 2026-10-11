# Medición del plazo real de un hold de Mercado Pago (MOVO-215)

**Estado: procedimiento listo, medición bloqueada.** Desde el 11/10/2026 el sandbox de MP
responde `500 internal_error` a todo `POST /v1/payments`, con cualquier pagador, vendedor o
app. El detalle de lo probado está en `SUPPORT-REPORT-500-2026-10-11.txt`. La tabla de
resultados del final se completa a medida que MP cancela los holds.

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

_Completar con la salida de `--report`._

| Hold | Medio | Creado | Cancelado | Horas | Estado final |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

**Plazo usado para el diseño (mínimo entre la medición y los 5 días documentados):**
_pendiente._
