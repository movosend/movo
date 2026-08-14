#!/usr/bin/env node
/**
 * ============================================================================
 * Mercado Pago — Spike de consola (MOVO-49 / MOVO-100)
 * ============================================================================
 *
 * QUÉ ES ESTO
 * -----------
 * Una "app de consola" (un menú de texto, nada de UI) para probar a mano,
 * contra el sandbox REAL de Mercado Pago (MP), los mecanismos que
 * necesitamos confirmar antes de escribir código de producción:
 *
 *   - Hold / autorización con `capture: false`             (MOVO-49 AC1)
 *   - Conectar una cuenta de transportista vía OAuth        (MOVO-49 AC2)
 *   - ¿MP acepta un redirect_uri de esquema custom (deep    (MOVO-111 AC3)
 *     link), o necesitamos un salto intermedio en el backend?
 *   - Captura + Split payment (application_fee)             (MOVO-49 AC3)
 *   - Cancelación del hold (liberar fondos)                 (MOVO-49 AC4)
 *   - Guardado de tarjeta reusable (Customers & Cards)       (hallazgo MOVO-100)
 *
 * No es código de producción. No se importa desde ningún servicio. Vive acá
 * (`docs/scripts/`) porque es un artefacto de investigación: el objetivo es
 * dejar un registro reproducible de qué se probó y qué devolvió MP, para
 * pegar el resultado como comentario en Linear (MOVO-49 / MOVO-100).
 *
 * DEPENDENCIAS NPM
 * -----------------
 * Originalmente este script no usaba ninguna dependencia (todo lo que hace
 * falta para pegarle a la API REST directo viene incluido en Node: `fetch`,
 * `readline`, `http`, `crypto`, `fs`) — esa parte del script (las opciones
 * numéricas del menú, 1-9) se mantiene así a propósito.
 *
 * Se agregó `mercadopago` (el SDK oficial de Node) como dependencia real
 * porque INVESTIGATION-2034.md necesitaba descartar la hipótesis de que el
 * error 2034 es un problema de cómo este script arma los requests a mano
 * (headers, idempotency key, forma exacta del body) y no de la cuenta/flujo
 * en sí — el SDK es lo que efectivamente se va a usar en
 * `movo-svc-payments`, así que es la comparación que importa. Las opciones
 * del menú con prefijo "s" (s1-s9) son el mismo flujo de negocio de las
 * opciones 1-9, reimplementado con el SDK en vez de `fetch` directo — correr
 * `npm install` en esta carpeta antes de usarlas (no es parte de los
 * workspaces del monorepo, así que no interfiere con nada más).
 *
 * CÓMO USARLO
 * -----------
 * 1. Copiar `.env.example` a `.env` y completar las credenciales (ver ese
 *    archivo, tiene instrucciones paso a paso de dónde sacar cada valor).
 * 2. `npm install` (solo hace falta para las opciones "s1".."s9", ver arriba).
 * 3. `node mp-spike-cli.js`
 * 4. Seguir el menú EN ORDEN la primera vez (cada paso explica en qué AC de
 *    MOVO-49 encaja y qué inputs necesita de un paso anterior). Después de
 *    la primera pasada se puede saltar directo a la opción que haga falta
 *    reprobar.
 *
 * IMPORTANTE — Esto es SOLO para este script de investigación, no para
 * copiar en la app real:
 *   Acá se tokeniza una tarjeta de prueba directo por API (`POST
 *   /v1/card_tokens` con el número de tarjeta en el body). Eso es válido
 *   para un script de research contra tarjetas de prueba, pero en la app
 *   real (MOVO-101) la tokenización tiene que ocurrir en el dispositivo del
 *   usuario vía el SDK de Mercado Pago (Checkout Bricks) — nuestro backend
 *   JAMÁS puede recibir un número de tarjeta real. Ver AC3 de MOVO-101.
 */

'use strict';

const readline = require('node:readline');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// SDK oficial — solo lo usan las opciones "s1".."s9" del menú (ver comentario
// de cabecera). `require` perezoso con try/catch para que las opciones 1-9
// (raw fetch) sigan andando sin `npm install` si alguien todavía no lo corrió.
let mercadopago = null;
function loadSdk() {
  if (mercadopago) return mercadopago;
  try {
    mercadopago = require('mercadopago');
    return mercadopago;
  } catch {
    console.log('[error] Falta el SDK. Corré "npm install" en esta carpeta (docs/scripts/mercadopago-spike/) y reintentá.');
    return null;
  }
}

// ----------------------------------------------------------------------------
// 1. Configuración (.env manual, sin dependencia de `dotenv`)
// ----------------------------------------------------------------------------

const ENV_PATH = path.join(__dirname, '.env');
const SESSION_LOG_PATH = path.join(__dirname, 'session-log.json');

/**
 * Parser mínimo de `.env`: líneas `CLAVE=valor`, ignora comentarios (#) y
 * líneas vacías. No hace falta nada más sofisticado para este script.
 */
function loadEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    // Saca comillas si el valor las tiene (KEY="valor")
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const fileEnv = loadEnvFile(ENV_PATH);
// Las variables de entorno reales del shell (si existen) ganan por sobre el .env
const env = { ...fileEnv, ...process.env };

// Interfaz de consola única para todo el script (antes vivía solo dentro de
// `main()` — se sube acá porque el paso de deep link (más abajo) también
// necesita poder preguntarle cosas al usuario a mitad de su ejecución, no
// solo el loop del menú principal).
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

const CONFIG = {
  // Access token de NUESTRA aplicación de test en MP (empieza con TEST- o
  // APP_USR-). Se usa para todo lo que hacemos "como Movo": tokenizar
  // tarjetas de prueba, crear customers, consultar payment_methods.
  appAccessToken: env.MP_APP_ACCESS_TOKEN || '',
  // Public Key de prueba de NUESTRA aplicación (misma sección del panel que
  // el Access Token). Usada SOLO para tokenizar la tarjeta (AC1/AC3): un
  // card_token creado con el Access Token privado queda ligado a esa cuenta
  // y MP lo rechaza ("Card Token not found") si el pago se termina creando
  // con el access_token de un vendedor conectado (split/marketplace) — hace
  // falta la Public Key para que el token sea válido en ese escenario.
  appPublicKey: env.MP_APP_PUBLIC_KEY || '',
  // client_id / client_secret de la aplicación (panel de MP > Tus
  // integraciones > tu app > Credenciales). Se usan solo para el flujo OAuth.
  clientId: env.MP_APP_CLIENT_ID || '',
  clientSecret: env.MP_APP_CLIENT_SECRET || '',
  // Tiene que ser EXACTAMENTE la misma URL que registraste como "Redirect
  // URI" en el panel de la app. El script levanta un servidor local
  // efímero en este puerto para recibir la respuesta de MP automáticamente.
  redirectUri: env.MP_REDIRECT_URI || 'http://localhost:8787/callback',
  // Solo para el test de deep link (opción del menú "2b"): el redirect_uri
  // "de mobile" que queremos ver si MP acepta — un esquema custom de app,
  // no una URL http(s). Tiene que estar TAMBIÉN registrado como Redirect
  // URI adicional en el panel de la app para que el test tenga sentido
  // (ver README.md, sección del test de deep link).
  deepLinkTestRedirectUri: env.MP_DEEPLINK_TEST_REDIRECT_URI || 'movo://mp-oauth-callback',
  // Datos de la tarjeta de prueba a usar (por defecto, la Visa de crédito
  // AR documentada por MP). "APRO" en el titular = pago aprobado.
  testCard: {
    number: env.MP_TEST_CARD_NUMBER || '4509953566233704',
    cvv: env.MP_TEST_CARD_CVV || '123',
    expirationMonth: env.MP_TEST_CARD_EXP_MONTH || '11',
    expirationYear: env.MP_TEST_CARD_EXP_YEAR || '2030',
    // El "nombre del titular" es lo que fuerza el resultado en sandbox.
    // APRO = aprobado. Cambiar a OTHE/FUND/CONT/etc. para simular rechazos.
    holderName: env.MP_TEST_CARD_HOLDER_NAME || 'APRO',
    // payment_method_id que corresponde a esta tarjeta (fijo, porque el
    // número de tarjeta de prueba es fijo). "visa" para la Visa de crédito.
    paymentMethodId: env.MP_TEST_PAYMENT_METHOD_ID || 'visa',
  },
  testPayerEmail: env.MP_TEST_PAYER_EMAIL || 'comprador_test@testuser.com',
  // Monto total del "hold" (lo que el emisor reserva al confirmar un envío).
  holdAmount: Number(env.MP_HOLD_AMOUNT || 1000),
  // Comisión de Movo dentro de ese monto (application_fee = split).
  applicationFee: Number(env.MP_APPLICATION_FEE || 150),
  // Credenciales separadas para las opciones "o1".."o6" (Orders API) — ver
  // comentario en .env.example/.env. A diferencia de MP_APP_ACCESS_TOKEN,
  // este access_token ya representa directamente al Vendedor conectado, sin
  // pasar por OAuth Connect.
  ordersAppAccessToken: env.MP_ORDERS_APP_ACCESS_TOKEN || '',
  ordersAppPublicKey: env.MP_ORDERS_APP_PUBLIC_KEY || '',
};

// ----------------------------------------------------------------------------
// 2. Estado en memoria de la sesión interactiva
// ----------------------------------------------------------------------------
//
// Nada de esto se persiste tal cual en disco (los tokens NO se guardan) —
// solo se guarda un resumen no sensible en session-log.json (ver
// `appendToSessionLog`) para poder pegarlo después en el comentario de
// Linear.

const state = {
  sellerAccessToken: null, // access_token del TRANSPORTISTA, obtenido por OAuth (AC2)
  sellerUserId: null,
  sellerPublicKey: null, // public_key del TRANSPORTISTA (viene en la respuesta de /oauth/token) —
  // necesaria para tokenizar la tarjeta cuando el pago se va a cobrar contra
  // esa cuenta (split/marketplace): MP exige que el card_token se cree con
  // la public_key del COLLECTOR real, no con la de nuestra app.
  cardTokenId: null, // token de un solo uso de la tarjeta de prueba (AC1/AC3)
  customerId: null, // customer de MP para guardar la tarjeta (hallazgo MOVO-100)
  savedCardId: null, // id ESTABLE de la tarjeta guardada contra ese customer
  holdPaymentId: null, // id del pago con capture:false ya creado (AC1)
};

// Mismo shape que `state`, pero para el flujo "s1".."s9" (SDK oficial) — a
// propósito NO comparte estado con `state`: así se puede correr un flujo
// primero (por ejemplo el raw-fetch) y después el otro desde cero, sin que
// uno pise tokens/ids del otro y sin dudas de cuál dejó qué.
const sdkState = {
  sellerAccessToken: null,
  sellerUserId: null,
  cardTokenId: null,
  customerId: null,
  savedCardId: null,
  holdPaymentId: null,
};

const sessionLog = [];

function appendToSessionLog(step, summary) {
  const entry = { step, summary, at: new Date().toISOString() };
  sessionLog.push(entry);
  try {
    fs.writeFileSync(SESSION_LOG_PATH, JSON.stringify(sessionLog, null, 2));
  } catch (err) {
    console.warn('[aviso] no se pudo escribir session-log.json:', err.message);
  }
}

// ----------------------------------------------------------------------------
// 3. Helper HTTP para pegarle a la API de Mercado Pago
// ----------------------------------------------------------------------------
//
// Todas las llamadas pasan por acá para que quede UN solo lugar que loguea
// exactamente qué se mandó y qué contestó MP — clave para poder copiar el
// intercambio real a Linear como evidencia del spike.

const MP_API_BASE = 'https://api.mercadopago.com';

/**
 * @param {string} method       GET | POST | PUT
 * @param {string} pathname     ej: "/v1/payments"
 * @param {object} [opts]
 * @param {string} [opts.token] access_token a mandar en el header Authorization
 * @param {object} [opts.body]  body JSON del request
 * @param {string} [opts.idempotencyKey] valor para el header X-Idempotency-Key
 *   (MP lo recomienda en POST que crean recursos, para poder reintentar sin
 *   riesgo de duplicar un pago si se corta la conexión a mitad de camino)
 */
async function mpRequest(method, pathname, opts = {}) {
  const url = `${MP_API_BASE}${pathname}`;
  const headers = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.idempotencyKey) headers['X-Idempotency-Key'] = opts.idempotencyKey;

  console.log(`\n→ ${method} ${url}`);
  if (opts.body) {
    console.log('  body:', JSON.stringify(redactSecrets(opts.body), null, 2));
  }

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  console.log(`← HTTP ${res.status}`);
  console.log(JSON.stringify(json, null, 2));

  return { status: res.status, ok: res.ok, data: json };
}

/** No queremos que un número de tarjeta de prueba termine en session-log.json */
function redactSecrets(body) {
  const clone = JSON.parse(JSON.stringify(body));
  if (clone.card_number) clone.card_number = '****REDACTED****';
  if (clone.security_code) clone.security_code = '***';
  if (clone.client_secret) clone.client_secret = '***REDACTED***';
  return clone;
}

// ----------------------------------------------------------------------------
// 4. PASO — AC1 (prerrequisito): ¿esta tarjeta soporta captura diferida?
// ----------------------------------------------------------------------------
//
// No todos los medios de pago de MP soportan hold/capture. Antes de asumir
// que "cualquier tarjeta de prueba sirve", hay que confirmar el atributo
// `deferred_capture` del medio de pago que vamos a usar.

async function stepCheckDeferredCapture() {
  console.log(`
--------------------------------------------------------------------------
AC1 (prerrequisito) — ¿Los medios de pago de test soportan captura diferida?
--------------------------------------------------------------------------
Consultamos GET /v1/payment_methods con el access_token de NUESTRA app y
mostramos, para cada medio, si el campo "deferred_capture" dice "supported".
Si el medio que pensás usar (por defecto: "visa") no lo soporta, un hold
con capture:false va a fallar más adelante — mejor saberlo ahora.
`);
  if (!CONFIG.appAccessToken) {
    console.log('[error] Falta MP_APP_ACCESS_TOKEN en .env — no se puede continuar.');
    return;
  }

  const { data } = await mpRequest('GET', '/v1/payment_methods', {
    token: CONFIG.appAccessToken,
  });

  if (Array.isArray(data)) {
    console.log('\nResumen deferred_capture por medio de pago:');
    for (const pm of data) {
      console.log(`  - ${pm.id} (${pm.name}): deferred_capture = ${pm.deferred_capture}`);
    }
    const target = data.find((pm) => pm.id === CONFIG.testCard.paymentMethodId);
    if (target) {
      console.log(
        `\n>>> El medio configurado (${CONFIG.testCard.paymentMethodId}) tiene deferred_capture = "${target.deferred_capture}".`
      );
    }
  }

  appendToSessionLog('AC1-prerrequisito:deferred_capture', {
    paymentMethodId: CONFIG.testCard.paymentMethodId,
  });
}

// ----------------------------------------------------------------------------
// 5. PASO — AC2: conectar la cuenta de un transportista vía OAuth
// ----------------------------------------------------------------------------
//
// Esto simula "el transportista conecta su cuenta de Mercado Pago a Movo".
// El flujo real de OAuth necesita un navegador (el usuario tiene que loguear
// en MP y aceptar el permiso) y un servidor que reciba el redirect con el
// "code". Para no tener que copiar/pegar ese code a mano (vence en 10
// minutos, es fácil llegar tarde), el script levanta un servidorcito HTTP
// local temporal que lo captura solo.
//
// Prerrequisito: tenés que haber registrado CONFIG.redirectUri
// (por defecto http://localhost:8787/callback) como "Redirect URI" en el
// panel de tu aplicación de MP. Si no coincide EXACTO, MP rechaza el login.

function base64UrlEncode(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** PKCE: capa extra de seguridad recomendada por MP para el intercambio OAuth. */
function generatePkcePair() {
  const verifier = base64UrlEncode(crypto.randomBytes(48)); // 43-128 chars, ok
  const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/**
 * Arma la URL de autorización de MP para un redirect_uri dado. Extraído a
 * parte para que tanto el flujo normal (opción 2, redirect_uri http local)
 * como el test de deep link (opción 2b, redirect_uri esquema custom) usen
 * exactamente la misma lógica de armado — así comparamos manzanas con
 * manzanas.
 */
function buildAuthorizationUrl(redirectUri) {
  const { verifier, challenge } = generatePkcePair();
  const stateParam = crypto.randomBytes(16).toString('hex');

  const authUrl = new URL('https://auth.mercadopago.com/authorization');
  authUrl.searchParams.set('client_id', CONFIG.clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('platform_id', 'mp');
  authUrl.searchParams.set('state', stateParam);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return { url: authUrl, verifier, stateParam };
}

async function stepConnectSellerAccount() {
  console.log(`
--------------------------------------------------------------------------
AC2 — Conectar cuenta de prueba del transportista vía Mercado Pago Connect
--------------------------------------------------------------------------
1. Se abre (o mostramos la URL para abrir a mano) la pantalla de
   autorización de MP.
2. Logueate con la CUENTA DE PRUEBA de tipo "Vendedor" (la que creaste en
   el panel de MP, sección "Cuentas de prueba" — ver README.md).
3. Aceptás el permiso. MP redirige a tu redirect_uri con "?code=...".
4. Este script está escuchando en ese puerto y captura el code solo.
5. Canjeamos ese code por un access_token — ESE es el token que representa
   "Movo puede cobrar en nombre de este transportista", y es el que se usa
   después para el pago con application_fee (AC3).
`);

  if (!CONFIG.clientId || !CONFIG.clientSecret) {
    console.log('[error] Faltan MP_APP_CLIENT_ID / MP_APP_CLIENT_SECRET en .env.');
    return;
  }

  const redirectUrl = new URL(CONFIG.redirectUri);
  const port = Number(redirectUrl.port || 8787);

  const { url: authUrl, verifier, stateParam } = buildAuthorizationUrl(CONFIG.redirectUri);

  console.log('\nAbrí esta URL en el navegador (logueado con la cuenta de prueba Vendedor):\n');
  console.log(authUrl.toString());
  console.log(`\nEsperando el redirect en ${CONFIG.redirectUri} ...`);

  const code = await waitForOAuthRedirect(port, stateParam);
  if (!code) {
    console.log('[error] No se recibió el code (¿timeout, o el state no coincidió?).');
    return;
  }

  console.log(`\nCode recibido: ${code.slice(0, 8)}... — canjeando por access_token (10 min de margen).`);

  const { ok, data } = await mpRequest('POST', '/oauth/token', {
    body: {
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: CONFIG.redirectUri,
      code_verifier: verifier,
      // Pedido explícito de soporte de MP (ticket 2034, respuesta 2026-08-14):
      // sin esto el access_token del vendedor conectado puede no quedar en
      // modo TEST- aunque la app y el code sean de sandbox — es la causa que
      // señalan como más probable del error "Invalid users involved".
      test_token: true,
    },
  });

  if (!ok) {
    console.log('[error] MP rechazó el canje del code. Ver respuesta arriba.');
    return;
  }

  state.sellerAccessToken = data.access_token;
  state.sellerUserId = data.user_id;
  state.sellerPublicKey = data.public_key || null;

  const tokenPrefix = typeof data.access_token === 'string' ? data.access_token.split('-')[0] : 'unknown';
  console.log(`\n✅ Cuenta de transportista conectada. user_id = ${data.user_id}.`);
  console.log('   (el access_token queda solo en memoria de este proceso, no se guarda en disco)');
  console.log(`   access_token prefix = ${tokenPrefix}- | live_mode = ${data.live_mode}`);
  if (tokenPrefix !== 'TEST') {
    console.log(
      '   [alerta] El access_token del vendedor NO empieza con TEST- — según soporte de MP, ' +
        'esto es justamente la condición que dispara el error 2034 más adelante.'
    );
  }

  appendToSessionLog('AC2:oauth-connect', {
    sellerUserId: data.user_id,
    scope: data.scope,
    expiresInSeconds: data.expires_in,
    accessTokenPrefix: tokenPrefix,
    liveMode: data.live_mode,
    testTokenRequested: true,
  });
}

/** Levanta un server HTTP efímero, resuelve con el "code" cuando MP redirige. */
function waitForOAuthRedirect(port, expectedState) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, `http://localhost:${port}`);
      const code = reqUrl.searchParams.get('code');
      const returnedState = reqUrl.searchParams.get('state');

      // El navegador dispara requests espurias al dominio del túnel apenas
      // navega ahí (favicon.ico, preconnect, etc.) — ninguna trae "code".
      // Cerrar el server con la primera request que llega (sin filtrar)
      // mataba el listener antes de que llegara el callback real de MP.
      // Solo tratamos como terminal una request que efectivamente traiga
      // "code" (el callback real de OAuth); todo lo demás se responde sin
      // cerrar el server, para seguir esperando.
      if (!code) {
        res.writeHead(204);
        res.end();
        return;
      }

      // Una request con "code" pero "state" que no matchea (tab vieja,
      // navegación en caché del navegador, un segundo intento superpuesto)
      // tampoco es el callback real que estamos esperando — respondemos y
      // seguimos escuchando, en vez de cerrar el server y perder la request
      // buena que puede llegar segundos después (eso causaba un 502 en
      // Cloudflare: el server ya estaba cerrado cuando MP mandaba el code
      // correcto).
      if (returnedState !== expectedState) {
        console.log(`[warn] Llegó una request con "code" pero "state" distinto al esperado (${returnedState}) — se ignora, se sigue esperando.`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>Algo no coincidió</h2><p>Revisá la terminal.</p>');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>Listo ✅</h2><p>Ya podés volver a la terminal.</p>');
      server.close();
      resolve(code);
    });

    server.listen(port);

    // Si el usuario nunca completa el login en 5 minutos, no dejamos el
    // proceso colgado para siempre.
    setTimeout(() => {
      server.close();
      resolve(null);
    }, 5 * 60 * 1000);
  });
}

// ----------------------------------------------------------------------------
// 5b. PASO — ¿MP acepta un redirect_uri de esquema custom (deep link)?
// ----------------------------------------------------------------------------
//
// Pregunta que motivó este paso: en mobile no podemos levantar un servidor
// HTTP local como en la opción 2 (ese truco solo funciona porque este
// script corre en una compu). En el teléfono, el equivalente nativo es que
// MP redirija a un "deep link" propio de la app — algo como
// `movo://mp-oauth-callback` — y que el sistema operativo reabra Movo solo.
//
// La duda real (no la resuelve ninguna doc pública de MP que hayamos
// encontrado) es si Mercado Pago ACEPTA ese tipo de redirect_uri de entrada,
// o si exige que sea una URL `https://` — lo cual cambia la arquitectura:
// si exige https, hace falta un endpoint público en nuestro backend que
// reciba el `code` y recién ahí salte al deep link (ver AC3 de MOVO-111).
//
// CÓMO SE PRUEBA ACÁ (importante leer esto antes de correr la opción)
// --------------------------------------------------------------------------
// Este script NO puede simular que un teléfono "abre la app" cuando el
// navegador intenta ir a `movo://...` — no hay teléfono, hay una terminal.
// Lo que SÍ podemos verificar desde acá:
//
//   (A) Un chequeo automático rápido: le pegamos a la URL de autorización
//       de MP con `redirect: "manual"` (sin loguear, sin ejecutar nada) y
//       miramos qué contesta. Si MP valida el formato del redirect_uri
//       ANTES de mostrar el login, esto ya nos daría una pista sin
//       necesitar un navegador real. Es una pista, no una prueba
//       definitiva — MP podría igual esperar hasta después del login para
//       validarlo.
//
//   (B) La prueba real, semi-manual: abrís la URL en un navegador de
//       verdad, hacés login con la cuenta de prueba Vendedor, autorizás, y
//       mirás qué pasa al final. Como tu compu no tiene una "app Movo"
//       registrada para el esquema `movo://`, el navegador va a fallar al
//       intentar navegar ahí — pero ESE fallo es justamente la prueba de
//       que MP sí completó el redirect (si en cambio MP te muestra un
//       error de "redirect_uri inválido" ANTES de eso, la respuesta es que
//       no lo acepta). El script te va a pedir que cuentes qué viste, y si
//       llegaste a ver el `code` en la URL fallida (Chrome/Firefox suelen
//       mostrar la URL completa en el diálogo de "¿abrir esta app externa?"
//       o en las DevTools > Network con "preserve log" activado), lo podés
//       pegar acá para cerrar el círculo completo (canjearlo por un token).

async function stepTestDeepLinkRedirect() {
  console.log(`
--------------------------------------------------------------------------
[MOVO-111 AC3] — ¿MP acepta un redirect_uri de esquema custom (deep link)?
--------------------------------------------------------------------------
Redirect URI a probar: ${CONFIG.deepLinkTestRedirectUri}
(configurable en .env como MP_DEEPLINK_TEST_REDIRECT_URI)

Prerrequisito: agregá ese mismo valor como Redirect URI ADICIONAL en el
panel de tu app de MP (junto al http://localhost:8787/callback que ya
tenías para la opción 2) — si no está registrado tal cual, MP lo va a
rechazar sin importar si "acepta esquemas custom" en general o no, y vamos
a confundir ese rechazo con la respuesta que buscamos.
`);

  if (!CONFIG.clientId) {
    console.log('[error] Falta MP_APP_CLIENT_ID en .env.');
    return;
  }

  const { url: authUrl, verifier } = buildAuthorizationUrl(CONFIG.deepLinkTestRedirectUri);

  // --- Parte A: chequeo automático rápido ------------------------------
  console.log('Parte A — chequeo automático (sin loguear, solo para ver si MP');
  console.log('          rechaza el formato del redirect_uri de entrada):\n');

  let preCheckNote = 'no concluyente';
  try {
    const res = await fetch(authUrl.toString(), { redirect: 'manual' });
    const bodyPreview = (await res.text()).slice(0, 400);
    console.log(`  HTTP ${res.status}${res.headers.get('location') ? ` (Location: ${res.headers.get('location')})` : ''}`);
    const looksLikeRedirectUriError =
      /redirect.?uri/i.test(bodyPreview) && /(inv[aá]lid|error|no coincide|mismatch)/i.test(bodyPreview);
    if (looksLikeRedirectUriError) {
      console.log('  >>> El HTML de respuesta menciona "redirect_uri" junto a una palabra de error.');
      console.log('      Pista de que MP podría estar rechazando el formato ya en este punto.');
      preCheckNote = 'posible rechazo de formato (ver texto en consola)';
    } else {
      console.log('  >>> No se detectó un error obvio de redirect_uri en esta respuesta —');
      console.log('      no es garantía de que lo acepte, MP puede validar recién tras el login.');
      preCheckNote = 'sin error obvio en el pre-check (no concluyente por sí solo)';
    }
  } catch (err) {
    console.log(`  [aviso] No se pudo hacer el chequeo automático: ${err.message}`);
  }

  // --- Parte B: prueba manual con navegador real ------------------------
  console.log(`
Parte B — prueba manual (necesita un navegador de verdad):

  1. Abrí esta URL en el navegador:

     ${authUrl.toString()}

  2. Logueate con la cuenta de prueba Vendedor y autorizá el permiso.
  3. Prestá atención a QUÉ PASA AL FINAL:
     - Si MP muestra un error ANTES de completar el login (algo tipo
       "redirect_uri inválido" o "no coincide con la configuración de la
       app") => MP rechazó el esquema custom.
     - Si el login/autorización se completa y RECIÉN AHÍ el navegador
       falla al intentar abrir "${CONFIG.deepLinkTestRedirectUri}..."
       (pantalla de "no se pudo abrir", o un diálogo de "¿abrir en otra
       app?") => MP sí completó el redirect hacia el esquema custom.
     - Tip para no perder el "code": abrí las DevTools del navegador
       (F12) > pestaña Network > tildá "Preserve log" ANTES del paso 2 —
       ahí vas a poder ver la request final con status 30x y el header
       "Location" completo, con el "code" y el "state" en la query string,
       aunque el navegador no pueda navegar ahí.
`);

  const outcome = (
    await ask(
      '¿Qué viste? [1] error de redirect_uri antes de terminar  [2] MP completó el redirect al esquema custom  [3] no está claro / otro: '
    )
  ).trim();

  let conclusion;
  if (outcome === '1') {
    conclusion =
      'MP RECHAZÓ el redirect_uri de esquema custom -> hace falta un endpoint público ' +
      'intermedio en el backend (https) que reciba el code y salte al deep link (ver AC3 de MOVO-111).';
  } else if (outcome === '2') {
    conclusion =
      'MP ACEPTÓ el redirect_uri de esquema custom y completó el redirect -> el mobile ' +
      'podría usarlo directo, sin salto intermedio por el backend, para ESTE paso puntual ' +
      '(el canje del code por access_token igual tiene que hacerlo el backend siempre, ' +
      'porque requiere el client_secret).';
  } else {
    conclusion = 'Resultado no concluyente — repetir la prueba con DevTools > Network > Preserve log activado.';
  }

  console.log(`\n>>> Conclusión registrada: ${conclusion}`);

  // Si en la Parte B se llegó a ver el "code" (por ejemplo, copiado del
  // header Location en DevTools), lo podemos canjear acá mismo para
  // confirmar el círculo completo — mismo intercambio que la opción 2,
  // pero usando el verifier de ESTA autorización (por eso hace falta
  // pedirlo nuevo: si perdiste el code, no hay drama, no es obligatorio).
  const pastedCode = (
    await ask('\n(Opcional) Si copiaste el "code" de la URL fallida, pegalo acá para canjearlo (Enter para saltear): ')
  ).trim();

  if (pastedCode) {
    console.log('\nCanjeando el code por un access_token (mismo endpoint que la opción 2, pero con');
    console.log('el redirect_uri de esquema custom) — esto además confirma si /oauth/token TAMBIÉN');
    console.log('exige que el redirect_uri del canje coincida con el de la autorización original:\n');

    const { ok, data } = await mpRequest('POST', '/oauth/token', {
      body: {
        client_id: CONFIG.clientId,
        client_secret: CONFIG.clientSecret,
        code: pastedCode,
        grant_type: 'authorization_code',
        redirect_uri: CONFIG.deepLinkTestRedirectUri,
        code_verifier: verifier,
      },
    });

    if (ok) {
      console.log('\n✅ Canje exitoso — MP acepta de punta a punta el esquema custom como redirect_uri.');
      console.log('   (no se guarda este token para el resto del menú — si querés seguir con AC1+AC3,');
      console.log('    usá la opción 2 normal para dejar state.sellerAccessToken cargado)');
    } else {
      console.log('\n[error] El canje falló. Puede ser por el redirect_uri, por el code (ya usado /');
      console.log('        vencido a los 10 min), o porque el code_verifier no es el de esta misma');
      console.log('        corrida (si reiniciaste el script entre medio, no va a matchear).');
    }
  }

  appendToSessionLog('MOVO-111-AC3:deep-link-redirect-test', {
    redirectUriTested: CONFIG.deepLinkTestRedirectUri,
    autoPreCheck: preCheckNote,
    manualOutcome: outcome,
    conclusion,
  });
}

// ----------------------------------------------------------------------------
// 6. PASO — Tokenizar la tarjeta de prueba
// ----------------------------------------------------------------------------
//
// ADVERTENCIA (repetida a propósito, es importante): esto manda el número
// de tarjeta directo por API. Es aceptable ACÁ porque:
//   (a) es una tarjeta de prueba de Mercado Pago, no una tarjeta real, y
//   (b) este es un script de investigación, no código que vaya a producción.
// En la app real (MOVO-101) la tokenización tiene que hacerla el SDK de MP
// dentro del dispositivo del usuario — nuestro backend nunca ve el número.

async function stepTokenizeCard() {
  console.log(`
--------------------------------------------------------------------------
Tokenizar la tarjeta de prueba (POST /v1/card_tokens)
--------------------------------------------------------------------------
Genera un "card_token": una referencia de UN SOLO USO a los datos de la
tarjeta, válida por un tiempo corto. Es lo que normalmente generaría el SDK
de Checkout Bricks en el dispositivo del usuario — acá lo generamos por API
directa porque estamos en un script de test, no en una app real.

IMPORTANTE (hallazgo de este spike): NO se tokeniza con el Access Token
privado. Un card_token creado con Access Token queda ligado a esa cuenta, y
MP lo rechaza ("Card Token not found", código 2006) apenas el pago se crea
con el access_token de otra cuenta.

Tampoco alcanza con la Public Key de NUESTRA app: para un pago que se va a
cobrar contra la cuenta de un vendedor conectado (split/marketplace, opción
5), MP exige que el card_token se haya creado con la Public Key de ESE
vendedor (viene en la respuesta del OAuth, opción 2) — no la nuestra. Si ya
conectaste un transportista (opción 2), se usa automáticamente su Public
Key; si no, se cae a la Public Key de la app (sirve para MOVO-100 / pagos
cobrados por nuestra propia cuenta, pero NO para split).
`);

  const publicKey = state.sellerPublicKey || CONFIG.appPublicKey;

  if (!publicKey) {
    console.log('[error] Falta una Public Key para tokenizar: conectá un transportista (opción 2)');
    console.log('        o configurá MP_APP_PUBLIC_KEY en .env.');
    return;
  }
  if (!state.sellerPublicKey) {
    console.log('[aviso] Todavía no conectaste un transportista (opción 2) — tokenizando con la');
    console.log('        Public Key de la app. Si vas a probar el split (opción 5), conectá primero');
    console.log('        al transportista y generá un card_token nuevo con su Public Key.');
  }

  const { ok, data } = await mpRequest('POST', `/v1/card_tokens?public_key=${encodeURIComponent(publicKey)}`, {
    body: {
      card_number: CONFIG.testCard.number,
      security_code: CONFIG.testCard.cvv,
      expiration_month: Number(CONFIG.testCard.expirationMonth),
      expiration_year: Number(CONFIG.testCard.expirationYear),
      cardholder: {
        name: CONFIG.testCard.holderName,
        identification: { type: 'DNI', number: '12345678' },
      },
    },
  });

  if (!ok) {
    console.log('[error] No se pudo tokenizar la tarjeta. Ver respuesta arriba.');
    return;
  }

  state.cardTokenId = data.id;
  console.log(`\n✅ card_token creado: ${data.id}`);
  console.log('   Ojo: es de un solo uso — si falla el siguiente paso, hay que generar uno nuevo.');

  appendToSessionLog('tokenize-card', { cardTokenId: data.id });
}

// ----------------------------------------------------------------------------
// 7. PASO — Hallazgo MOVO-100: guardar la tarjeta (Customers & Cards)
// ----------------------------------------------------------------------------
//
// Esto NO estaba en los ACs originales de MOVO-49, pero es el punto que se
// dejó documentado como pendiente de confirmar en el comentario de
// MOVO-100: un card_token es de un solo uso / expira — para poder cobrarle
// al mismo emisor en un envío futuro, MP dice que hay que crear un
// "customer" y guardar la tarjeta contra él, lo que da un id ESTABLE.

async function stepCreateCustomerAndSaveCard() {
  console.log(`
--------------------------------------------------------------------------
Hallazgo MOVO-100 — Guardar la tarjeta para reuso futuro (Customers & Cards)
--------------------------------------------------------------------------
Paso 1: crear (o reusar) un "customer" en MP para este usuario de Movo.
Paso 2: guardar la tarjeta tokenizada contra ese customer.
Esto da un customerId + cardId ESTABLES — a diferencia del card_token del
paso anterior, estos no deberían expirar. Es lo que hay que confirmar acá.
`);

  if (!CONFIG.appAccessToken) {
    console.log('[error] Falta MP_APP_ACCESS_TOKEN en .env.');
    return;
  }
  if (!state.cardTokenId) {
    console.log('[error] Primero tokenizá una tarjeta (opción anterior del menú).');
    return;
  }

  if (!state.customerId) {
    const { ok, data } = await mpRequest('POST', '/v1/customers', {
      token: CONFIG.appAccessToken,
      body: { email: CONFIG.testPayerEmail },
    });

    if (!ok && data.cause?.[0]?.code !== 101) {
      // 101 en /v1/customers suele indicar "ya existe un customer con ese
      // email" — no es un error real para este script, lo tratamos aparte.
      console.log('[error] No se pudo crear el customer. Ver respuesta arriba.');
      return;
    }

    if (ok) {
      state.customerId = data.id;
    } else {
      console.log('[aviso] El customer ya existía — buscándolo por email...');
      const search = await mpRequest('GET', `/v1/customers/search?email=${encodeURIComponent(CONFIG.testPayerEmail)}`, {
        token: CONFIG.appAccessToken,
      });
      state.customerId = search.data?.results?.[0]?.id || null;
    }
  }

  if (!state.customerId) {
    console.log('[error] No se pudo obtener un customerId. Abortando este paso.');
    return;
  }

  console.log(`\ncustomerId en uso: ${state.customerId}`);

  const { ok, data } = await mpRequest(
    'POST',
    `/v1/customers/${state.customerId}/cards`,
    {
      token: CONFIG.appAccessToken,
      body: { token: state.cardTokenId },
    }
  );

  if (!ok) {
    console.log('[error] No se pudo guardar la tarjeta contra el customer. Ver respuesta arriba.');
    console.log('        (si el error dice que el token ya se usó, volvé a tokenizar la tarjeta primero)');
    return;
  }

  state.savedCardId = data.id;
  console.log(`\n✅ Tarjeta guardada. savedCardId = ${data.id} (últimos 4: ${data.last_four_digits}).`);
  console.log('   >>> Este es el id que MOVO-100 debería persistir junto al customerId,');
  console.log('       NO el card_token original (que ya se consumió acá).');

  appendToSessionLog('MOVO-100:save-card', {
    customerId: state.customerId,
    savedCardId: data.id,
    lastFourDigits: data.last_four_digits,
    cardBrand: data.payment_method?.id,
  });
}

// ----------------------------------------------------------------------------
// 8. PASO — AC1 + AC3: crear el pago con hold (capture:false) + split
// ----------------------------------------------------------------------------
//
// Este es EL paso central del spike: la documentación de MP nunca muestra
// un ejemplo que combine capture:false y application_fee en el mismo
// request — acá lo probamos de verdad.
//
// Detalle importante (AC3): el access_token usado tiene que ser el del
// TRANSPORTISTA (obtenido por OAuth en el paso anterior), no el de nuestra
// propia app — si no, MP devuelve el error 2059 "cannot use application_fee".

async function stepCreateHoldPaymentWithSplit() {
  console.log(`
--------------------------------------------------------------------------
AC1 + AC3 — Crear el pago: capture:false (hold) + application_fee (split)
--------------------------------------------------------------------------
POST /v1/payments con:
  - capture: false          -> no debita todavía, solo reserva (AC1)
  - application_fee: <N>    -> comisión de Movo a descontar (AC3, split)
  - token: card_token        -> la tarjeta del emisor que paga

IMPORTANTE: esta llamada se hace con el access_token del TRANSPORTISTA
(obtenido por OAuth), no con el nuestro — si usás el token equivocado, MP
responde con el error 2059.
`);

  if (!state.sellerAccessToken) {
    console.log('[error] Todavía no conectaste la cuenta del transportista (opción de AC2).');
    return;
  }
  if (!state.cardTokenId) {
    console.log('[error] Todavía no tokenizaste una tarjeta. Si ya usaste ese token en otro');
    console.log('        pago, generá uno nuevo (los card_token son de un solo uso).');
    return;
  }

  const idempotencyKey = crypto.randomUUID();

  const diagBody = {
    transaction_amount: CONFIG.holdAmount,
    capture: Boolean(env.DEBUG_CAPTURE_TRUE),
    installments: 1,
    token: state.cardTokenId,
    payment_method_id: CONFIG.testCard.paymentMethodId,
    description: '[SPIKE MOVO-49] hold + split de prueba',
    payer: { email: CONFIG.testPayerEmail },
  };
  if (!env.DEBUG_NO_FEE) diagBody.application_fee = CONFIG.applicationFee;
  if (env.DEBUG_NO_FEE) console.log('[diag] DEBUG_NO_FEE activo: se omite application_fee para aislar la causa del 2034.');
  if (env.DEBUG_CAPTURE_TRUE) console.log('[diag] DEBUG_CAPTURE_TRUE activo: capture:true (cobro inmediato, no hold) para aislar la causa del 2034.');

  const { ok, data } = await mpRequest('POST', '/v1/payments', {
    token: state.sellerAccessToken,
    idempotencyKey,
    body: diagBody,
  });

  if (!ok) {
    console.log('[error] MP rechazó la creación del pago. Ver respuesta arriba.');
    console.log('        Si el error es 2059 ("cannot use application_fee"): revisá que estés');
    console.log('        usando el access_token del transportista (AC2), no el de la app.');
    return;
  }

  state.holdPaymentId = data.id;

  console.log(`\n✅ Pago creado. id = ${data.id}`);
  console.log(`   status = ${data.status} / status_detail = ${data.status_detail}`);
  console.log('   Esperado: status = "authorized" (fondos reservados, todavía no cobrados).');

  appendToSessionLog('AC1+AC3:create-hold-with-split', {
    paymentId: data.id,
    status: data.status,
    statusDetail: data.status_detail,
    transactionAmount: CONFIG.holdAmount,
    applicationFee: CONFIG.applicationFee,
  });
}

// ----------------------------------------------------------------------------
// 9. PASO — AC3 (verificación): consultar el pago y ver cómo quedó repartido
// ----------------------------------------------------------------------------

async function stepInspectPayment() {
  console.log(`
--------------------------------------------------------------------------
AC3 (verificación) — Consultar el pago y revisar el desglose del split
--------------------------------------------------------------------------
GET /v1/payments/{id}. Prestar atención a:
  - collector_id             -> a qué cuenta de MP entra la plata
  - transaction_amount       -> el total que pagó el emisor
  - fee_details               -> ahí debería aparecer nuestro application_fee
  - transaction_details.net_received_amount -> lo que le queda al transportista
`);

  if (!state.holdPaymentId) {
    console.log('[error] Todavía no creaste ningún pago (opción de AC1+AC3).');
    return;
  }

  const { data } = await mpRequest('GET', `/v1/payments/${state.holdPaymentId}`, {
    token: state.sellerAccessToken || CONFIG.appAccessToken,
  });

  console.log('\nResumen legible:');
  console.log(`  status: ${data.status} / ${data.status_detail}`);
  console.log(`  collector_id: ${data.collector_id}`);
  console.log(`  transaction_amount: ${data.transaction_amount}`);
  console.log(`  fee_details: ${JSON.stringify(data.fee_details)}`);
  console.log(
    `  net_received_amount (lo que le queda al vendedor): ${data.transaction_details?.net_received_amount}`
  );

  appendToSessionLog('AC3:inspect-payment', {
    paymentId: data.id,
    status: data.status,
    collectorId: data.collector_id,
    feeDetails: data.fee_details,
    netReceivedAmount: data.transaction_details?.net_received_amount,
  });
}

// ----------------------------------------------------------------------------
// 10. PASO — AC1/AC3: capturar el hold (cobrar de verdad)
// ----------------------------------------------------------------------------

async function stepCapturePayment() {
  console.log(`
--------------------------------------------------------------------------
AC1/AC3 — Capturar el pago (cobrar el monto reservado)
--------------------------------------------------------------------------
PUT /v1/payments/{id} con { "capture": true }. Después de esto el dinero
sale de verdad de la tarjeta del emisor (en sandbox, plata ficticia) y se
reparte según el application_fee configurado al crear el hold.
`);

  if (!state.holdPaymentId) {
    console.log('[error] Todavía no creaste ningún pago (opción de AC1+AC3).');
    return;
  }

  const { ok, data } = await mpRequest('PUT', `/v1/payments/${state.holdPaymentId}`, {
    token: state.sellerAccessToken || CONFIG.appAccessToken,
    body: { capture: true },
  });

  if (!ok) {
    console.log('[error] No se pudo capturar. Ver respuesta arriba.');
    console.log('        Recordar: el plazo para capturar es 5-7 días desde la autorización.');
    return;
  }

  console.log(`\n✅ Capturado. status = ${data.status} / status_detail = ${data.status_detail}`);
  console.log('   Esperado: status = "approved".');

  appendToSessionLog('AC1+AC3:capture', {
    paymentId: data.id,
    status: data.status,
    statusDetail: data.status_detail,
  });
}

// ----------------------------------------------------------------------------
// 11. PASO — AC4: cancelar un hold (liberar fondos sin cobrar)
// ----------------------------------------------------------------------------
//
// OJO: esto solo funciona sobre un pago AUTORIZADO Y NO CAPTURADO todavía.
// Si ya usaste la opción de "Capturar" sobre el pago actual, primero creá
// un hold NUEVO (opción de AC1+AC3 otra vez) para probar la cancelación
// sobre ese, sin tocar el que ya capturaste.

async function stepCancelHold() {
  console.log(`
--------------------------------------------------------------------------
AC4 — Cancelar la autorización (liberar los fondos reservados)
--------------------------------------------------------------------------
PUT /v1/payments/{id} con { "status": "cancelled" }.
Solo tiene sentido sobre un pago que esté "authorized" y SIN capturar
todavía — si ya lo capturaste, esto no aplica (para revertir un pago ya
cobrado hace falta un reembolso, no una cancelación).
`);

  if (!state.holdPaymentId) {
    console.log('[error] Todavía no creaste ningún pago (opción de AC1+AC3).');
    return;
  }

  const { ok, data } = await mpRequest('PUT', `/v1/payments/${state.holdPaymentId}`, {
    token: state.sellerAccessToken || CONFIG.appAccessToken,
    body: { status: 'cancelled' },
  });

  if (!ok) {
    console.log('[error] No se pudo cancelar. Si el pago ya estaba "approved" (capturado),');
    console.log('        es esperado que falle acá — probá con un hold nuevo sin capturar.');
    return;
  }

  console.log(`\n✅ Cancelado. status = ${data.status}`);
  console.log('   Esperado: status = "cancelled" — los fondos vuelven al límite del emisor.');

  appendToSessionLog('AC4:cancel-hold', { paymentId: data.id, status: data.status });
}

// ----------------------------------------------------------------------------
// 12. PASO — Bonus (contiguo, no es un AC): reembolsar un pago ya capturado
// ----------------------------------------------------------------------------
//
// No estaba pedido en MOVO-49, pero es la operación "hermana" de cancelar:
// se prueba acá porque va a hacer falta pronto (devoluciones/disputas) y es
// gratis dejarlo probado ya que estamos con el mismo pago a mano.

async function stepRefundCapturedPayment() {
  console.log(`
--------------------------------------------------------------------------
Bonus (no es AC de MOVO-49) — Reembolsar un pago ya capturado
--------------------------------------------------------------------------
POST /v1/payments/{id}/refunds — para cuando el pago YA fue cobrado
(status "approved") y hay que devolver la plata. Distinto de "cancelar"
(que es antes de cobrar).
`);

  if (!state.holdPaymentId) {
    console.log('[error] Todavía no creaste ningún pago.');
    return;
  }

  const { ok, data } = await mpRequest(
    'POST',
    `/v1/payments/${state.holdPaymentId}/refunds`,
    { token: state.sellerAccessToken || CONFIG.appAccessToken, body: {} }
  );

  if (!ok) {
    console.log('[error] No se pudo reembolsar. Si el pago no estaba "approved", es esperado.');
    return;
  }

  console.log('\n✅ Reembolso creado:', JSON.stringify(data, null, 2));
  appendToSessionLog('bonus:refund', { paymentId: state.holdPaymentId, refund: data });
}

// ----------------------------------------------------------------------------
// 12b. PASOS "s1".."s9" — el mismo flujo de negocio, con el SDK oficial
// ----------------------------------------------------------------------------
//
// Reimplementación 1:1 de las opciones 1-9 de arriba, pero llamando a las
// clases del SDK (`mercadopago` de npm) en vez de armar el request a mano
// con `fetch`. El objetivo es aislar si el error 2034 (ver
// INVESTIGATION-2034.md) es un problema de CÓMO este script arma los
// requests, o algo de la cuenta/flujo en sí — el SDK es lo que realmente va
// a usar `movo-svc-payments` en producción, así que es la comparación que
// importa de verdad, no un ejercicio académico.
//
// Diferencia de diseño real encontrada al portar esto (no un capricho del
// script): `CardToken.create()` del SDK SIEMPRE manda
// `Authorization: Bearer <access_token>` — no existe forma de pedirle que
// tokenice con `public_key` y sin auth header (el modo que usa el flujo
// raw-fetch de la opción 3, necesario ahí porque el pago se cobra con el
// access_token de OTRA cuenta, la del vendedor conectado). Por eso acá se
// tokeniza directamente con el access_token del VENDEDOR conectado (no con
// el de la app): el token queda ligado a la misma cuenta que va a crear el
// pago, evitando el problema de origen (error 2006) sin necesitar el hack
// de la public_key ajena. Es, a su vez, otra variante nunca probada en la
// investigación original.

/** Arma un MercadoPagoConfig nuevo para un access_token dado. */
function sdkConfig(accessToken) {
  const { MercadoPagoConfig } = loadSdk();
  return new MercadoPagoConfig({ accessToken });
}

/**
 * Ejecuta una llamada del SDK con el mismo logging/registro que `mpRequest`
 * usa para el flujo raw-fetch, para que las dos investigaciones queden
 * igual de fáciles de comparar y de pegar en Linear.
 *
 * @param {string} label     ej: "SDK Payment.create"
 * @param {() => Promise<any>} fn  la llamada real al SDK
 */
async function sdkCall(label, fn) {
  console.log(`\n→ [SDK] ${label}`);
  try {
    const data = await fn();
    console.log('← OK');
    console.log(JSON.stringify(data, null, 2));
    return { ok: true, data };
  } catch (err) {
    const status = err.status || null;
    const causes = err.causes || err.cause || null;
    console.log(`← [SDK error] status=${status} error=${err.error || err.name}`);
    console.log(
      JSON.stringify(
        { message: err.message, status, error: err.error, causes },
        null,
        2
      )
    );
    return { ok: false, error: err, status, causes };
  }
}

async function stepSdkCheckDeferredCapture() {
  console.log(`
--------------------------------------------------------------------------
[SDK] s1 — ¿Los medios de pago de test soportan captura diferida?
--------------------------------------------------------------------------
Igual que la opción 1, pero con \`new PaymentMethod(config).get()\` en vez
de \`GET /v1/payment_methods\` a mano.
`);
  if (!loadSdk()) return;
  if (!CONFIG.appAccessToken) {
    console.log('[error] Falta MP_APP_ACCESS_TOKEN en .env — no se puede continuar.');
    return;
  }

  const { PaymentMethod } = mercadopago;
  const { ok, data } = await sdkCall('PaymentMethod.get()', () =>
    new PaymentMethod(sdkConfig(CONFIG.appAccessToken)).get()
  );
  if (!ok || !Array.isArray(data)) return;

  const target = data.find((pm) => pm.id === CONFIG.testCard.paymentMethodId);
  if (target) {
    console.log(
      `\n>>> El medio configurado (${CONFIG.testCard.paymentMethodId}) tiene deferred_capture = "${target.deferred_capture}".`
    );
  }

  appendToSessionLog('SDK:s1:deferred-capture', { paymentMethodId: CONFIG.testCard.paymentMethodId });
}

async function stepSdkConnectSellerAccount() {
  console.log(`
--------------------------------------------------------------------------
[SDK] s2 — Conectar cuenta de prueba del transportista vía OAuth
--------------------------------------------------------------------------
Igual que la opción 2 (mismo servidor local efímero esperando el redirect),
pero \`OAuth.getAuthorizationURL()\` arma la URL y \`OAuth.create()\` canjea el
code, en vez de armar la URL a mano y pegarle a POST /oauth/token con fetch.
`);
  if (!loadSdk()) return;
  if (!CONFIG.clientId || !CONFIG.clientSecret) {
    console.log('[error] Faltan MP_APP_CLIENT_ID / MP_APP_CLIENT_SECRET en .env.');
    return;
  }

  const { OAuth } = mercadopago;
  const oauth = new OAuth(sdkConfig(CONFIG.appAccessToken));

  const redirectUrl = new URL(CONFIG.redirectUri);
  const port = Number(redirectUrl.port || 8787);
  const { verifier, challenge } = generatePkcePair();
  const stateParam = crypto.randomBytes(16).toString('hex');

  const authUrl = oauth.getAuthorizationURL({
    options: {
      client_id: CONFIG.clientId,
      redirect_uri: CONFIG.redirectUri,
      state: stateParam,
      // No son parte del tipo declarado por el SDK (getAuthorizationURL solo
      // tipa client_id/state/redirect_uri), pero se agregan igual al mismo
      // objeto — el SDK arma la URL con un Object.assign genérico, así que
      // cualquier query param extra viaja sin problema. Sin esto, PKCE (que
      // sí usa el flujo raw-fetch) quedaría sin probar acá.
      code_challenge: challenge,
      code_challenge_method: 'S256',
    },
  });

  console.log('\nAbrí esta URL en el navegador (logueado con la cuenta de prueba Vendedor):\n');
  console.log(authUrl);
  console.log(`\nEsperando el redirect en ${CONFIG.redirectUri} ...`);

  const code = await waitForOAuthRedirect(port, stateParam);
  if (!code) {
    console.log('[error] No se recibió el code (¿timeout, o el state no coincidió?).');
    return;
  }

  const { ok, data } = await sdkCall('OAuth.create()', () =>
    oauth.create({
      body: {
        client_id: CONFIG.clientId,
        client_secret: CONFIG.clientSecret,
        code,
        redirect_uri: CONFIG.redirectUri,
        // code_verifier tampoco está en el tipo OAuthRequest declarado por
        // el SDK, pero create() hace lo mismo (Object.assign del body) —
        // viaja igual. Sin esto, MP rechaza el code (PKCE exige el verifier
        // que corresponde al challenge que se mandó en la URL de arriba).
        code_verifier: verifier,
        // Mismo motivo que en la opción 2 raw-fetch (ver stepConnectSellerAccount):
        // pedido explícito de soporte de MP (ticket 2034) para que el access_token
        // del vendedor conectado quede en modo TEST-.
        test_token: true,
      },
    })
  );

  if (!ok) return;

  sdkState.sellerAccessToken = data.access_token;
  sdkState.sellerUserId = data.user_id;

  const tokenPrefix = typeof data.access_token === 'string' ? data.access_token.split('-')[0] : 'unknown';
  console.log(`\n✅ Cuenta de transportista conectada (SDK). user_id = ${data.user_id}.`);
  console.log(`   access_token prefix = ${tokenPrefix}- | live_mode = ${data.live_mode}`);
  if (tokenPrefix !== 'TEST') {
    console.log(
      '   [alerta] El access_token del vendedor NO empieza con TEST- — según soporte de MP, ' +
        'esto es justamente la condición que dispara el error 2034 más adelante.'
    );
  }
  appendToSessionLog('SDK:s2:oauth-connect', {
    sellerUserId: data.user_id,
    scope: data.scope,
    expiresInSeconds: data.expires_in,
    accessTokenPrefix: tokenPrefix,
    liveMode: data.live_mode,
    testTokenRequested: true,
  });
}

async function stepSdkTokenizeCard() {
  console.log(`
--------------------------------------------------------------------------
[SDK] s3 — Tokenizar la tarjeta de prueba
--------------------------------------------------------------------------
Igual que la opción 3, pero con \`new CardToken(config).create()\`.

DIFERENCIA IMPORTANTE con la opción 3 (ver comentario de la sección "s1..s9"
más arriba): el SDK no soporta tokenizar con \`public_key\` sin
Authorization — siempre manda el access_token del \`config\` que le pasás.
Por eso acá se tokeniza con el access_token del VENDEDOR conectado (s2), no
con la Public Key de la app.
`);
  if (!loadSdk()) return;
  if (!sdkState.sellerAccessToken) {
    console.log('[error] Todavía no conectaste un transportista (opción s2) — hace falta su');
    console.log('        access_token para tokenizar acá (ver diferencia con la opción 3 arriba).');
    return;
  }

  const { CardToken } = mercadopago;
  const { ok, data } = await sdkCall('CardToken.create()', () =>
    new CardToken(sdkConfig(sdkState.sellerAccessToken)).create({
      body: {
        card_number: CONFIG.testCard.number,
        security_code: CONFIG.testCard.cvv,
        expiration_month: CONFIG.testCard.expirationMonth,
        expiration_year: CONFIG.testCard.expirationYear,
        cardholder: {
          name: CONFIG.testCard.holderName,
          identification: { type: 'DNI', number: '12345678' },
        },
      },
    })
  );

  if (!ok) return;

  sdkState.cardTokenId = data.id;
  console.log(`\n✅ card_token creado (SDK): ${data.id}`);
  appendToSessionLog('SDK:s3:tokenize-card', { cardTokenId: data.id });
}

async function stepSdkCreateHoldPaymentWithSplit() {
  console.log(`
--------------------------------------------------------------------------
[SDK] s5 — Crear pago: capture:false (hold) + application_fee (split)
--------------------------------------------------------------------------
El paso central de la investigación, con \`new Payment(config).create()\` en
vez de \`POST /v1/payments\` a mano. Mismo body que la opción 5 (capture
false real, application_fee = comisión de Movo), mismo access_token del
transportista conectado.
`);
  if (!loadSdk()) return;
  if (!sdkState.sellerAccessToken) {
    console.log('[error] Todavía no conectaste la cuenta del transportista (opción s2).');
    return;
  }
  if (!sdkState.cardTokenId) {
    console.log('[error] Todavía no tokenizaste una tarjeta (opción s3). Si ya usaste ese token');
    console.log('        en otro pago, generá uno nuevo (los card_token son de un solo uso).');
    return;
  }

  const { Payment } = mercadopago;
  const body = {
    transaction_amount: CONFIG.holdAmount,
    capture: Boolean(env.DEBUG_CAPTURE_TRUE),
    installments: 1,
    token: sdkState.cardTokenId,
    payment_method_id: CONFIG.testCard.paymentMethodId,
    description: '[SPIKE MOVO-49] hold + split de prueba (SDK)',
    payer: { email: CONFIG.testPayerEmail },
  };
  if (!env.DEBUG_NO_FEE) body.application_fee = CONFIG.applicationFee;

  const { ok, data } = await sdkCall('Payment.create()', () =>
    new Payment(sdkConfig(sdkState.sellerAccessToken)).create({
      body,
      requestOptions: { idempotencyKey: crypto.randomUUID() },
    })
  );

  if (!ok) {
    console.log('[error] MP (vía SDK) rechazó la creación del pago. Ver respuesta arriba.');
    return;
  }

  sdkState.holdPaymentId = data.id;
  console.log(`\n✅ Pago creado (SDK). id = ${data.id}`);
  console.log(`   status = ${data.status} / status_detail = ${data.status_detail}`);

  appendToSessionLog('SDK:s5:create-hold-with-split', {
    paymentId: data.id,
    status: data.status,
    statusDetail: data.status_detail,
    transactionAmount: CONFIG.holdAmount,
    applicationFee: CONFIG.applicationFee,
  });
}

async function stepSdkInspectPayment() {
  console.log(`
--------------------------------------------------------------------------
[SDK] s6 — Consultar el pago y revisar el desglose del split
--------------------------------------------------------------------------
Igual que la opción 6, con \`new Payment(config).get({ id })\`.
`);
  if (!loadSdk()) return;
  if (!sdkState.holdPaymentId) {
    console.log('[error] Todavía no creaste ningún pago (opción s5).');
    return;
  }

  const { Payment } = mercadopago;
  const { ok, data } = await sdkCall('Payment.get()', () =>
    new Payment(sdkConfig(sdkState.sellerAccessToken || CONFIG.appAccessToken)).get({
      id: sdkState.holdPaymentId,
    })
  );
  if (!ok) return;

  console.log('\nResumen legible:');
  console.log(`  status: ${data.status} / ${data.status_detail}`);
  console.log(`  collector_id: ${data.collector_id}`);
  console.log(`  transaction_amount: ${data.transaction_amount}`);
  console.log(`  fee_details: ${JSON.stringify(data.fee_details)}`);
  console.log(
    `  net_received_amount (lo que le queda al vendedor): ${data.transaction_details?.net_received_amount}`
  );

  appendToSessionLog('SDK:s6:inspect-payment', {
    paymentId: data.id,
    status: data.status,
    collectorId: data.collector_id,
    feeDetails: data.fee_details,
    netReceivedAmount: data.transaction_details?.net_received_amount,
  });
}

async function stepSdkCapturePayment() {
  console.log(`
--------------------------------------------------------------------------
[SDK] s7 — Capturar el pago (cobrar el monto reservado)
--------------------------------------------------------------------------
Igual que la opción 7, con \`new Payment(config).capture({ id })\`.
`);
  if (!loadSdk()) return;
  if (!sdkState.holdPaymentId) {
    console.log('[error] Todavía no creaste ningún pago (opción s5).');
    return;
  }

  const { Payment } = mercadopago;
  const { ok, data } = await sdkCall('Payment.capture()', () =>
    new Payment(sdkConfig(sdkState.sellerAccessToken || CONFIG.appAccessToken)).capture({
      id: sdkState.holdPaymentId,
    })
  );
  if (!ok) return;

  console.log(`\n✅ Capturado (SDK). status = ${data.status} / status_detail = ${data.status_detail}`);
  appendToSessionLog('SDK:s7:capture', { paymentId: data.id, status: data.status, statusDetail: data.status_detail });
}

async function stepSdkCancelHold() {
  console.log(`
--------------------------------------------------------------------------
[SDK] s8 — Cancelar la autorización (liberar los fondos reservados)
--------------------------------------------------------------------------
Igual que la opción 8, con \`new Payment(config).cancel({ id })\`.
`);
  if (!loadSdk()) return;
  if (!sdkState.holdPaymentId) {
    console.log('[error] Todavía no creaste ningún pago (opción s5).');
    return;
  }

  const { Payment } = mercadopago;
  const { ok, data } = await sdkCall('Payment.cancel()', () =>
    new Payment(sdkConfig(sdkState.sellerAccessToken || CONFIG.appAccessToken)).cancel({
      id: sdkState.holdPaymentId,
    })
  );
  if (!ok) {
    console.log('[error] No se pudo cancelar. Si el pago ya estaba "approved" (capturado),');
    console.log('        es esperado que falle acá — probá con un hold nuevo sin capturar.');
    return;
  }

  console.log(`\n✅ Cancelado (SDK). status = ${data.status}`);
  appendToSessionLog('SDK:s8:cancel-hold', { paymentId: data.id, status: data.status });
}

async function stepSdkRefundCapturedPayment() {
  console.log(`
--------------------------------------------------------------------------
[SDK] s9 — Reembolsar un pago ya capturado
--------------------------------------------------------------------------
Igual que la opción 9, con \`new PaymentRefund(config).total({ payment_id })\`.
`);
  if (!loadSdk()) return;
  if (!sdkState.holdPaymentId) {
    console.log('[error] Todavía no creaste ningún pago (opción s5).');
    return;
  }

  const { PaymentRefund } = mercadopago;
  const { ok, data } = await sdkCall('PaymentRefund.total()', () =>
    new PaymentRefund(sdkConfig(sdkState.sellerAccessToken || CONFIG.appAccessToken)).total({
      payment_id: sdkState.holdPaymentId,
    })
  );
  if (!ok) {
    console.log('[error] No se pudo reembolsar. Si el pago no estaba "approved", es esperado.');
    return;
  }

  console.log('\n✅ Reembolso creado (SDK):', JSON.stringify(data, null, 2));
  appendToSessionLog('SDK:s9:refund', { paymentId: sdkState.holdPaymentId, refund: data });
}

// ----------------------------------------------------------------------------
// 12c. PASOS "o1".."o6" — el mismo flujo, con la Orders API (no-legacy)
// ----------------------------------------------------------------------------
//
// Tercera variante de la misma pregunta: ¿el error 2034 depende de la API
// que usamos (Payments, la que se usó en s1-s9) o es una restricción de la
// cuenta/combinación de tipos de cuenta, sin importar la API? La Orders API
// (`POST /v1/orders`) es la API "nueva" de MP — no legacy, pensada para
// reemplazar Checkout API/Payments API a mediano plazo — y tiene las piezas
// equivalentes a lo que necesitamos:
//   - `capture_mode: "manual"` en vez de `capture: false`   -> el hold (AC1)
//   - `marketplace_fee` en vez de `application_fee`         -> el split (AC3)
//
// CAMBIO DE PLAN respecto al diseño original de este bloque: al activar la
// Orders API en el panel de la app, MP generó un PAR DE CREDENCIALES NUEVO Y
// DISTINTO (`MP_ORDERS_APP_ACCESS_TOKEN`/`MP_ORDERS_APP_PUBLIC_KEY` en
// `.env`, prefijo `APP_USR-` en vez de `TEST-` — sigue siendo de prueba, el
// modo test/real lo determina la CUENTA, no el prefijo) — y ese
// access_token ya viene atado directamente al user_id del Vendedor
// conectado. O sea que estos pasos YA NO reusan `sdkState.sellerAccessToken`
// (el de OAuth Connect, opción s2) ni `sdkState.cardTokenId` (opción s3):
// tienen su propia tokenización (o0) y usan `CONFIG.ordersAppAccessToken`
// directo, sin necesitar el paso de OAuth Connect en absoluto. Sigue siendo
// la comparación que importa (misma cuenta Vendedor, misma tarjeta de
// prueba, misma comisión) — solo cambió CÓMO se autentica esa cuenta,
// porque así es como la Orders API expone las credenciales de prueba en
// este panel.

const orderState = {
  cardTokenId: null,
  orderId: null,
};

async function stepOrdersTokenizeCard() {
  console.log(`
--------------------------------------------------------------------------
[Orders API] o0 — Tokenizar la tarjeta de prueba (credenciales de Orders API)
--------------------------------------------------------------------------
Igual que s3, pero con las credenciales separadas de Orders API
(MP_ORDERS_APP_ACCESS_TOKEN) — los card_token de s3 están ligados a la app
de Payments API y no necesariamente sirven acá.
`);
  if (!loadSdk()) return;
  if (!CONFIG.ordersAppAccessToken) {
    console.log('[error] Falta MP_ORDERS_APP_ACCESS_TOKEN en .env.');
    return;
  }

  const { CardToken } = mercadopago;
  const { ok, data } = await sdkCall('CardToken.create() [Orders API creds]', () =>
    new CardToken(sdkConfig(CONFIG.ordersAppAccessToken)).create({
      body: {
        card_number: CONFIG.testCard.number,
        security_code: CONFIG.testCard.cvv,
        expiration_month: CONFIG.testCard.expirationMonth,
        expiration_year: CONFIG.testCard.expirationYear,
        cardholder: {
          name: CONFIG.testCard.holderName,
          identification: { type: 'DNI', number: '12345678' },
        },
      },
    })
  );
  if (!ok) return;

  orderState.cardTokenId = data.id;
  console.log(`\n✅ card_token creado (Orders API): ${data.id}`);
  appendToSessionLog('Orders:o0:tokenize-card', { cardTokenId: data.id });
}

async function stepOrdersCreate() {
  console.log(`
--------------------------------------------------------------------------
[Orders API] o1 — Crear la orden: capture_mode:"manual" (hold) + marketplace_fee (split)
--------------------------------------------------------------------------
POST /v1/orders con:
  - capture_mode: "manual"    -> no debita todavía, solo reserva (equivalente a AC1)
  - marketplace_fee: <N>      -> comisión de Movo a descontar (equivalente a AC3)
  - transactions.payments[0].payment_method.token -> la tarjeta del emisor

Usa MP_ORDERS_APP_ACCESS_TOKEN directo (ya representa al Vendedor, no hace
falta OAuth Connect acá) y el card_token de la opción o0 — si ya se
consumió en otro intento, corré o0 de nuevo.
`);
  if (!loadSdk()) return;
  if (!CONFIG.ordersAppAccessToken) {
    console.log('[error] Falta MP_ORDERS_APP_ACCESS_TOKEN en .env.');
    return;
  }
  if (!orderState.cardTokenId) {
    console.log('[error] Todavía no tokenizaste una tarjeta (opción o0). Si ya usaste ese token');
    console.log('        en otro intento, generá uno nuevo (los card_token son de un solo uso).');
    return;
  }

  const { Order } = mercadopago;
  const amount = String(CONFIG.holdAmount);
  const body = {
    type: 'online',
    total_amount: amount,
    external_reference: `spike-movo-49-orders-${Date.now()}`,
    payer: { email: CONFIG.testPayerEmail },
    transactions: {
      payments: [
        {
          amount,
          payment_method: {
            id: CONFIG.testCard.paymentMethodId,
            type: 'credit_card',
            token: orderState.cardTokenId,
            installments: 1,
          },
        },
      ],
    },
  };
  // Flags de diagnóstico (mismo criterio que DEBUG_NO_FEE/DEBUG_CAPTURE_TRUE
  // del flujo de Payments API) para aislar qué campo dispara el 422
  // "unprocessable_content" — el error no trae detalle de campo, así que se
  // arma el body incremental en vez de todo junto a la primera.
  if (!env.DEBUG_ORDERS_NO_CAPTURE_MODE) body.capture_mode = 'manual';
  if (!env.DEBUG_ORDERS_NO_FEE) body.marketplace_fee = String(CONFIG.applicationFee);
  if (env.DEBUG_ORDERS_NO_CAPTURE_MODE) console.log('[diag] DEBUG_ORDERS_NO_CAPTURE_MODE activo: se omite capture_mode.');
  if (env.DEBUG_ORDERS_NO_FEE) console.log('[diag] DEBUG_ORDERS_NO_FEE activo: se omite marketplace_fee.');

  const { ok, data } = await sdkCall('Order.create()', () =>
    new Order(sdkConfig(CONFIG.ordersAppAccessToken)).create({
      body,
      requestOptions: { idempotencyKey: crypto.randomUUID() },
    })
  );

  if (!ok) {
    console.log('[error] MP (Orders API) rechazó la creación de la orden. Ver respuesta arriba.');
    // El SDK arma su MercadoPagoError leyendo body.message/body.error/body.cause
    // (el shape de errores de Payments API) — si el body real de Orders API
    // usa otro shape (ej. RFC7807: type/title/detail, o "errors" en plural),
    // esos campos quedan vacíos/undefined y el error impreso arriba no dice
    // nada útil. Para no quedarnos a ciegas, reintentamos la MISMA llamada
    // con fetch crudo (mismo helper que usan las opciones 1-9) solo para ver
    // el body real tal cual lo manda MP, sin el parseo del SDK de por medio.
    console.log('\n[diag] Reintentando con fetch crudo para ver el body real del error (el SDK puede estar parseándolo con el shape equivocado):');
    await mpRequest('POST', '/v1/orders', {
      token: CONFIG.ordersAppAccessToken,
      idempotencyKey: crypto.randomUUID(),
      body,
    });
    return;
  }

  orderState.orderId = data.id;
  console.log(`\n✅ Orden creada. id = ${data.id}`);
  console.log(`   status = ${data.status} / status_detail = ${data.status_detail}`);
  console.log('   Si status sigue en "created" (no se procesó sola), correr la opción o2.');

  appendToSessionLog('Orders:o1:create', {
    orderId: data.id,
    status: data.status,
    statusDetail: data.status_detail,
    totalAmount: amount,
    marketplaceFee: CONFIG.applicationFee,
  });
}

async function stepOrdersProcess() {
  console.log(`
--------------------------------------------------------------------------
[Orders API] o2 — Procesar la orden (ejecutar el pago de la transacción)
--------------------------------------------------------------------------
POST /v1/orders/{id}/process. Según la doc del SDK, hace falta cuando la
orden se creó con transacciones pero todavía no se ejecutó el pago (queda
en "created"). Si o1 ya devolvió un status procesado, este paso no hace
falta — probarlo igual no debería romper nada.
`);
  if (!loadSdk()) return;
  if (!orderState.orderId) {
    console.log('[error] Todavía no creaste ninguna orden (opción o1).');
    return;
  }

  const { Order } = mercadopago;
  const { ok, data } = await sdkCall('Order.process()', () =>
    new Order(sdkConfig(CONFIG.ordersAppAccessToken)).process({ id: orderState.orderId })
  );
  if (!ok) return;

  console.log(`\n✅ Orden procesada. status = ${data.status} / status_detail = ${data.status_detail}`);
  appendToSessionLog('Orders:o2:process', { orderId: data.id, status: data.status, statusDetail: data.status_detail });
}

async function stepOrdersGet() {
  console.log(`
--------------------------------------------------------------------------
[Orders API] o3 — Consultar la orden
--------------------------------------------------------------------------
GET /v1/orders/{id}. Prestar atención a \`transactions\` (ahí vive el/los
pagos reales, con su propio status) y a \`marketplace_fee\`.
`);
  if (!loadSdk()) return;
  if (!orderState.orderId) {
    console.log('[error] Todavía no creaste ninguna orden (opción o1).');
    return;
  }

  const { Order } = mercadopago;
  const { ok, data } = await sdkCall('Order.get()', () =>
    new Order(sdkConfig(CONFIG.ordersAppAccessToken)).get({ id: orderState.orderId })
  );
  if (!ok) return;

  console.log('\nResumen legible:');
  console.log(`  status: ${data.status} / ${data.status_detail}`);
  console.log(`  total_amount: ${data.total_amount} / marketplace_fee: ${data.marketplace_fee}`);
  console.log(`  transactions: ${JSON.stringify(data.transactions)}`);

  appendToSessionLog('Orders:o3:get', {
    orderId: data.id,
    status: data.status,
    marketplaceFee: data.marketplace_fee,
    transactions: data.transactions,
  });
}

async function stepOrdersCapture() {
  console.log(`
--------------------------------------------------------------------------
[Orders API] o4 — Capturar la orden (cobrar el monto reservado)
--------------------------------------------------------------------------
POST /v1/orders/{id}/capture — equivalente a la opción s7, solo aplica a
órdenes creadas con capture_mode:"manual".
`);
  if (!loadSdk()) return;
  if (!orderState.orderId) {
    console.log('[error] Todavía no creaste ninguna orden (opción o1).');
    return;
  }

  const { Order } = mercadopago;
  const { ok, data } = await sdkCall('Order.capture()', () =>
    new Order(sdkConfig(CONFIG.ordersAppAccessToken)).capture({ id: orderState.orderId })
  );
  if (!ok) return;

  console.log(`\n✅ Capturada. status = ${data.status} / status_detail = ${data.status_detail}`);
  appendToSessionLog('Orders:o4:capture', { orderId: data.id, status: data.status, statusDetail: data.status_detail });
}

async function stepOrdersCancel() {
  console.log(`
--------------------------------------------------------------------------
[Orders API] o5 — Cancelar la orden (liberar los fondos reservados)
--------------------------------------------------------------------------
POST /v1/orders/{id}/cancel — equivalente a la opción s8. Solo tiene
sentido sobre una orden autorizada y sin capturar todavía.
`);
  if (!loadSdk()) return;
  if (!orderState.orderId) {
    console.log('[error] Todavía no creaste ninguna orden (opción o1).');
    return;
  }

  const { Order } = mercadopago;
  const { ok, data } = await sdkCall('Order.cancel()', () =>
    new Order(sdkConfig(CONFIG.ordersAppAccessToken)).cancel({ id: orderState.orderId })
  );
  if (!ok) {
    console.log('[error] No se pudo cancelar. Si ya estaba capturada, es esperado que falle acá.');
    return;
  }

  console.log(`\n✅ Cancelada. status = ${data.status}`);
  appendToSessionLog('Orders:o5:cancel', { orderId: data.id, status: data.status });
}

async function stepOrdersRefund() {
  console.log(`
--------------------------------------------------------------------------
[Orders API] o6 — Reembolsar una orden ya capturada
--------------------------------------------------------------------------
POST /v1/orders/{id}/refund (sin body = reembolso total) — equivalente a
la opción s9.
`);
  if (!loadSdk()) return;
  if (!orderState.orderId) {
    console.log('[error] Todavía no creaste ninguna orden (opción o1).');
    return;
  }

  const { Order } = mercadopago;
  const { ok, data } = await sdkCall('Order.refund()', () =>
    new Order(sdkConfig(CONFIG.ordersAppAccessToken)).refund({ id: orderState.orderId, body: {} })
  );
  if (!ok) {
    console.log('[error] No se pudo reembolsar. Si la orden no estaba capturada, es esperado.');
    return;
  }

  console.log('\n✅ Reembolso creado:', JSON.stringify(data, null, 2));
  appendToSessionLog('Orders:o6:refund', { orderId: orderState.orderId, refund: data });
}

// ----------------------------------------------------------------------------
// 13. Resumen de la sesión (para copiar a Linear)
// ----------------------------------------------------------------------------

function printSessionSummary() {
  console.log(`
============================================================================
Resumen de esta sesión (también quedó guardado en session-log.json)
============================================================================`);
  if (sessionLog.length === 0) {
    console.log('(todavía no se corrió ningún paso)');
    return;
  }
  for (const entry of sessionLog) {
    console.log(`\n[${entry.at}] ${entry.step}`);
    console.log(JSON.stringify(entry.summary, null, 2));
  }
  console.log(`\nArchivo completo: ${SESSION_LOG_PATH}`);
  console.log('(este archivo NO tiene tokens ni números de tarjeta — se puede pegar en Linear)');
}

// ----------------------------------------------------------------------------
// 14. Menú de consola
// ----------------------------------------------------------------------------

const MENU = [
  { key: '1', label: 'AC1 (prerreq.) — Ver qué medios de pago soportan captura diferida', run: stepCheckDeferredCapture },
  { key: '2', label: 'AC2 — Conectar cuenta de transportista vía OAuth (MP Connect)', run: stepConnectSellerAccount },
  { key: '2b', label: '[MOVO-111] ¿MP acepta redirect_uri de esquema custom (deep link)?', run: stepTestDeepLinkRedirect },
  { key: '3', label: 'Tokenizar la tarjeta de prueba (necesario antes del paso 4/5)', run: stepTokenizeCard },
  { key: '4', label: '[MOVO-100] Crear customer + guardar tarjeta (id estable, reusable)', run: stepCreateCustomerAndSaveCard },
  { key: '5', label: 'AC1+AC3 — Crear pago: capture:false + application_fee (split)', run: stepCreateHoldPaymentWithSplit },
  { key: '6', label: 'AC3 — Consultar el pago (ver cómo quedó repartido el split)', run: stepInspectPayment },
  { key: '7', label: 'AC1/AC3 — Capturar el pago (cobrar de verdad)', run: stepCapturePayment },
  { key: '8', label: 'AC4 — Cancelar el hold (liberar fondos sin cobrar)', run: stepCancelHold },
  { key: '9', label: '[bonus] Reembolsar un pago ya capturado', run: stepRefundCapturedPayment },
  { key: 's1', label: '[SDK] Igual que 1 — deferred_capture, con PaymentMethod.get()', run: stepSdkCheckDeferredCapture },
  { key: 's2', label: '[SDK] Igual que 2 — OAuth Connect, con la clase OAuth', run: stepSdkConnectSellerAccount },
  { key: 's3', label: '[SDK] Igual que 3 — Tokenizar tarjeta, con CardToken.create()', run: stepSdkTokenizeCard },
  { key: 's5', label: '[SDK] Igual que 5 — crear pago capture:false + application_fee', run: stepSdkCreateHoldPaymentWithSplit },
  { key: 's6', label: '[SDK] Igual que 6 — consultar el pago', run: stepSdkInspectPayment },
  { key: 's7', label: '[SDK] Igual que 7 — capturar el pago', run: stepSdkCapturePayment },
  { key: 's8', label: '[SDK] Igual que 8 — cancelar el hold', run: stepSdkCancelHold },
  { key: 's9', label: '[SDK] Igual que 9 — reembolsar un pago capturado', run: stepSdkRefundCapturedPayment },
  { key: 'o0', label: '[Orders API] Tokenizar tarjeta (credenciales propias de Orders API)', run: stepOrdersTokenizeCard },
  { key: 'o1', label: '[Orders API] Crear orden: capture_mode manual + marketplace_fee', run: stepOrdersCreate },
  { key: 'o2', label: '[Orders API] Procesar la orden (si hace falta)', run: stepOrdersProcess },
  { key: 'o3', label: '[Orders API] Consultar la orden', run: stepOrdersGet },
  { key: 'o4', label: '[Orders API] Capturar la orden', run: stepOrdersCapture },
  { key: 'o5', label: '[Orders API] Cancelar la orden', run: stepOrdersCancel },
  { key: 'o6', label: '[Orders API] Reembolsar una orden capturada', run: stepOrdersRefund },
  { key: 'r', label: 'Ver resumen de la sesión (para pegar en Linear)', run: async () => printSessionSummary() },
  { key: 'q', label: 'Salir', run: null },
];

function printMenu() {
  console.log(`
============================================================================
 Mercado Pago — Spike MOVO-49 / MOVO-100
============================================================================
 Sugerencia: la primera vez, seguir el orden 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.
----------------------------------------------------------------------------`);
  for (const item of MENU) {
    console.log(`  [${item.key}] ${item.label}`);
  }
  console.log('----------------------------------------------------------------------------');
}

async function main() {
  console.log('Config cargada desde .env (ver .env.example si falta algo):');
  console.log(`  appAccessToken: ${CONFIG.appAccessToken ? '(configurado)' : '(FALTA)'}`);
  console.log(`  clientId/clientSecret: ${CONFIG.clientId && CONFIG.clientSecret ? '(configurado)' : '(FALTA)'}`);
  console.log(`  redirectUri: ${CONFIG.redirectUri}`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    printMenu();
    const choice = (await ask('Elegí una opción: ')).trim().toLowerCase();
    const item = MENU.find((m) => m.key === choice);

    if (!item) {
      console.log('Opción inválida.');
      continue;
    }
    if (item.key === 'q') break;

    try {
      await item.run();
    } catch (err) {
      console.error('\n[excepción no controlada]', err);
    }
  }

  rl.close();
  console.log('\nChau. Revisá session-log.json para el detalle de lo que se probó.');
}

main();
