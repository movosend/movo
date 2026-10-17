# ADR-048 — Cuenta cobradora de Movo configurada por credenciales

**Estado:** aceptado (MOVO-315, 17/10/2026) · **Servicio:** `movo-svc-payments` · **Reemplaza:** la "cuenta cobradora vinculada por OAuth a un usuario interno" de MOVO-312

## Contexto

"Pagar mi saldo" (MOVO-312, ADR-044) cobra directo a Movo: el pago va a la cuenta de Mercado Pago de Movo S.A., sin hold ni
`application_fee`. MOVO-312 resolvió la cuenta cobradora como la de un transportista: un usuario interno de Movo
(`MOVO_COLLECTOR_USER_ID`) vinculaba por OAuth una cuenta de MP en "Pagos y cobros", y el servicio leía sus credenciales de
`carrier_mp_accounts`. La razón era que, en el sandbox, el token de la app no podía crear pagos.

Eso obligaba a mantener una cuenta de Movo "de mentira" solo para cobrar, atada al barrido de renovación de los
transportistas. En dev nunca se configuró, y "Pagar mi saldo" respondía 503.

## Qué se verificó contra el sandbox (17/10/2026)

Pagos de $100 con la tarjeta de prueba APRO:

| Token con el que se cobra | Resultado |
| --- | --- |
| `client_credentials` de la app `movosend` con `test_token` (`TEST-`, scope `urn:mp:online:payments/read-write`) | `403 At least one policy returned UNAUTHORIZED` |
| `client_credentials` sin `test_token` (`APP_USR-`) | `401 Unauthorized use of live credentials` |
| Credenciales de prueba que el panel genera para una app nueva (`APP_USR-` de un vendedor de prueba automático) | `401 Unauthorized use of live credentials` |
| **OAuth `authorization_code` de la cuenta de prueba Movo S.A. sobre su propia app, con `test_token`** | **`approved`**, con tarjeta completa y con tarjeta guardada en el customer de Movo S.A. + CVV |

La documentación de MP explica las tres primeras: las pruebas de Checkout API con tarjeta se hacen con las **credenciales de
prueba de una cuenta real**, y una cuenta de prueba (como la Movo S.A. del sandbox) no las tiene. En el sandbox el único token
que cobra con tarjeta sale de un login de la cuenta. MP sí permite que la dueña de la app se autorice a sí misma.

## Decisión

La cuenta cobradora es la propia cuenta de MP de Movo S.A. y se configura con sus credenciales, sin usuario de Movo:

- `MP_COLLECTOR_ACCESS_TOKEN`, `MP_COLLECTOR_PUBLIC_KEY` y `MP_COLLECTOR_MP_USER_ID` (Secrets Manager → compose). Sin las
  tres, `pay-data` y `pay` responden 503 `BALANCE_COLLECTOR_NOT_CONFIGURED`. El user id identifica las notificaciones del
  webhook que son de la cobradora.
- **Producción:** Access Token y Public Key productivos del panel de la cuenta real de Movo S.A. Es la integración estándar de
  Checkout API: la misma cuenta guarda las tarjetas (ADR-039) y cobra, y esas credenciales no vencen.
- **Sandbox (dev):** el token `TEST-` del OAuth de la cuenta de prueba Movo S.A., obtenido una vez con
  `services/movo-svc-payments/scripts/collector-oauth.mjs` (login en el navegador como Movo S.A., sin la app). Dura 180 días;
  el `refresh_token` queda en el secret (`MP_COLLECTOR_REFRESH_TOKEN`, no lo lee el servicio) para renovarlo.
- Se borra `MOVO_COLLECTOR_USER_ID`. El resto del flujo de MOVO-312 (intentos, idempotencia, ledger, webhook, conciliación) no cambia.

## Alternativas descartadas

- **Usuario interno vinculado por OAuth** (lo de MOVO-312): funciona, pero exige una cuenta de Movo solo para cobrar y mezcla la
  cuenta de la empresa con las de los transportistas (barrido, desvinculación, bloqueos).
- **Token de la app sin login (`client_credentials`)**: no puede crear pagos (tabla de arriba).
- **Checkout Pro**: el usuario sale de la app; ya descartado en MOVO-312.

## Consecuencias

- En dev el token vence a los 180 días (el actual, alrededor del 15/04/2027): hay que renovarlo con el script. En producción no aplica.
- Rotar las credenciales de producción es cambiar el secret y redeployar `svc-payments`.
- Dev y prod cobran con distinto tipo de credencial (OAuth vs. panel). Producción no se puede probar en el sandbox: queda para
  el spike MOVO-283, con un pago real de bajo monto.
