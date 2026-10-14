# ADR-039 — Tarjetas guardadas del emisor con re-ingreso de CVV

**Estado:** propuesto (MOVO-100). Revisa el punto 5 de ADR-035 ("el hold se crea siempre
con el emisor presente, sin tarjetas guardadas") **solo en lo que dice de tarjetas
guardadas**: el emisor sigue presente en cada pago, pero ya no re-ingresa todos los datos.
ADR-035 no se modifica (un ADR aceptado no se edita); este lo reemplaza en ese punto una vez
que pase a "aceptado". Borrador para pegar en la sección de ADRs de
`[Movo] 004 - Sprint 0.md` en Drive.

> **Actualización 13/10/2026:** la ubicación de la tarjeta (opción A, cuenta de Movo) quedó
> validada en sandbox con un token `TEST-` de Movo S.A. (ver "Dónde vive la tarjeta"). Falta
> confirmar en producción y los puntos de "Pasos para cerrar" antes de pasar a "aceptado".

## Contexto

ADR-035 descartó las tarjetas guardadas porque el único intento (spike MOVO-49, 29/09,
`SOLUCION-FINAL.md` §7) falló al guardar la tarjeta en la cuenta de un transportista con
`128 "payment method response is empty"`. La consecuencia de producto es mala: el emisor
tiene que escribir número, vencimiento, titular y CVV **cada vez** que acepta una oferta.

El 13/10/2026 se repitió la prueba contra el sandbox con un Vendedor de prueba vinculado en
dev (token `TEST-`), con un script propio y no el del spike. El `128` **no se reprodujo**.
Lo que se verificó, con Visa y Mastercard de prueba:

| Paso | Resultado |
| --- | --- |
| Guardar la tarjeta en un customer de la cuenta del Vendedor (`POST /v1/customers/{id}/cards`) | 201 |
| Re-tokenizar con `card_id` + `security_code` y la `public_key` del Vendedor (`POST /v1/card_tokens`) | 201 |
| Crear el hold con ese token, `capture:false` y `application_fee` (`POST /v1/payments`, token del Vendedor) | 201, `authorized / pending_capture` (los dos holds se cancelaron: `cancelled / by_collector`) |
| Control: re-tokenizar **sin** CVV y crear el hold | Visa: 500 `internal_error`. Mastercard: 400 `3031 "security_code_id can't be null"` |

Conclusiones firmes: (1) guardar la tarjeta y pagar con solo el CVV **funciona** con el hold
y el split de ADR-035; (2) pagar **sin** CVV no es posible, así que el cobro automático sin el
emisor (la opción B original de MOVO-12) sigue descartado.

No se verificó: que `application_fee` efectivamente se aplique (la consulta posterior
devolvió `fee_details` vacío; lo comprueba la captura, MOVO-212), ni el comportamiento días
después, ni más de un Vendedor.

## Dónde vive la tarjeta

En la primera prueba el customer y la tarjeta se crearon con el `access_token` **del
Vendedor**, es decir en la cuenta del transportista. Eso no sirve para el modelo que se quiere
(guardar tarjetas en Ajustes → Pagos y cobros y pedir solo el CVV al aceptar una oferta): en
Ajustes no hay transportista, y cada oferta puede venir de uno distinto. La alternativa es
guardar la tarjeta **en la cuenta de Movo S.A.** (un customer por emisor) y derivar de ahí un
token por transportista.

**Por qué parecía imposible y no lo era.** El spike había dado `401 300 "Unauthorized use of
live credentials"` al crear el customer con la app. La causa no era que Movo S.A. sea una
cuenta de prueba, sino que se usaba el token de la app (`APP_USR-…`), que MP trata como
producción. Pidiendo un token con `POST /oauth/token` (`grant_type=client_credentials`,
`test_token=true`) Movo obtiene un token `TEST-` y puede crear customers (201). Con
`test_token=false` se reproduce el `300`.

**Verificado el 13/10/2026 (opción A):**

| Paso | Resultado |
| --- | --- |
| Token `TEST-` de Movo S.A. (`client_credentials` + `test_token:true`) | 200, `TEST-` |
| Crear el customer del emisor en la cuenta de Movo | 201 |
| Guardar la tarjeta en ese customer (token de la tarjeta generado con una `public_key` `TEST-`) | 201 (`visa`) |
| Re-tokenizar con `card_id` de la cuenta de **Movo** + CVV y la `public_key` del Vendedor A | 201 |
| Hold con el `access_token` del Vendedor A, `payer: {type: "customer", id: <customer de Movo>}`, `capture:false` + `application_fee` | 201, `authorized / pending_capture` (cancelado después) |
| Mismo hold con `payer: {email}` en vez del customer | 400 `2002 "Customer not found"`: el pagador **tiene que ser el customer** de la tarjeta |
| Re-tokenizar con la `public_key` del Vendedor B | 201 (el hold de B no se probó: sin sus credenciales) |

Detalles que condicionan la implementación:
- Tokenizar la tarjeta con el `Bearer` de Movo (sin `public_key`) da `403 G001`; hace falta una
  `public_key` `TEST-` en sandbox. La `public_key` `APP_USR-` de la app genera un token que el
  customer `TEST-` no reconoce (`404 card not found`). En producción se espera usar la
  `public_key` de Movo.
- El `payer` del hold debe ser `{ type: "customer", id }`, por lo que `payerEmail` solo no
  alcanza: hay que guardar el `customer_id` por emisor.

| Opción | Cómo funciona | Estado |
| --- | --- | --- |
| **A. Tarjeta en la cuenta de Movo** (un customer por emisor), token por transportista derivado de ella | Ajustes guarda la tarjeta una vez; al aceptar una oferta se pide el token al transportista con `card_id` + CVV | **Validada en sandbox con el Vendedor A.** Falta el hold de otro Vendedor (B) y confirmar en producción |
| B. `card_id` de la cuenta del Vendedor A con la `public_key` de B | Una tarjeta guardada en una sola cuenta de transportista | Descartada: A resuelve el problema de raíz |
| C. Tarjeta por transportista | Ingresar la tarjeta completa la primera vez con cada transportista | Validada pero sin valor para el emisor; queda como respaldo si A fallara en producción |

## Decisión (propuesta)

1. El emisor puede **guardar tarjetas** y, al pagar, **solo re-ingresa el CVV**. El CVV nunca
   se guarda: el mobile lo usa para pedir a MP un token de un solo uso (`card_id` + CVV +
   `public_key` correspondiente) y lo manda como hoy a `POST /shipments/:id/funding`. El
   contrato de `svc-shipments` y `svc-payments` no cambia: ya recibe un `cardToken`.
2. **Lo que se persiste** de la tarjeta es solo `customer_id` + `card_id` de MP más los
   metadatos de display (marca, últimos 4, vencimiento y un nombre de referencia opcional que elige el usuario). **Nunca** el `card_token` (de un solo
   uso, vence a los 7 días) ni número ni CVV.
3. **Dueño de la entidad: `movo-svc-payments`**, no `svc-users` como decía MOVO-100. Es el
   único servicio que habla con MP (ADR-035) y quien alta/baja la tarjeta tiene que llamar a
   la API de Customers & Cards; ponerla en `svc-users` obligaría a `svc-users` a conocer a MP o
   a hacer un hop extra por cada operación.
4. **Ubicación de la tarjeta: la cuenta de Movo S.A. (opción A)**, un customer por emisor,
   creado con el token `TEST-`/producción de la app y no con el de ningún transportista. El
   `customer_id` y el `card_id` se guardan en `svc-payments`; el `payer` del hold es ese
   customer.
5. El **pago en efectivo del transportista** (MOVO-37/101) sigue siendo un caso aparte, con
   Movo como cobrador directo, sin split. Comparte con este ADR el modelo de datos de tarjeta
   guardada pero no la ubicación (esa sí es la cuenta de Movo por definición).

## Pasos para cerrar el ADR

1. Crear el hold con las credenciales de un **segundo Vendedor** (B) usando la misma tarjeta
   guardada en la cuenta de Movo (hoy solo se probó con A; el token de B se emite, falta el
   hold).
2. Repetir el recorrido en **producción** con una cuenta real y bajo monto: la `public_key`
   y el token de Movo son distintos fuera del sandbox, y la homologación del modelo
   Marketplace sigue pendiente (ADR-035).
3. Confirmar que `application_fee` se aplica al capturar (MOVO-212).
4. Con eso, pasar el ADR a "aceptado". Si falla en producción, la alternativa es la opción C.

## Consecuencias y trade-offs aceptados

- **Cumplimiento (PCI)**: no cambia. Número y CVV se capturan y tokenizan en el dispositivo
  contra MP; el backend nunca los ve. Se suma que se guardan identificadores de MP
  (`customer_id`, `card_id`), no datos de tarjeta.
- **El CVV sigue siendo obligatorio en cada pago**: sin él MP no crea el hold. El emisor no
  puede pagar "en segundo plano" y el hold de un retiro lejano sigue requiriendo que abra
  la app (MOVO-12, ADR-021).
- **Más superficie**: pantalla de alta/baja de tarjetas, endpoints y una entidad nueva, a
  cambio de un pago de un paso (elegir tarjeta + CVV).
- **Baja de tarjeta**: no se puede borrar una tarjeta con un hold vivo asociado a un envío del
  emisor. Si MP rechaza la baja o hay un hold vivo, la app muestra el motivo.
- **Tarjetas vencidas o dadas de baja del lado del emisor/banco**: la re-tokenización falla y
  el pago cae al formulario completo (misma pantalla de MOVO-269).
- **El sandbox no refleja del todo producción** en este tema (credenciales live de la app):
  parte de la validación queda para producción, igual que la homologación del modelo
  Marketplace (ADR-035).

## Referencias

- `docs/payments/adr-035-arquitectura-de-cobro.md` (punto 5 y alternativas)
- `docs/payments/mercadopago-spike/SOLUCION-FINAL.md` §7
- `docs/payments/flujo-de-pagos.md` §7
- Tickets: MOVO-65, MOVO-100, MOVO-101, MOVO-12, MOVO-269, MOVO-37, MOVO-49, MOVO-212
