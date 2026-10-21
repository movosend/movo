// ADR-048: OAuth de la cuenta cobradora de dev (cuenta de prueba Movo S.A.), sin usuario de Movo. Renueva el token TEST-
// cuando vence (180 días). Uso, desde la raíz del repo (las credenciales van por stdin, nunca a disco):
//   aws secretsmanager get-secret-value --secret-id movo/dev/app-secrets --query SecretString --output text \
//     | node services/movo-svc-payments/scripts/collector-oauth.mjs start
// Abrir la URL en una ventana normal (incógnito bloquea las cookies que usa MP), entrar como Movo S.A. y tomar el `code`
// del callback de dev (redirige a movo:// con STATE_INVALID sin canjearlo; queda en el historial). Después, con el mismo
// pipe: `... | node services/movo-svc-payments/scripts/collector-oauth.mjs finish <code> --save` (dentro de ~10 minutos).
//
//   start:  stdin = secret de dev → imprime la URL de autorización (guarda state + code_verifier, que solos no sirven).
//   finish: stdin = secret de dev, argv[3] = code → canjea con test_token y prueba dos cobros en el sandbox.
//           Con --save, si los dos aprueban, guarda los tokens en movo/dev/app-secrets (por stdin al CLI de AWS, nunca a disco).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const DIR = new URL(".", import.meta.url).pathname;
const PKCE = `${DIR}.collector-oauth-pkce.json`;
const API = "https://api.mercadopago.com";
const BUYER = "test_user_4715592661702347785@testuser.com";
const CARD = {
  card_number: "4075595716483764", security_code: "123", expiration_month: 11, expiration_year: 2030,
  cardholder: { name: "APRO", identification: { type: "DNI", number: "12345678" } },
};
const mask = (s) => (s ? `${String(s).slice(0, 9)}…` : s);

let raw = "";
for await (const c of process.stdin) raw += c;
const secret = JSON.parse(raw);

if (process.argv[2] === "start") {
  const codeVerifier = randomBytes(48).toString("base64url");
  const state = randomBytes(16).toString("hex");
  fs.writeFileSync(PKCE, JSON.stringify({ codeVerifier, state }));
  const params = new URLSearchParams({
    client_id: secret.MP_CLIENT_ID, response_type: "code", platform_id: "mp", state,
    redirect_uri: secret.MP_REDIRECT_URI, scope: "offline_access",
    code_challenge: createHash("sha256").update(codeVerifier).digest("base64url"), code_challenge_method: "S256",
  });
  console.log(`https://auth.mercadopago.com.ar/authorization?${params}`);
  process.exit(0);
}

const code = process.argv[3];
const save = process.argv.includes("--save");
const { codeVerifier } = JSON.parse(fs.readFileSync(PKCE, "utf8"));
const res = await fetch(`${API}/oauth/token`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    client_id: secret.MP_CLIENT_ID, client_secret: secret.MP_CLIENT_SECRET, grant_type: "authorization_code",
    code, redirect_uri: secret.MP_REDIRECT_URI, code_verifier: codeVerifier, test_token: true,
  }),
});
const tok = await res.json();
console.log("canje", res.status, {
  access_token: mask(tok.access_token), refresh_token: Boolean(tok.refresh_token), public_key: mask(tok.public_key),
  user_id: tok.user_id, expires_in: tok.expires_in, error: tok.error, message: tok.message,
});
if (!tok.access_token?.startsWith("TEST-")) process.exit(1);

const show = (label, r, j) => console.log(label, r.status, JSON.stringify({
  id: j.id, status: j.status, status_detail: j.status_detail, live_mode: j.live_mode, collector_id: j.collector_id, message: j.message, cause: j.cause,
}));
const asCollector = { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" };
async function cardToken(body) {
  const r = await fetch(`${API}/v1/card_tokens?public_key=${tok.public_key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  show("  card_token", r, j);
  return j.id;
}
async function pay(label, token, payer) {
  const r = await fetch(`${API}/v1/payments`, {
    method: "POST", headers: { ...asCollector, "X-Idempotency-Key": randomUUID() },
    body: JSON.stringify({ transaction_amount: 100, token, installments: 1, description: "Prueba cobradora Movo", payer }),
  });
  const j = await r.json();
  show(label, r, j);
  return j.status === "approved";
}

console.log("\n1) Tarjeta completa, cobra la cuenta cobradora");
const ok1 = await pay("  payment", await cardToken(CARD), { email: BUYER });

console.log("\n2) Tarjeta guardada en el customer de Movo S.A. + CVV (flujo de la app)");
const app = await (await fetch(`${API}/oauth/token`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ grant_type: "client_credentials", client_id: secret.MP_CLIENT_ID, client_secret: secret.MP_CLIENT_SECRET, test_token: "true" }),
})).json();
const asMovo = { Authorization: `Bearer ${app.access_token}`, "Content-Type": "application/json" };
let customer = (await (await fetch(`${API}/v1/customers/search?email=${encodeURIComponent(BUYER)}`, { headers: asMovo })).json()).results?.[0];
if (!customer) {
  const r = await fetch(`${API}/v1/customers`, { method: "POST", headers: asMovo, body: JSON.stringify({ email: BUYER }) });
  customer = await r.json();
  show("  customer nuevo", r, customer);
}
const saveRes = await fetch(`${API}/v1/customers/${customer.id}/cards`, { method: "POST", headers: asMovo, body: JSON.stringify({ token: await cardToken(CARD) }) });
const saved = await saveRes.json();
show("  tarjeta guardada", saveRes, saved);
let ok2 = false;
if (saved.id) {
  ok2 = await pay("  payment", await cardToken({ card_id: saved.id, security_code: "123" }), { type: "customer", id: customer.id });
  const del = await fetch(`${API}/v1/customers/${customer.id}/cards/${saved.id}`, { method: "DELETE", headers: asMovo });
  console.log("  tarjeta de prueba borrada", del.status);
}

fs.rmSync(PKCE);
if (!(ok1 && ok2)) {
  console.log("\nNo se guardan los tokens: alguna prueba no aprobó.");
  process.exit(1);
}
if (!save) {
  console.log("\nLas dos pruebas aprobaron. Sin --save no se guardó nada (el code ya se gastó).");
  process.exit(0);
}
const current = JSON.parse(spawnSync("aws", ["secretsmanager", "get-secret-value", "--secret-id", "movo/dev/app-secrets", "--query", "SecretString", "--output", "text"], { encoding: "utf8" }).stdout);
Object.assign(current, {
  MP_COLLECTOR_ACCESS_TOKEN: tok.access_token, MP_COLLECTOR_REFRESH_TOKEN: tok.refresh_token,
  MP_COLLECTOR_PUBLIC_KEY: tok.public_key, MP_COLLECTOR_MP_USER_ID: String(tok.user_id),
});
const put = spawnSync("aws", ["secretsmanager", "put-secret-value", "--secret-id", "movo/dev/app-secrets", "--secret-string", "file:///dev/stdin"], { input: JSON.stringify(current), encoding: "utf8" });
console.log("\nGuardado en movo/dev/app-secrets:", put.status === 0 ? "ok" : put.stderr);
