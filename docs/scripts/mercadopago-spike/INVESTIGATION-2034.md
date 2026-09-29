# Investigación en curso — opción 5 del spike (hold + split) devuelve error 2034

**RESUELTO el 2026-09-29**: la solución, con los datos exactos, está en `SOLUCION-FINAL.md`; acá, la sesión del 29/09 al final. Estado original al 2026-08-12: sin resolver. Este documento es un
registro cronológico de lo que se probó y lo que devolvió Mercado Pago, para que
quien retome esto no tenga que repetir los mismos pasos. No asume cuál es la causa
final — al cierre de la sesión quedaron descartadas algunas hipótesis y quedan otras
sin probar, listadas al final.

## Punto de partida

El usuario reportó que la opción del menú que crea el pago con `capture:false` +
`application_fee` (hold + split, AC1+AC3 de MOVO-49) fallaba, sin tener a mano el
output exacto del error. Cuentas de prueba usadas originalmente:

- Comprador: `Emisor-Alena` (`TESTUSER4715592661702347785`)
- Vendedor (rol "Vendedor" en el panel de MP): `Transportista - Tomas`
  (`TESTUSER7133831507754225491`)

## Cronología de errores encontrados, en orden

### 1. `MP_REDIRECT_URI` apuntaba a un túnel de `cloudflared` muerto

El `.env` tenía `MP_REDIRECT_URI` seteado a la URL de un túnel de `cloudflared` usado
en una sesión anterior (para probar la opción "2b", deep link), en vez del default
`http://localhost:8787/callback`. Ese túnel ya no existía, así que la opción 2
(conectar transportista por OAuth) nunca completaba: MP redirigía a una URL muerta y
el servidor local (escuchando en el puerto 8787 por default, ver
`waitForOAuthRedirect` en `mp-spike-cli.js`) nunca recibía el `code`.

**Se resolvió** levantando un túnel de `cloudflared` nuevo (`cloudflared tunnel --url
http://localhost:8787`) y actualizando `MP_REDIRECT_URI` en `.env` a esa URL nueva —
también hubo que registrarla en el panel de MP como Redirect URI adicional. **Este
túnel ya no está corriendo** (se mató al cerrar el proceso en esta sesión) — quien
retome esto necesita levantar uno nuevo y volver a actualizar `.env` +el panel de MP,
o volver a `http://localhost:8787/callback` si corre todo en la misma máquina donde
abre el navegador.

### 2. `Card Token not found` (código 2006)

Con el OAuth ya funcionando, la opción 5 fallaba con:

```json
{ "message": "Card Token not found", "error": "bad_request", "status": 400,
  "cause": [{ "code": 2006, "description": "Card Token not found" }] }
```

Causa confirmada: `stepTokenizeCard` (antes del fix) tokenizaba la tarjeta con
`Authorization: Bearer <MP_APP_ACCESS_TOKEN>` (el access token privado de la app). Un
card_token creado así queda ligado a esa cuenta — al crear el pago con el
`access_token` del transportista (obtenido por OAuth, cuenta distinta), MP no lo
reconoce.

**Se resolvió en dos pasos** (el primero no alcanzó, hizo falta el segundo):

1. Tokenizar con la Public Key de la propia app (`MP_APP_PUBLIC_KEY`, agregada a
   `.env`/`.env.example`) en vez del Access Token — esto solo. Con esto el error
   2006 **persistió igual**.
2. Tokenizar con la Public Key del **vendedor conectado** (`state.sellerPublicKey`,
   capturada del campo `public_key` que devuelve `POST /oauth/token` en el paso de
   OAuth — ver `stepConnectSellerAccount` en `mp-spike-cli.js`), no la de la app. Con
   este segundo cambio el error 2006 desapareció y pasó a aparecer el error descripto
   en el punto 3.

Cambios de código: `CONFIG.appPublicKey`, `state.sellerPublicKey`, y
`stepTokenizeCard` ahora usa `state.sellerPublicKey || CONFIG.appPublicKey` como
`public_key` en `POST /v1/card_tokens?public_key=...` (sin header `Authorization`).

### 3. `Invalid users involved` (código 2034) — sin resolver

Con el card_token ya reconocido, `POST /v1/payments` devuelve consistentemente:

```json
{ "message": "Invalid users involved", "error": "bad_request", "status": 400,
  "cause": [{ "code": 2034, "description": "Invalid users involved" }] }
```

La documentación oficial de MP (consultada vía el MCP de Mercado Pago, término
"invalid users involved") describe la causa 145/2034 así (texto literal de la
tabla de errores): *"Una de las partes con la que intentas hacer el pago es de
prueba y la otra es usuario real."*

Se probaron variaciones para acotar qué combinación dispara el error. **Todas
devolvieron el mismo error 2034**, sin cambios:

| Variación probada | Resultado |
| --- | --- |
| Vendedor conectado de rol **Vendedor** (`Transportista - Tomas`) + comprador real (`Emisor-Alena`) + con `application_fee` | 2034 |
| Vendedor conectado de rol **Integrador** ("Movo S.A", `TESTUSER5057190937651221244`, cuenta nueva creada durante esta sesión específicamente como tipo "Integrador"/marketplace) + comprador real + con `application_fee` | 2034 |
| Igual que arriba pero **sin** `application_fee` en el body (`DEBUG_NO_FEE=1`, ver abajo) | 2034 — descarta el split como causa |
| Igual que arriba pero con el `payer.email` reemplazado por un email inventado que no pertenece a ninguna cuenta de MP (`comprador_test@testuser.com`, no es la cuenta real del comprador) | 2034 — descarta que la causa sea específica de la cuenta "Emisor-Alena" |

Dato de contexto de la documentación de MP (mismo término de búsqueda): existen
**tres tipos de cuenta de prueba**, no dos — Vendedor, Comprador e Integrador. El
texto de MP describe "Vendedor" explícitamente como *"cuenta requerida para
configurar la aplicación y las credenciales. Esta es tu cuenta de usuario"* (o sea,
la del developer/dueño de la app), y a "Integrador" como *"cuenta que se usa en
integraciones del modelo marketplace"*. Cambiar de una cuenta Vendedor a una cuenta
Integrador para el rol de transportista fue el cambio de la fila 2 de la tabla de
arriba — **no cambió el resultado** (sigue en 2034 con ambos tipos de cuenta
probados).

## Cambios de código que quedaron en el repo (no revertidos)

En `mp-spike-cli.js`, dentro de `stepCreateHoldPaymentWithSplit`, se agregaron dos
flags de diagnóstico controladas por variables de entorno (no tocan el comportamiento
default si no se setean):

- `DEBUG_NO_FEE=1`: arma el body del pago **sin** `application_fee`, para poder
  probar si el error depende del split.
- `DEBUG_CAPTURE_TRUE=1`: arma el body con `capture:true` (cobro inmediato) en vez de
  `capture:false` (hold), para poder probar si el error depende específicamente del
  hold. **Esta variante se dejó preparada pero no se llegó a ejecutar** — el usuario
  cortó la sesión antes de correr ese último test (ver "Qué falta probar" abajo).

Correr con ambos flags a la vez, por ejemplo:

```bash
DEBUG_NO_FEE=1 DEBUG_CAPTURE_TRUE=1 node mp-spike-cli.js
```

## Estado de `.env` al cierre de la sesión

- `MP_APP_PUBLIC_KEY` agregada (Public Key de prueba de la app — no es la que
  finalmente resuelve el split, ver punto 2, pero quedó documentada en
  `.env.example` porque sigue haciendo falta como fallback en `stepTokenizeCard`
  cuando no hay transportista conectado).
- `MP_TEST_PAYER_EMAIL` quedó apuntando al email real de la cuenta Comprador
  (`Emisor-Alena`) — no al placeholder original del `.env.example`.
- `MP_REDIRECT_URI` quedó apuntando a un túnel de `cloudflared` que ya no está
  corriendo (ver punto 1) — hay que regenerarlo antes de poder correr la opción 2 de
  nuevo.

## Hipótesis del usuario, sin verificar

El usuario (Tomás) planteó que el problema puede ser específico de su cuenta de
integración/marketplace en el panel de MP, y no algo reproducible con cualquier app.
Plan propuesto por él: pedirle a un colega del equipo que cree una aplicación nueva
en su propia cuenta de MP developer, con sus propios usuarios de prueba (Comprador +
Integrador), y repetir el mismo flujo (opciones 1 → 2 → 3 → 5) para ver si el error
2034 se reproduce igual con credenciales completamente distintas. Si **no** se
reproduce, la causa estaría acotada a algo de la cuenta/app actual (configuración del
modelo marketplace, estado de la cuenta Integrador, país, o algo no visible desde la
API). Si **se reproduce igual**, la causa sería más genérica (algo del propio flujo
del script, o una restricción real del sandbox de MP para esta combinación).

## Sesión 2026-08-13 — reproducido con app/cuentas de un colega, hipótesis descartada

Un colega (JcBordino) creó una aplicación nueva en su propia cuenta de MP developer,
con sus propias cuentas de prueba: **Movo** (`TESTUSER7570690210904606444`, tipo
Marketplace/Integrador — dueña de la app nueva), **Juan Cruz**
(`TESTUSER8103888998476299519`, tipo Vendedor — el transportista de prueba) y **Alena**
(`TESTUSER3382552883872208541`, tipo Comprador — la pagadora). Se repitió el flujo
completo (1 → 2 → 3 → 5) contra esta app nueva.

**Resultado: el error 2034 se reproduce idéntico con credenciales completamente
distintas.** Esto descarta la hipótesis del punto 2 de "qué falta probar" (arriba) y la
hipótesis del usuario de la sección anterior — la causa **no** es específica de la
cuenta/app original de Tomás. Es más genérica: algo del propio flujo, o una
restricción real del sandbox de MP para esta combinación de tipos de cuenta.

**Bug encontrado de paso en el script, con impacto directo sobre el punto 1 de "qué
falta probar"**: `stepCreateHoldPaymentWithSplit` (línea ~847) armaba el body con
`capture: !env.DEBUG_CAPTURE_TRUE` — lógica invertida. Sin ningún flag de debug seteado
(el caso "normal", el que se corrió en todas las filas de la tabla de variaciones de la
sección anterior), `env.DEBUG_CAPTURE_TRUE` es `undefined`, así que `!undefined`
evaluaba `true` — **el body mandaba `capture: true` (cobro inmediato) todas las veces
que se pensó que se estaba probando el hold (`capture: false`)**. El punto 1 de "qué
falta probar" ("`DEBUG_CAPTURE_TRUE=1` solo, para ver si el 2034 es específico de
`capture:false`") en realidad ya se había estado ejecutando sin querer en cada intento
previo — nunca se había probado el hold real hasta ahora.

Corregido a `capture: Boolean(env.DEBUG_CAPTURE_TRUE)` (default `false`/hold; `true`
solo si se setea el flag explícito). Con el fix aplicado se volvió a correr el flujo
completo contra la app del colega, confirmando en el body del request saliente
`"capture": false` real — **el error 2034 persiste igual**. Esto también resuelve (para
esta combinación de cuentas) el punto 1 de la lista original: el 2034 no es específico
de `capture:false`, pasa con ambos valores.

**Bug adicional encontrado y corregido en `waitForOAuthRedirect` (no relacionado al
2034, pero bloqueaba poder correr la opción 2 en absoluto)**: el servidor HTTP efímero
cerraba con la **primera** request que le llegaba a `redirect_uri`, sin filtrar. Un
`favicon.ico`/preconnect del navegador, o una request con `code` pero `state` viejo
(pestaña/URL reutilizada), mataban el listener antes de que llegara el callback real de
MP — en un caso concreto de esta sesión, Cloudflare devolvió **502 Bad Gateway** porque
el code correcto llegó un segundo después de que el server ya se había cerrado con una
request espuria. Corregido: ahora solo cierra el server ante una request cuyo `code` Y
`state` coincidan exactamente con lo esperado; cualquier otra cosa se responde sin
cerrar, y se sigue esperando.

## Sesión 2026-08-13 (continuación) — reproducido también con el SDK oficial de Node

Hipótesis del usuario (Tomás): el error puede depender de **cómo este script arma los
requests a mano** (headers, forma exacta del body, orden de los campos, el
`X-Idempotency-Key`, etc.) y no de la cuenta o el flujo en sí — la comparación que
importa de verdad es contra el **SDK oficial de Mercado Pago para Node**
(paquete `mercadopago` de npm), que es lo que efectivamente va a usar
`movo-svc-payments` en producción, no `fetch` directo.

Se agregó `mercadopago` (v3.4.0) como dependencia real del script (tiene su propio
`package.json` en esta carpeta — no es parte de los workspaces del monorepo) y se
reimplementó el flujo completo (OAuth Connect, tokenización, creación del pago,
consulta/captura/cancelación/reembolso) con las clases del SDK
(`OAuth`, `CardToken`, `Payment`, `PaymentRefund`, `PaymentMethod`) en las opciones de
menú nuevas `s1`-`s9`, en paralelo a las opciones `1`-`9` originales (que se dejaron
intactas, siguen pegándole a la API directo). Detalle en el comentario de cabecera de
la sección "12b" de `mp-spike-cli.js`.

**Hallazgo de diseño real al portar el código (no un detalle menor)**: `CardToken.create()`
del SDK **siempre** manda `Authorization: Bearer <access_token>` — a diferencia del
flujo raw-fetch de este script, el SDK no tiene forma de tokenizar con `public_key` y
sin header de autenticación (el modo "cliente", pensado para front-end/Bricks). Para
no reproducir el problema original de la investigación (error 2006, "Card Token not
found", por tokenizar con una cuenta y cobrar con otra), el flujo `s3` tokeniza
directamente con el **access_token del vendedor conectado** (obtenido en `s2`) — una
variante de tokenización que tampoco se había probado hasta ahora (la investigación
original solo probó public_key de la app y public_key del vendedor, nunca access_token
del vendedor).

**Resultado: corriendo el flujo completo (s1 → s2 → s3 → s5) contra la misma app del
colega (ver sesión anterior) el error 2034 se reproduce IDÉNTICO vía SDK**:

```json
{
  "message": "Invalid users involved",
  "status": 400,
  "error": "bad_request",
  "causes": [
    { "code": 2034, "description": "Invalid users involved", "data": "13-08-2026T20:21:16UTC;..." }
  ]
}
```

Esto descarta la hipótesis de esta sub-sesión: **no es un problema de cómo se arma el
request** (raw fetch vs. SDK oficial), ni de la variante de tokenización usada. Van
**tres** hipótesis de "problema de implementación/cuenta" descartadas en el mismo día
(cuenta específica, capture:true vs false, raw-fetch vs SDK oficial) con el mismo
resultado exacto en los cuatro intentos. Esto deja al **punto 5 de "qué falta probar"**
(contactar a soporte de MP developers) como la vía más señalada — la evidencia
acumulada apunta a una restricción real del sandbox de MP para esta combinación de
tipos de cuenta (Marketplace + Vendedor + Comprador con `application_fee`), no a un bug
de nuestro lado.

## Sesión 2026-08-13 (continuación 2) — Orders API: el hold funciona, el split queda sin probar

Cuarta hipótesis del día (usuario): la Orders API (`POST /v1/orders`) es la API "nueva"
de MP, pensada para reemplazar Checkout API/Payments API a mediano plazo — capaz el
2034 es específico de Payments API y Orders API no lo tiene.

**Hallazgo no anticipado que cambió el plan sobre la marcha**: al activar la Orders API
en el panel de la app, MP generó un **par de credenciales nuevo y separado**
(`MP_ORDERS_APP_ACCESS_TOKEN`/`MP_ORDERS_APP_PUBLIC_KEY`, prefijo `APP_USR-` — sigue
siendo de prueba, el modo test/real lo determina la cuenta, no el prefijo del token) —
y ese access_token **ya representa directamente al Vendedor** (`user_id: 3612155467`,
Juan Cruz) sin pasar por OAuth Connect. Se implementaron las opciones `o0`-`o6` en
`mp-spike-cli.js` (mismo patrón que `s1`-`s9`) usando estas credenciales directo,
`capture_mode: "manual"` (equivalente a `capture:false`) y `marketplace_fee`
(equivalente a `application_fee`).

**Primer intento — `422 unprocessable_content`, sin detalle de campo**: el shape de
error de Orders API no es el mismo que usa `MercadoPagoError` del SDK
(`body.message`/`body.error`/`body.cause`) — es `{ errors: [{ code, message }] }`, así
que el SDK imprimía un error vacío/genérico. Se agregó un fallback de diagnóstico en
`stepOrdersCreate` que reintenta la misma llamada con `fetch` crudo para ver el body
real ante cualquier error (útil más allá de esta sesión). El body real:
`{"errors":[{"code":"unprocessable_content","message":"Unprocessable Entity"}]}` —
tampoco decía qué campo, así que se agregaron flags `DEBUG_ORDERS_NO_CAPTURE_MODE`/
`DEBUG_ORDERS_NO_FEE` (mismo patrón que `DEBUG_NO_FEE`/`DEBUG_CAPTURE_TRUE`) para
aislar por descarte.

**Con las credenciales de Orders API, el 422 no volvió a aparecer.** El flujo completo
`o0 → o1 → o4 → o3` (tokenizar, crear con `capture_mode:"manual"` + `marketplace_fee`,
capturar, consultar) anduvo de punta a punta sin errores:
- `o1`: `id: "ORDTST01KZYDS2E9SXC7DN83XRQW7MAP"`, `status: "action_required"` /
  `status_detail: "waiting_capture"` — el hold, funcionando.
- `o4`: `status: "processed"` / `status_detail: "accredited"` — capturado.

**Pero el split no quedó confirmado**: en NINGUNA de las respuestas (creación, get,
después de capturar) apareció la clave `marketplace_fee` — ni con el valor que mandamos
ni ningún otro. La Orders API aceptó el campo en el request sin rechazarlo, pero no hay
evidencia de que se haya aplicado. Hipótesis más probable: esta app nueva (generada
automáticamente al activar Orders API, `application_id: 7612362992462975`, distinta de
la app Marketplace original `8234694293391791`) no está configurada como marketplace de
verdad — el `access_token` representa directamente al Vendedor cobrando para sí mismo,
no a un integrador cobrando una comisión de un tercero. El tipo `CreateOrderRequest`
del SDK también expone `integration_data.sponsor.id` ("MercadoPago user ID of the
sponsoring marketplace owner") — sin probar todavía — que podría ser el mecanismo
correcto para expresar el split en Orders API (reemplazando el modelo
`application_fee` + OAuth Connect de Payments API), pero no se confirmó.

**Conclusión de esta sub-sesión**: Orders API **sí resuelve el error 2034 tal como se
manifestaba** (probablemente porque, con estas credenciales, no hay dos cuentas de tipo
distinto involucradas en la misma operación — exactamente la condición que dispara
"Invalid users involved"), pero **no es una comparación equivalente todavía**: nunca se
llegó a ejercitar un split real entre dos cuentas distintas vía Orders API, que es lo
que de verdad hace falta para MOVO-49 AC3. Antes de decidir migrar a Orders API hace
falta: (a) confirmar cómo se expresa el split ahí (`sponsor.id`? habilitar el
`marketplace` de forma explícita? otra credencial?), y (b) volver a intentarlo con dos
cuentas de tipos distintos en juego — si el 2034 (o su equivalente) reaparece al meter
una segunda cuenta real en la ecuación, confirmaría que la causa de fondo era esa
combinación de cuentas y no la API en sí, sin importar cuál se use.

Estado de las cuentas de esta sesión, para quien retome: **quedaron conectadas y
utilizables** (Vendedor Juan Cruz conectado por OAuth, card_token de un solo uso ya
consumido — hay que tokenizar de nuevo con la opción 3 antes de un próximo intento de
pago). Túnel de `cloudflared` de esta sesión también quedó activo al cierre, pero no
hay garantía de que siga vivo para cuando se retome esto (quick tunnels sin cuenta no
tienen garantía de uptime) — regenerar con la opción 2 si hace falta.

## Sesión 2026-08-13 (continuación 3) — App creada DESDE la cuenta Integrador: `live_mode:true`, otro bloqueo distinto

Quinta hipótesis del día (usuario, volviendo a Payments API): en todos los intentos
anteriores, la app usada para el OAuth Connect (`client_id 8234694293391791`, la del
colega) la había creado JcBordino desde **su cuenta real** de developer — con
Vendedor/Comprador/Integrador como test users sueltos, sin relación real con la
identidad de la app en sí. Para que `application_fee` le llegue de verdad a la cuenta
Integrador (y no a quien sea el dueño real de esa app), la app tendría que estar creada
**desde el panel de la propia cuenta Integrador** — los test users pueden loguearse en
developers.mercadopago.com igual que una cuenta real y crear ahí su propia aplicación.

Se hizo exactamente eso: loguearse como la cuenta Integrador ("Movo S.A",
`TESTUSER5057190937651221244`, `user_id: 3609549431` — creada por Tomás desde su app
"generador de cuentas" `2511208387832416`, no la "Movo" de JcBordino; corregido el
2026-09-29) y crear una app nueva desde ahí
(`client_id 7550835762771398`). Se actualizó `.env` con estas credenciales y se repitió
el flujo (`2` → `3` → `5`, Payments API raw-fetch) conectando a Juan Cruz por OAuth
contra esta app nueva.

**Resultado: ni siquiera se llegó al 2034.** El OAuth conectó bien, pero la respuesta de
`POST /oauth/token` trae `"live_mode": true` — algo que nunca había aparecido en los
intentos anteriores (siempre `false`, como corresponde a credenciales `TEST-`). La
tarjeta se tokenizó sin problema (con la `public_key` del vendedor recién conectado),
pero `POST /v1/payments` devolvió:

```json
{
  "message": "Unauthorized use of live credentials",
  "error": "unauthorized",
  "status": 401,
  "cause": [{ "code": 7, "description": "Unauthorized use of live credentials" }]
}
```

**Interpretación**: una app creada desde el panel propio de una cuenta de prueba no
genera un par de credenciales `TEST-`/`APP_USR-` como una cuenta real (con su propia
sandbox anidada) — genera credenciales `APP_USR-` que MP trata como **live** para esa
cuenta, sin distinción de modo test/producción. Las tarjetas de prueba "universales" de
MP (como la Visa `4509 9535 6623 3704` que usa este script) están bloqueadas
explícitamente para operaciones en `live_mode` — de ahí el 401. No es un problema de
qué cuenta recibe el `application_fee`; es que **este camino específico (app propia de
una cuenta de prueba) no es utilizable en sandbox con tarjetas de test, punto** — no
hace falta seguir iterando sobre él.

**Con esto, van cuatro configuraciones distintas probadas hoy para el mismo objetivo
(hold + split vía `application_fee`/`marketplace_fee`), cada una bloqueada por un motivo
diferente**:

| Configuración | Resultado |
| --- | --- |
| App Marketplace de una cuenta real (colega), Vendedor conectado por OAuth, `application_fee` | 2034 "Invalid users involved" |
| Ídem, vía SDK oficial en vez de fetch crudo | 2034, idéntico |
| Ídem, vía Orders API (`marketplace_fee`, sin OAuth — access_token del vendedor directo) | Sin error, pero `marketplace_fee` no es un campo real del schema de `type:"online"` — nunca se probó el split de verdad |
| App creada desde el panel de la cuenta Integrador, Vendedor conectado por OAuth, `application_fee` | 401 "Unauthorized use of live credentials" (`live_mode:true`, incompatible con tarjetas de test) |

No queda ninguna variante de configuración razonable sin probar dentro de lo que se
puede resolver por prueba y error desde acá — la próxima acción con más sentido es
contactar a soporte de developers de Mercado Pago con las cuatro tablas de evidencia
(esta y las de las sesiones anteriores), en vez de seguir iterando combinaciones de
cuentas/apps a ciegas.

## Qué falta probar

1. ~~`DEBUG_CAPTURE_TRUE=1` solo (cobro inmediato, sin hold) — para ver si el 2034 es
   específico de `capture:false`, o pasa con cualquier pago a esta cuenta conectada.~~
   **Resuelto** (sesión 2026-08-13, ver arriba): pasa con ambos valores de `capture`.
2. ~~Repetir el flujo completo con una app/credenciales de otro developer.~~
   **Resuelto** (sesión 2026-08-13, ver arriba): se reproduce igual, hipótesis de cuenta
   específica descartada.
3. No se probó pasar `payer.id` (id numérico de un usuario de MP) en vez de
   `payer.email` — el script actual solo arma `payer: { email }`. No se investigó si
   existe una forma de obtener el `user_id` numérico de la cuenta Comprador de prueba
   para probar esa variante.
4. No se confirmó si las cuentas de prueba Comprador e Integrador usadas están
   registradas bajo el mismo país (la documentación de MP exige que Comprador y
   Vendedor sean del mismo país al crearlas — no queda claro en la doc si esa misma
   regla aplica a Integrador, ni se verificó el país configurado de cada cuenta usada
   en esta sesión, tampoco en la de 2026-08-13).
5. No se contactó al soporte de developers de Mercado Pago con el caso reproducible
   (tenemos el JSON completo del request/response para pegar tal cual) — con dos
   hipótesis de cuenta específica ya descartadas (esta sesión), este es ahora el
   siguiente paso más señalado.

## Sesión 2026-08-14 → 2026-08-20 — hilo con soporte de Mercado Pago

Se reprodujo el 2034 una vez más con una app propia de Tomás (`client_id
2511208387832416`, creada desde su cuenta real de developer — confirmado por él —,
`certification_status: "not_certified"`), vendedor de prueba conectado por OAuth (`user_id 2991764998`,
`test_token: true` → access_token `TEST-`, respuesta sin `live_mode`) y pagador
`test_user_4715592661702347785@testuser.com`. Traza completa en `run.log`; correlation
id del intento: `14-08-2026T12:18:35UTC;552c1e69-b6d4-40ef-9dec-6a6906d987ef`.
Corrección enviada a soporte: los tres correlation ids del ticket original
(`SUPPORT-TICKET-2034.txt`) son de la app del colega (`8234694293391791`), no de esta.

Estado del hilo:

- Les planteamos que el `application_fee` de Payments API no tiene destinatario
  configurable — lo cobra la cuenta dueña de la app — así que si esa app debe vivir en
  una cuenta real (como nos confirmaron), la operación siempre mezcla una cuenta real
  con vendedor y pagador de prueba: exactamente la condición que su tabla de errores
  describe para 145/2034. También les dijimos que no existe forma de pedir el "modelo
  Marketplace explícito" que mencionaron (no está en el wizard, ni en la config de la
  app, ni por API — `POST /applications` y `PUT /applications/{id}` responden 403 —, ni
  como parámetro de `create_application` en su propio MCP).
- **Respuesta de soporte (2026-08-20): confirman el análisis** — el `application_fee`
  se acredita siempre a la cuenta dueña de la aplicación, no es configurable, y si esa
  cuenta debe ser real entonces efectivamente hay una combinación real + prueba en la
  misma operación. **Escalaron el caso al equipo de producto de Marketplace/OAuth** y
  pidieron el request completo.
- Redactado en `SUPPORT-REPLY-REQUEST-COMPLETO.txt` (pendiente de enviar): los tres
  requests de la secuencia (OAuth → card_token → payment) con headers y bodies tal
  cual, secretos redactados, más la tabla de variantes ya descartadas y las dos
  preguntas abiertas — (a) qué combinación de cuentas soporta el sandbox para
  `application_fee`, y (b) la distinción "pagador" vs "comprador" que usaron en su
  mensaje anterior y no nos quedó clara (en nuestro request el único dato del lado que
  paga es `payer.email` + el `card_token`).

Mientras tanto la conclusión operativa no cambió: **el split con `application_fee` no
está confirmado en sandbox**, y si el equipo de producto responde que no es probable
ahí, se documenta como limitación conocida (con el hold/`capture:false` sí verificado)
en vez de seguir iterando combinaciones de cuentas.

## Sesión 2026-08-21 → 2026-09-03 — seguimiento del hilo, escalado a producto de Marketplace/OAuth

Se envió `SUPPORT-REPLY-REQUEST-COMPLETO.txt` (21/08): traza completa de los 3 pasos
(OAuth → card_token → payment) con secretos redactados, más las dos preguntas abiertas.
Soporte confirmó que el flujo está bien armado en todos los pasos.

Cronología del hilo:

- **21/08 (Sofía, 12:58)**: confirma que el flujo es correcto, reitera que el caso
  sigue elevado al equipo de producto de Marketplace/OAuth para que digan si existe
  combinación soportada en sandbox para `capture:false` + `application_fee`.
- **26/08 (Tomi)**: pide novedades. **27/08 (Sofía, 14:44)**: sigue escalado desde el
  21/08, sin confirmación formal todavía; pide no repetir pruebas, "ya tenemos todo lo
  necesario de tu lado".
- **29/08 (Tomi)**: aviso automático de MP pidiendo responder para no cerrar el
  ticket. **31/08 (Sofía)**: confirman que fue un mensaje automático, piden disculpas,
  el ticket sigue activo.
- **01/09 (Sofía, 15:14)**: primer avance real — **el 2034 no es exclusivo de esta
  integración**, lo están viendo en varias integraciones marketplace en sandbox con
  vendedor conectado por OAuth. Ya descartaron como causa: `application_fee` (aparece
  igual sin mandarlo), `capture` (pasa con `true` y `false`), el endpoint (falla en
  `POST /v1/payments` y en Orders API), y cuenta/app puntual (se reprodujo con
  distintas apps y cuentas, Vendedor e Integrador). Suman también la observación de que
  Orders API sí permite hold+captura pero no admite comisión para `type: "online"`.
- **01/09 (Sofía, 15:30)**: mensaje siguiente, más genérico/templado — pide re-validar
  los mismos tres puntos que ya habían confirmado el 21/08 (comprador distinto del
  vendedor, `access_token` del vendedor, no mezclar `capture:false` con
  `application_fee` sin el modelo habilitado) y vuelve a pedir el request completo y
  los emails de prueba, como si no hubiera leído el hilo previo. **Se interpretó como
  una respuesta templada** (probablemente otro agente de soporte retomando el
  ticket sin historial completo), no como un pedido genuino de repetir el
  troubleshooting desde cero.
- **Respuesta enviada (03/09)**: en vez de discutir si hace falta re-validar, se le
  reenvió el request completo (ya lo tenían, pero se resumió de nuevo para no
  depender de que busquen el mensaje del 21/08) más los emails de prueba — ningún
  dato sensible nuevo (`client_secret`, número de tarjeta y CVV siguen redactados; el
  `access_token` completo se sigue ofreciendo por canal aparte si hace falta, es de
  prueba). Se sumó una pregunta nueva, no hecha antes: **cómo se confirma que la
  cuenta real dueña de la aplicación está habilitada para el modelo Marketplace**,
  dado que la app tiene `certification_status: "not_certified"` — si existe algún paso
  de homologación/activación pendiente de nuestro lado o del de MP más allá de lo ya
  probado. Texto completo en `SUPPORT-REPLY-2026-09-03.txt`.

**Estado al 2026-09-03**: caso sigue escalado con el equipo de producto de
Marketplace/OAuth. Soporte ya reconoce el 2034 como un problema más amplio del
ambiente de sandbox para marketplace (no específico de esta integración), lo cual
respalda la hipótesis original (aplicación en cuenta real + vendedor/pagador de
prueba). Sin confirmación formal todavía sobre las tres preguntas abiertas: (a) qué
combinación de cuentas soporta `application_fee` en sandbox, (b) distinción
pagador/comprador, (c) habilitación de Marketplace en la cuenta real. La conclusión
operativa no cambió: el split vía `application_fee` sigue sin confirmarse en sandbox;
si de acá no sale nada, se documenta como limitación conocida del ambiente de pruebas
(con el hold/`capture:false` sí verificado sin split) en vez de seguir iterando.

**Para la próxima vez que haya que responder en este hilo**: no hace falta repetir la
traza ni re-probar nada de este lado salvo que soporte pida explícitamente una prueba
nueva y puntual — el diagnóstico ya está confirmado dos veces por ellos mismos. Si
llega otra respuesta genérica/templada, señalar el historial ya confirmado (21/08,
01/09 15:14) en vez de re-litigar la configuración básica.

## Sesión 2026-09-04 — nueva respuesta de soporte (dos causas puntuales), repetición de la prueba, ambas descartadas

Soporte respondió con una línea de troubleshooting distinta a la de Sofía (01/09):
propusieron dos causas de configuración de cuenta puntuales a descartar antes de seguir
—no parece tener en cuenta lo ya confirmado el 01/09 (que el 2034 es un problema más
amplio del sandbox, no de cuenta/app puntual)—:

1. `payer.email` con dominio `@testuser.com` podría disparar el 2034 por sí solo.
2. La app usada para el OAuth Connect debe estar creada por (ser propiedad de) una de
   las cuentas de prueba del escenario (Integrator/Marketplace, Vendedor o Comprador),
   no por una cuenta real de developer — señalada como "la causa raíz más frecuente".

Sobre el punto 2: repasando el `.env` de este spike, ya había un intento anterior
(13/08) que había llegado a la misma conclusión por su cuenta y había creado la app
`7550835762771398` desde la cuenta de prueba Integrador (`user_id 3609549431`) — pero
ese intento quedó a medio terminar: `MP_APP_CLIENT_ID`/`MP_APP_CLIENT_SECRET` en el
`.env` habían quedado desalineados (eran los de la app personal de Tomás,
`2511208387832416`, no los de `7550835762771398`), así que ninguna prueba con esa app
se había llegado a correr realmente con las credenciales correctas juntas. Se corrigió
el `.env` (los 4 valores de la app ahora son consistentes) y se relevantó un túnel
cloudflared nuevo para el redirect URI.

**Corrección para soporte**: el User ID `3612155467` que mencionaron como posible
cuenta Marketplace no es esa cuenta — es el Vendedor de la prueba de Orders API (ver
comentario del `.env`, integración separada). La cuenta Integrador real es `3609549431`.

Con la app y el email corregidos, se repitió el flujo completo (OAuth Connect con
`test_token:true` → tokenizar tarjeta con la Public Key de esa app → `POST
/v1/payments` con `capture:false` + `application_fee`):

- **Prueba 1** (capture:false + application_fee, igual que siempre): **HTTP 400,
  2034** de nuevo. Correlation id `04-09-2026T19:00:19UTC;502e1425-adde-4897-9c72-
  689792fd1b11`.
- **Prueba 2** (mismo pago pero SIN `capture:false` — captura inmediata, para aislar si
  el 2034 depende de la combinación con el hold): **HTTP 400, 2034 otra vez, mismo
  error exacto**. Correlation id `04-09-2026T19:02:12UTC;abd12a9c-8262-442f-80fe-
  639a3b24894e`.

**Conclusión**: las dos causas propuestas en este mensaje quedan descartadas — ni el
owner de la app ni el dominio del email eran el problema, y la Prueba 2 muestra que ni
siquiera hace falta `capture:false` para que aparezca el 2034: alcanza con
`application_fee` solo. Esto es consistente con lo que Sofía ya había confirmado el
01/09 (problema más amplio del ambiente de sandbox, no de cuenta/app/capture puntual) —
la respuesta de este mensaje parece no haber tenido en cuenta ese hallazgo previo.

Respuesta enviada a soporte con ambas pruebas y la corrección del User ID:
`SUPPORT-REPLY-2026-09-04.txt`.

**Estado al 2026-09-04**: sin causa de configuración de cuenta que quede por probar de
este lado. Si soporte no aporta una causa nueva y distinta a partir de esta respuesta,
se cierra la investigación y se documenta `application_fee` (con o sin hold) como
**limitación conocida no soportada en el sandbox de MP** para este TFG — no seguir
iterando combinaciones de cuentas.

## Sesión 2026-09-29 — RESUELTO: con las tres partes de prueba, hold + split funciona

Soporte (con logs de Payments sobre los dos intentos del 04/09) identificó la causa: el
`payer.email` inventado de esa prueba (`comprador.prueba@gmail.com`, puesto para seguir su
consejo de no usar `@testuser.com`) hizo que MP registrara al pagador como **comprador
invitado (guest)**, es decir, como usuario real. App (`7550835762771398`, dueña Integrador
de prueba `3609549431`) y vendedor (`2991764998`) sí eran de prueba, pero había una parte
real en la operación, que es la condición del 2034.

Revisando el historial con esa regla, **ningún intento anterior tuvo las tres partes de
prueba a la vez**: hasta el 14/08 el dueño de la app era una cuenta real (Tomás o
JcBordino), y el 04/09 el pagador era un guest. Las tres cuentas de prueba (Movo S.A,
Transportista - Tomas, Emisor - Alena) las creó Tomás desde la misma app "generador de
cuentas" `2511208387832416`, así que no hay diferencia de cuenta padre entre ellas.

Prueba repetida (flujo raw-fetch `2 → 3 → 5 → 7 → 6`), con app `7550835762771398`, OAuth del
vendedor `2991764998` con `test_token:true` (token `TEST-`) y `payer.email` = email real de
la cuenta Comprador Emisor-Alena (`test_user_4715592661702347785@testuser.com`, confirmado
desde su perfil en MP):

- **Hold + split** (`capture:false` + `application_fee: 150`, `transaction_amount: 1000`):
  HTTP 201, pago `1352823085`, `authorized` / `pending_capture`.
- **Captura**: `approved` / `accredited`. `fee_details` =
  `[mercadopago_fee 41, application_fee 150]`, ambos `fee_payer: collector`;
  `net_received_amount: 809` (1000 − 41 − 150). **El split quedó aplicado.**
- **Cancelación de un hold con split** (pago `1352824879`): `cancelled`, `fee_details: []`,
  `net_received_amount: 0`, así que cancelar el hold no cobra comisión.

Detalles observados:
- Antes de capturar, `charges_details` solo lista `mercadopago_fee`; el `application_fee`
  recién aparece en `fee_details` después de la captura.
- `marketplace_owner` vuelve `null` aunque el split se aplique. No sirve como señal.
- El pagador del pago es `payer.id 3612507366`, no el `user_id 2991765000` que muestra el
  panel para Emisor-Alena. No afecta el resultado; queda anotado.

**Conclusión**: el 2034 venía de la configuración de cuentas de nuestras pruebas, no de
una limitación del sandbox. `capture:false` + `application_fee` vía Payments API +
OAuth Connect funciona en sandbox **siempre que app, vendedor y pagador sean cuentas de
prueba** (la app, creada desde una cuenta de prueba Integrador; el `payer.email`, el email
real de una cuenta de prueba Comprador). Queda pendiente la pregunta 3 de soporte (si
producción exige homologar el modelo Marketplace en la cuenta real), que el sandbox no
responde.

**Mismo día, flujo con el SDK oficial** (`s2 → s3 → s5 → s7 → s6` y `s3 → s5 → s8 → s6`): mismo
resultado que con raw-fetch. Hold `1352825041` capturado con `application_fee 150` y neto
809, y hold `1352825061` cancelado sin fees. Único cambio: `CardToken.create()` del SDK
(que tokeniza con el access_token del vendedor) ahora responde `403 G001
"unexpected_processing"`, así que `s3` pasó a tokenizar con la `public_key` del vendedor,
como lo hace el mobile. Detalle en `SOLUCION-FINAL.md`, sección 4.
