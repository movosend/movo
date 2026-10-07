# Spike Mercado Pago — MOVO-49 / MOVO-100 / MOVO-110-112

Script de consola para probar a mano, contra el sandbox real de Mercado Pago,
los mecanismos que hay que confirmar antes de implementar los pagos de MOVO
(`MOVO-49`, con impacto directo en `MOVO-100`/`MOVO-101`/`MOVO-110`/`MOVO-111`/`MOVO-112`):

- Hold / autorización con `capture: false`
- Conectar una cuenta de transportista vía OAuth (Mercado Pago Connect)
- **¿MP acepta un `redirect_uri` de esquema custom (deep link de mobile), o
  hace falta un salto intermedio por el backend?** — pregunta de diseño de
  `MOVO-111`/`MOVO-112`, sin respuesta en la documentación pública de MP
- Captura + Split payment (`application_fee`) — **la combinación de ambos es
  lo que la documentación oficial de MP nunca muestra junta, así que es lo
  más importante de confirmar acá**
- Cancelación del hold
- Guardado de tarjeta reusable (Customers & Cards) — hallazgo que afecta el
  diseño de `MOVO-100`, ver el comentario en ese ticket de Linear

No es código de producción ni se importa desde ningún servicio del
monorepo — es un artefacto de investigación, vive en `docs/` a propósito.

## Requisitos

- Node.js 18 o superior (usa `fetch` nativo — probado con Node 22).
- Las opciones numéricas del menú (1-9) no necesitan `npm install`: todo lo
  que usan viene incluido en Node (`readline`, `http`, `crypto`, `fs`) — es
  el flujo original, pegándole a la API REST directo con `fetch`.
- Las opciones con prefijo "s" (s1-s9) son el mismo flujo pero con el SDK
  oficial (`mercadopago` de npm) — para usarlas hace falta `npm install` en
  esta carpeta primero (tiene su propio `package.json`, no es parte de los
  workspaces del monorepo). Se agregaron para descartar si el error 2034 de
  `INVESTIGATION-2034.md` es un problema de cómo este script arma los
  requests a mano, o de la cuenta/flujo en sí.
- Una cuenta de Mercado Pago (la tuya, de developer) para crear la
  aplicación de prueba.

## Setup

### Credenciales del equipo (no están en el repo)

Las credenciales de sandbox con las que se verificó el flujo (app `movosend`, las tres
cuentas de prueba con sus contraseñas, tarjeta y un `.env` listo para copiar) están en el
archivo **"MOVO — Credenciales sandbox de Mercado Pago"** (`mp-sandbox-credenciales.md`).
Ese archivo no se versiona: se comparte por el medio seguro del equipo. Pedíselo a Tomás
Vergara. **Nunca pegues esos valores en el repo, en Linear ni en una PR.**

No crees una app nueva desde tu cuenta real de MP: en sandbox el dueño de la app, el
vendedor y el pagador tienen que ser cuentas de prueba, si no MP rechaza el pago con 2034
(ver `SOLUCION-FINAL.md` §1).

### Pasos

1. Copiar el bloque `.env` del archivo de credenciales a `.env` en esta carpeta
   (gitignored). `.env.example` documenta qué es cada variable.
2. Levantar un túnel (`cloudflared tunnel --url http://localhost:8787`) y cargar
   `https://<túnel>/callback` como Redirect URI en el panel de la app `movosend`
   (logueado como la cuenta de prueba Movo S.A) y en `MP_REDIRECT_URI`.
3. (Solo si vas a usar las opciones "s1".."s9") `npm install`
4. `node mp-spike-cli.js` y seguir el checklist de `SOLUCION-FINAL.md` §5.

## Cómo se usa

El script muestra un menú numerado. La primera vez, conviene seguir el
orden sugerido (1 → 2 → ... → 8) porque varios pasos necesitan el resultado
del anterior (por ejemplo, no se puede crear un pago con split sin haber
conectado antes la cuenta del transportista). Cada opción del menú imprime
en la consola una explicación de:

- a qué criterio de aceptación de `MOVO-49` corresponde (o si es el hallazgo
  de `MOVO-100`, o un extra "bonus" no pedido pero relacionado),
- qué requiere haber corrido antes,
- qué resultado se espera si todo sale bien,
- qué hacer si MP devuelve un error esperable (ej. token vencido, medio de
  pago sin captura diferida).

Cada llamada a la API de MP se loguea completa (request y response) en la
terminal, y un resumen no sensible (sin tokens ni número de tarjeta) queda
en `session-log.json` (gitignored) — pensado para copiar ese resumen como
evidencia en el comentario de Linear de `MOVO-49`.

## Test de deep link (opción "2b") — cómo interpretar el resultado

Esta opción responde una pregunta de arquitectura concreta para `MOVO-111`
(backend) y `MOVO-112`(mobile): cuando el transportista vincula su cuenta de
Mercado Pago desde el celular, ¿el `redirect_uri` puede ser directamente un
deep link de la app (`movo://mp-oauth-callback`), o Mercado Pago exige una
URL `https://` y hace falta que nuestro backend reciba el `code` primero y
recién ahí salte al deep link?

Como este script corre en una computadora, no puede simular que un teléfono
"abre la app Movo" — así que el test tiene una parte automática (un chequeo
rápido pegándole a la URL de autorización sin loguearse, a ver si MP
rechaza el formato del `redirect_uri` de entrada) y una parte manual (abrir
la URL en un navegador de verdad, loguearse con la cuenta de prueba
Vendedor, y observar si MP termina intentando navegar hacia el esquema
custom o si tira un error antes de eso). El script guía paso a paso qué
mirar y te pregunta qué viste al final.

**Cómo se traduce el resultado a una decisión de diseño:**

| Lo que se observó | Conclusión | Impacto en los tickets |
|---|---|---|
| MP rechaza el `redirect_uri` antes de terminar el login | No acepta esquemas custom | `MOVO-111` necesita un endpoint público (`https://`) que reciba el `code` y haga un 302 (o resuelva todo el canje ahí mismo) hacia el deep link — es la rama de AC3 de ese ticket que asume esto |
| MP completa el login y el navegador falla recién al intentar abrir `movo://...` | Sí acepta esquemas custom | `MOVO-112` puede usar el deep link directo como `redirect_uri` sin salto intermedio — pero el canje del `code` por `access_token` **igual tiene que hacerlo el backend siempre** (necesita el `client_secret`, que nunca puede viajar en el bundle de mobile) |
| No queda claro | Repetir con DevTools (F12) → pestaña Network → "Preserve log" activado ANTES de loguearse, para ver el request final con el header `Location` completo |

Una vez que tengas el resultado, avisale a quien esté armando `MOVO-111`
para que ajuste el AC3 de ese ticket con la respuesta confirmada (hoy queda
como pregunta abierta ahí).

## Tarjetas de prueba y cómo forzar un resultado

Mercado Pago usa el campo "nombre del titular" de la tarjeta de prueba para
forzar un resultado específico — no hace falta ninguna configuración en el
panel, alcanza con cambiar `MP_TEST_CARD_HOLDER_NAME` en el `.env`:

| Valor  | Resultado |
|--------|-----------|
| `APRO` | Aprobado (default de este script) |
| `CONT` | Pendiente |
| `OTHE` | Rechazado (error general) |
| `FUND` | Rechazado por fondos insuficientes |
| `SECU` | Rechazado por código de seguridad inválido |
| `EXPI` | Rechazado por fecha de vencimiento inválida |
| `FORM` | Error de formulario |
| `CALL` | Requiere validación / autorización |

## Qué NO hace este script (a propósito)

- No tokeniza tarjetas reales ni se conecta a producción — todo apunta a
  `api.mercadopago.com` con credenciales de **test**.
- No reemplaza el trabajo real de `MOVO-100`/`MOVO-101` — es solo para
  destrabar las dudas de diseño antes de escribir ese código.
- No guarda tokens ni números de tarjeta en disco. Solo movimientos no
  sensibles (ids, estados, montos) van a `session-log.json`.
