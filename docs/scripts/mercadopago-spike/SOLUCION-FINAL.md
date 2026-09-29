# Solución final: hold + split con Mercado Pago en sandbox (MOVO-49)

**Estado: funcionando y verificado el 2026-09-29.** Un pago con retención de fondos
(`capture:false`) y comisión de Movo (`application_fee`) se crea, se captura y se cancela
en el sandbox de Mercado Pago, cobrando en nombre de un transportista conectado por OAuth.

Este documento es el punto de entrada. La historia de cómo se llegó hasta acá (errores
2006, 2034, 401 y el hilo con soporte) está en `INVESTIGATION-2034.md`.

---

## 1. La regla que lo destrabó

> En sandbox, **las tres partes de la operación tienen que ser cuentas de prueba de MP**:
> el dueño de la aplicación (quien cobra la comisión), el vendedor (transportista) y el
> pagador (emisor). Si cualquiera de las tres es real, o MP no la reconoce, el pago falla
> con `400 — 2034 "Invalid users involved"`.

Cómo se rompía la regla en cada intento anterior:

| Parte | Cómo estaba mal | Cómo tiene que estar |
| --- | --- | --- |
| Dueño de la app | App creada desde la cuenta **real** de developer (Tomás o JcBordino). El `application_fee` se acredita a la cuenta dueña de la app, que era real. | App creada **estando logueado como una cuenta de prueba de tipo Marketplace/Integrador**. |
| Pagador | `payer.email` inventado (`comprador.prueba@gmail.com`): MP no lo encuentra, crea un **comprador invitado (guest)** y lo trata como usuario real. | `payer.email` = **el email real de una cuenta de prueba de tipo Comprador**, copiado de su perfil en MP. |
| Vendedor | Estaba bien: cuenta de prueba de tipo Vendedor conectada por OAuth. | Igual, con `test_token: true` en el canje del code (token `TEST-`). |

Soporte de MP lo confirmó con logs de Payments sobre los intentos del 04/09 (payer
`3220101270` registrado como guest).

---

## 2. Cuentas y apps usadas (datos exactos)

Las contraseñas y los códigos de verificación de las cuentas de prueba **no se copian
acá** (el repo es público): se ven en el panel de MP → *Tus integraciones* → app
"generador de cuentas" → *Cuentas de prueba*.

### Cuentas de prueba

Las tres se crearon desde la misma app de la cuenta real de Tomás ("generador de cuentas",
`client_id 2511208387832416`). Una cuenta de prueba no puede crear otras cuentas de prueba
(el panel muestra *"No es posible crear cuentas de prueba desde este perfil"*), así que el
alta siempre se hace desde una cuenta real.

| Rol en Movo | Nombre en el panel | Tipo | User ID | Usuario | Email |
| --- | --- | --- | --- | --- | --- |
| Movo (dueño de la app, cobra la comisión) | Movo S.A | Marketplace | `3609549431` | `TESTUSER5057190937651221244` | — |
| Transportista (vendedor, cobra el envío) | Transportista - Tomas | Vendedor | `2991764998` | `TESTUSER7133831507754225491` | — |
| Emisor (paga) | Emisor - Alena | Comprador | `2991765000` | `TESTUSER4715592661702347785` | `test_user_4715592661702347785@testuser.com` |

Todas de país Argentina (MLA).

### Aplicación

| Campo | Valor |
| --- | --- |
| Nombre | movosend |
| `client_id` | `7550835762771398` |
| Creada por | Movo S.A (`3609549431`), en una ventana de incógnito logueada con esa cuenta de prueba en developers.mercadopago.com |
| Redirect URI | La URL pública del callback de OAuth. En el spike es un túnel `cloudflared` → `http://localhost:8787/callback`. Tiene que estar cargada en el panel de la app **y** coincidir exacta con `redirect_uri` en la URL de autorización y en el canje del code. |
| Credenciales usadas | `client_id` + `client_secret` (para el OAuth). La Public Key / Access Token de la app **no** intervienen en el pago. |

### Tarjeta de prueba

Visa `4509 9535 6623 3704`, CVV `123`, vencimiento `11/2030`, titular `APRO` (fuerza la
aprobación), DNI `12345678`.

---

## 3. El flujo, paso a paso (API REST, lo que se verificó)

Esta sección es el **flujo raw-fetch** de `mp-spike-cli.js` (llamadas HTTP directas con
`fetch`, opciones de menú `2 → 3 → 5 → 7 → 6` y `3 → 5 → 8 → 6`). El mismo flujo con el
SDK oficial también se verificó el 29/09; está en la sección 4.

Base URL: `https://api.mercadopago.com`.

### Paso 1: conectar al transportista (OAuth + PKCE)

Se abre en el navegador, con la sesión de la cuenta **Vendedor** iniciada:

```
https://auth.mercadopago.com/authorization
  ?client_id=7550835762771398
  &response_type=code
  &platform_id=mp
  &state=<random>
  &redirect_uri=<REDIRECT_URI>
  &code_challenge=<S256(code_verifier)>
  &code_challenge_method=S256
```

MP redirige a `<REDIRECT_URI>?code=TG-...&state=...`. Se verifica el `state` y se canjea
el code:

```http
POST /oauth/token
Content-Type: application/json

{
  "client_id": "7550835762771398",
  "client_secret": "<client_secret de la app>",
  "code": "TG-...",
  "grant_type": "authorization_code",
  "redirect_uri": "<REDIRECT_URI>",
  "code_verifier": "<code_verifier>",
  "test_token": true
}
```

Respuesta (200), campos que importan:

```json
{
  "access_token": "TEST-...",
  "refresh_token": "TG-...",
  "user_id": 2991764998,
  "public_key": "TEST-ad0076a2-6ecc-418e-86ec-7ace1b7723c7",
  "expires_in": 15552000
}
```

- `access_token` del **vendedor**: se usa para crear, capturar, cancelar y consultar el
  pago. El prefijo tiene que ser `TEST-`. Sin `test_token: true` puede no serlo.
- `public_key` del **vendedor**: se usa para tokenizar la tarjeta.
- En Movo esto se persiste por transportista (`svc-payments`). El token dura 180 días y
  se renueva con el `refresh_token`.

### Paso 2: tokenizar la tarjeta, con la Public Key del vendedor

```http
POST /v1/card_tokens?public_key=<public_key DEL VENDEDOR>
Content-Type: application/json
(sin header Authorization)

{
  "card_number": "4509953566233704",
  "security_code": "123",
  "expiration_month": 11,
  "expiration_year": 2030,
  "cardholder": { "name": "APRO", "identification": { "type": "DNI", "number": "12345678" } }
}
```

Devuelve `201` con `id` (el `card_token`), que es **de un solo uso**. Si se tokeniza con la
Public Key de la app o con otro Access Token, el pago falla con `2006 "Card Token not
found"`.

En producción este paso no lo hace el backend: lo hace el mobile (Checkout Bricks o
Secure Fields) con la `public_key` del transportista del envío. El backend nunca ve el
número de tarjeta.

### Paso 3: crear el pago con hold + split

```http
POST /v1/payments
Authorization: Bearer <access_token DEL VENDEDOR>
X-Idempotency-Key: <uuid>
Content-Type: application/json

{
  "transaction_amount": 1000,
  "capture": false,
  "installments": 1,
  "token": "<card_token>",
  "payment_method_id": "visa",
  "description": "[SPIKE MOVO-49] hold + split de prueba",
  "payer": { "email": "test_user_4715592661702347785@testuser.com" },
  "application_fee": 150
}
```

Respuesta `201`, pago `1352823085`:

```json
{
  "status": "authorized",
  "status_detail": "pending_capture",
  "captured": false,
  "collector_id": 2991764998,
  "payer": { "id": "3612507366" },
  "live_mode": false
}
```

### Paso 4a: capturar (cobrar)

```http
PUT /v1/payments/1352823085
Authorization: Bearer <access_token DEL VENDEDOR>

{ "capture": true }
```

Respuesta `200`: `status: "approved"`, `status_detail: "accredited"`. Si después se
consulta con `GET /v1/payments/1352823085`:

```json
"fee_details": [
  { "type": "mercadopago_fee", "amount": 41,  "fee_payer": "collector" },
  { "type": "application_fee", "amount": 150, "fee_payer": "collector" }
],
"transaction_details": { "total_paid_amount": 1000, "net_received_amount": 809 }
```

El emisor paga 1000. MP retiene su fee (41, 4,1%), Movo cobra 150 y al transportista le
quedan **809**.

### Paso 4b: cancelar el hold (liberar sin cobrar)

Probado con un segundo pago, `1352824879`, creado igual que en el paso 3:

```http
PUT /v1/payments/1352824879
Authorization: Bearer <access_token DEL VENDEDOR>

{ "status": "cancelled" }
```

Respuesta `200`: `status: "cancelled"`, `fee_details: []`, `net_received_amount: 0`.
Cancelar no cobra comisión a nadie.

---

## 4. Lo mismo con el SDK oficial (`mercadopago` v3 para Node)

El script tiene el flujo equivalente en las opciones `s2`, `s3`, `s5`–`s8` (funciones
`stepSdk*` de `mp-spike-cli.js`).

**Verificado el 2026-09-29** con las mismas cuentas, la misma app y el mismo pagador que
la sección 3 (`s2 → s3 → s5 → s7 → s6` y `s3 → s5 → s8 → s6`):

| Paso | Llamada del SDK | Resultado |
| --- | --- | --- |
| OAuth | `OAuth.create()` con `code_verifier` + `test_token` | vendedor `2991764998`, token `TEST-` |
| Tokenización | **no usa el SDK**, ver abajo | `201`, card_token |
| Hold + split | `Payment.create()` | pago `1352825041`, `authorized` / `pending_capture` |
| Captura | `Payment.capture()` | `approved` / `accredited`; `fee_details` = mercadopago_fee 41 + application_fee 150; `net_received_amount` 809 |
| Hold + split, cancelado | `Payment.create()` + `Payment.cancel()` | pago `1352825061`, `cancelled`, `fee_details: []`, neto 0 |

Mismo resultado exacto que con la API REST.

**Tokenización con el SDK: no funciona desde el servidor.** `CardToken.create()` siempre
manda `Authorization: Bearer <access_token>`. Con el access_token del vendedor, MP
responde `403 — G001 "unexpected_processing"`. MP no deja tokenizar desde el backend con
un access token. Por eso `s3` tokeniza con la `public_key` del vendedor y sin
Authorization (`POST /v1/card_tokens?public_key=...`), que es exactamente lo que hace el
mobile con Bricks. En producción esto no cambia nada: el backend nunca tokeniza.

```ts
import crypto from 'node:crypto';
import { MercadoPagoConfig, OAuth, Payment } from 'mercadopago';

const appConfig = new MercadoPagoConfig({ accessToken: APP_ACCESS_TOKEN });

// Paso 1a: URL de autorización (PKCE: los params extra viajan igual aunque el tipo no los declare)
const authUrl = new OAuth(appConfig).getAuthorizationURL({
  options: {
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  } as never,
});

// Paso 1b: canje del code (code_verifier y test_token tampoco están tipados, viajan igual)
const oauth = await new OAuth(appConfig).create({
  body: {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
    test_token: true, // solo sandbox
  } as never,
});
// guardar oauth.access_token, oauth.refresh_token, oauth.user_id y oauth.public_key del transportista

// Paso 2: card_token lo genera el mobile con la public_key del transportista (Bricks)

// Paso 3: hold + split, con el access_token DEL TRANSPORTISTA
const sellerPayments = new Payment(new MercadoPagoConfig({ accessToken: oauth.access_token! }));
const payment = await sellerPayments.create({
  body: {
    transaction_amount: 1000,
    capture: false,
    installments: 1,
    token: cardToken,
    payment_method_id: 'visa',
    description: 'Envío MOVO-XXX',
    payer: { email: payerEmail },
    application_fee: 150,
  },
  requestOptions: { idempotencyKey: crypto.randomUUID() },
});

// Paso 4a: capturar
await sellerPayments.capture({ id: payment.id! });
// Paso 4b: cancelar el hold
await sellerPayments.cancel({ id: payment.id! });
// Consultar
await sellerPayments.get({ id: payment.id! });
```

### ¿SDK o API REST para `movo-svc-payments`?

**Usar el SDK** para todo lo de pagos (`Payment.create/capture/cancel/get`, reembolsos).
Da el mismo resultado que la API REST, y a cambio trae los tipos, la idempotencia
(`requestOptions.idempotencyKey`) y el manejo de errores (`MercadoPagoError`). Es además
lo que MP mantiene y documenta.

Dos salvedades:
- **Canje del OAuth:** `code_verifier` y `test_token` no están en los tipos de
  `OAuth.create()`. Viajan igual (el SDK hace un `Object.assign` del body), pero en
  TypeScript estricto hay que castearlos. Conviene aislar ese canje, y el refresh, en una
  función chica: con el SDK + cast, o con un `fetch` propio a `POST /oauth/token`.
- **Tokenización:** no se hace en el backend (ver arriba). La hace el mobile con la
  `public_key` del transportista, que el backend le tiene que exponer para el envío.

---

## 5. Checklist para reproducirlo

1. Desde una **cuenta real** de MP developer, crear una app auxiliar y, en ella, tres
   cuentas de prueba (Argentina): Marketplace, Vendedor y Comprador.
2. En incógnito, iniciar sesión en developers.mercadopago.com **con la cuenta de prueba
   Marketplace** y crear ahí la app que se va a usar (tipo Checkout API / pagos online).
   Anotar `client_id` y `client_secret`.
3. Cargar la Redirect URI en esa app. En local: `cloudflared tunnel --url
   http://localhost:8787` y usar `https://<túnel>/callback`.
4. En `docs/scripts/mercadopago-spike/.env`: `MP_APP_CLIENT_ID`,
   `MP_APP_CLIENT_SECRET`, `MP_REDIRECT_URI` y **`MP_TEST_PAYER_EMAIL` = email real de la
   cuenta Comprador** (sacado de su perfil de MP, no inventado).
5. `node mp-spike-cli.js` → opción `2` (autorizar en incógnito logueado como
   **Vendedor**; verificar `access_token prefix = TEST-`) → `3` → `5` → `7` → `6`. Para
   probar la cancelación: `3` → `5` → `8`.

---

## 6. Detalles observados y lo que queda abierto

**Detalles observados:**
- Antes de capturar, `charges_details` solo lista `mercadopago_fee`. El `application_fee`
  recién aparece en `fee_details` después de la captura, así que no conviene validar el
  split sobre el pago en estado `authorized`.
- `marketplace_owner` vuelve `null` aunque el split se aplique. No sirve como señal.
- El pago queda con `payer.id 3612507366`, que no es el `2991765000` que muestra el panel
  para Emisor-Alena. No afectó el resultado. Probablemente MP resuelve el pagador por
  email a un ID interno distinto.
- `application_fee` solo es válido con el access_token del **vendedor**. Con el de la app,
  MP responde `2059`.
- **Los pagos no aparecen en la actividad de las cuentas de prueba** al iniciar sesión en
  mercadopago.com.ar (Transportista, Emisor-Alena ni Movo S.A). Causas probables, todavía
  sin confirmar por MP:
  - Emisor-Alena: el pago quedó a nombre de `payer.id 3612507366`, no de su cuenta
    (`2991765000`), así que no puede verlo.
  - Transportista y Movo S.A: los pagos se hicieron con token `TEST-` (`live_mode: false`),
    la capa de pruebas de integración, que no mueve dinero ni se ve en la web. La capa que
    se ve en la web es la de las credenciales `APP_USR-` de la cuenta de prueba; con ellas
    los pagos dan `live_mode: true` y las tarjetas de test fallan con 401.
  - Además, el pago capturado quedó con `money_release_status: "pending"`.

  **La evidencia de que el split funciona es la respuesta de la API** (`fee_details` y
  `net_received_amount`), no el panel. Se le preguntó a soporte (ver
  `SUPPORT-REPLY-2026-09-29.txt`).

**Abierto:**
- **Producción:** si la cuenta real dueña de la app tiene que homologar o habilitar el
  modelo Marketplace (pregunta 3 a soporte). El sandbox no lo responde.
- **Reembolso** de un pago capturado con split (opción `9`/`s9`): sin probar con esta
  configuración. Hay que ver cómo se revierte el `application_fee`.
- **Vencimiento del hold:** cuánto dura una autorización sin capturar antes de que MP la
  cancele sola. Condiciona dónde anclar el hold en el ciclo del envío (ADR-021,
  `assigned_unfunded`).

---

## 7. Tarjeta guardada (card-on-file) en el modelo marketplace: no validada

Probado el 2026-09-29 (opciones `c1`–`c3` de `mp-spike-cli.js`) para decidir si el hold se
puede crear más tarde sin el emisor presente (MOVO-12, opción B).

| Prueba | Resultado |
| --- | --- |
| `c1` Guardar la tarjeta como customer **del transportista** (`POST /v1/customers/{id}/cards` con su access_token y un card_token de su `public_key`) | `400 — 128 "payment method response is empty"`, con dos card_tokens distintos |
| `c1` Ídem, mandando `payment_method_id`/`issuer_id` en el body | `400 — 118 "the body must be a Json Object"`: MP no acepta campos extra |
| `c1` Customer con un email nuevo, no ligado a ningún usuario | `400 — 225 "Invalid test user email"`: en sandbox el customer tiene que ser un usuario de prueba |
| `c3` Guardar la tarjeta en la cuenta de **Movo** y cobrarla con el token del transportista | No se puede probar: las credenciales propias de la app son de una cuenta de prueba y MP las trata como live (`401 — 300 "Unauthorized use of live credentials"` al crear el customer) |

`c2` (crear el hold con la tarjeta guardada y sin CVV) no se llegó a ejecutar porque
ninguna variante de `c1` guardó la tarjeta.

**Conclusión:** no hay evidencia de que una tarjeta guardada sirva para cobrar un hold con
split en nombre de un transportista, y la variante cross-account ni siquiera se puede
probar en sandbox. **Decisión del equipo: el hold se crea siempre con el emisor presente**
(Card Payment Brick, tokenizando con la `public_key` del transportista del envío). Para
retiros lejanos, el emisor confirma el pago cuando se acerca la fecha en vez de un job que
cobra solo.

Dato de paso: el customer del comprador en la cuenta del vendedor tiene id
`3612507366-…`. Es el mismo `payer.id 3612507366` de los pagos de la sección 3, así que ese
es el usuario que MP asocia al email de Emisor-Alena.
