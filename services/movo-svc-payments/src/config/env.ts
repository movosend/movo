export interface EnvConfig {
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  MP_CLIENT_ID?: string;
  MP_CLIENT_SECRET?: string;
  MP_REDIRECT_URI?: string;
  MP_WEBHOOK_SECRET?: string;
  MP_TOKEN_ENCRYPTION_KEY?: string;
  MP_TEST_MODE: boolean;
  MP_COLLECTOR_ACCESS_TOKEN?: string;
  MP_COLLECTOR_PUBLIC_KEY?: string;
  MP_COLLECTOR_MP_USER_ID?: string;
  MP_HOLD_VALIDITY_DAYS: number;
  DEBT_COLLECTION_MAX_RATE: number;
  ADMIN_LEDGER_ADJUSTMENT_MAX_ARS: number;
  MP_TRANSACTION_FEE_RATE: number;
  MP_TOKEN_REFRESH_SWEEP_ENABLED: boolean;
  MP_TOKEN_REFRESH_SWEEP_INTERVAL_MINUTES: number;
  MP_TOKEN_REFRESH_WINDOW_DAYS: number;

  MP_PUBLIC_KEY?: string;
  MP_TEST_PAYER_EMAILS?: string;
  USERS_SERVICE_URL: string;
  SHIPMENTS_SERVICE_URL: string;
  MP_WEBHOOK_MAX_ATTEMPTS: number;
  MP_WEBHOOK_SWEEP_INTERVAL_MINUTES: number;
  MP_WEBHOOK_SWEEP_ENABLED: boolean;
  SETTLEMENT_RETRY_DELAYS_MINUTES: string;
  SETTLEMENT_RETRY_SWEEP_ENABLED: boolean;
  SETTLEMENT_RETRY_SWEEP_INTERVAL_MINUTES: number;
  ALERT_PROVIDER: "console" | "telegram";
  ALERT_TELEGRAM_BOT_TOKEN?: string;
  ALERT_TELEGRAM_CHAT_ID?: string;
  ALERT_ENVIRONMENT_LABEL?: string;
}

export const envSchema = {
  type: "object",
  required: ["DATABASE_URL", "REDIS_URL", "JWT_SECRET"],
  properties: {
    PORT: { type: "number", default: 3000 },
    DATABASE_URL: { type: "string" },
    REDIS_URL: { type: "string" },
    JWT_SECRET: { type: "string" },
    // MOVO-267: credenciales de la app de Mercado Pago (Marketplace) por ambiente.
    // Opcionales en el schema (mismo criterio que DIDIT_* en movo-svc-users): el
    // servicio levanta sin ellas en dev/test/CI, y el código que las use (canje
    // OAuth en MOVO-111, firma del webhook en MOVO-268) falla explícito si faltan.
    // No hay access token de la app: el canje del code no lo necesita
    // (docs/payments/mercadopago-spike/SOLUCION-FINAL.md §4), y los pagos se
    // crean con el access_token OAuth de cada transportista.
    MP_CLIENT_ID: { type: "string" },
    MP_CLIENT_SECRET: { type: "string" },
    MP_REDIRECT_URI: { type: "string" },
    MP_WEBHOOK_SECRET: { type: "string" },
    // Review de PR #223 (MOVO-111): key de AES-256-GCM para cifrar los tokens OAuth
    // de los transportistas en la base (`utils/token-cipher.ts`). Base64 de 32 bytes
    // (`openssl rand -base64 32`), una distinta por ambiente. Opcional como el resto:
    // sin ella, vincular responde 503 MP_CONNECT_NOT_CONFIGURED.
    MP_TOKEN_ENCRYPTION_KEY: { type: "string" },
    // Solo sandbox: agrega `test_token: true` al canje de OAuth para que MP
    // devuelva un access_token TEST- del vendedor de prueba.
    MP_TEST_MODE: { type: "boolean", default: false },
    // ADR-048: la cuenta de MP de Movo S.A. que cobra los pagos de saldo (MOVO-312). En producción, el Access Token y la
    // Public Key productivos de su panel; en el sandbox, el token TEST- del OAuth de la cuenta de prueba (un token de la
    // app sin login no puede crear pagos). El user id identifica sus notificaciones del webhook. Sin las tres, pagar el
    // saldo responde 503 BALANCE_COLLECTOR_NOT_CONFIGURED.
    MP_COLLECTOR_ACCESS_TOKEN: { type: "string" },
    MP_COLLECTOR_PUBLIC_KEY: { type: "string" },
    MP_COLLECTOR_MP_USER_ID: { type: "string" },
    // MOVO-209 AC4: cuánto sostiene MP un hold sin capturar, y de ahí el `expires_at`
    // que se persiste. Configuración y no constante en el código. 5 es el mínimo que
    // documenta MP (5 o 7 según la página): el sandbox no vence holds, así que la
    // medición de MOVO-215 no lo pudo confirmar (ADR-050).
    MP_HOLD_VALIDITY_DAYS: { type: "number", minimum: 1, default: 5 },
    // MOVO-311: cuánto de la deuda de la cuenta corriente se cobra en un hold, como fracción del
    // precio del envío (descuento al transportista y recargo al emisor, cada uno con este tope). El
    // máximo de 0.5 garantiza `application_fee < transaction_amount` (si no, MP responde 4038).
    DEBT_COLLECTION_MAX_RATE: { type: "number", minimum: 0, maximum: 0.5, default: 0.3 },
    // MOVO-294: tope (en valor absoluto) de un ajuste manual de saldo desde el panel. Nunca por encima
    // del tope general de un movimiento (`LEDGER_MAX_ABS_AMOUNT_ARS`, 10M).
    ADMIN_LEDGER_ADJUSTMENT_MAX_ARS: { type: "number", minimum: 1, maximum: 10000000, default: 500000 },
    // Estimado de la comisión de MP (fracción del monto, 0.0499 = 4,99%). La lee `@movo/shared` desde
    // `process.env` (define el `application_fee` de la deuda del emisor y el "Recibís aprox."): se valida acá
    // para que un `4.99` en vez de `0.0499` corte el arranque en vez de cobrar mal.
    MP_TRANSACTION_FEE_RATE: { type: "number", minimum: 0, maximum: 1, default: 0.0499 },
    // MOVO-243: renovación de los tokens OAuth de los transportistas (el access_token de
    // MP dura 180 días). El barrido corre cada hora y renueva lo que vence dentro de la
    // ventana: 30 días dan margen para que un MP caído o un fallo transitorio se
    // reintente muchas veces antes de que un token venza de verdad.
    MP_TOKEN_REFRESH_SWEEP_ENABLED: { type: "boolean", default: true },
    MP_TOKEN_REFRESH_SWEEP_INTERVAL_MINUTES: { type: "number", minimum: 1, default: 60 },
    MP_TOKEN_REFRESH_WINDOW_DAYS: { type: "number", minimum: 1, default: 30 },

    // MOVO-100 (ADR-039): `public_key` con la que el mobile tokeniza la tarjeta al guardarla.
    // Solo genera el token de un solo uso: la tarjeta queda siempre en un customer de Movo S.A.
    // (token de client_credentials), sin importar de quién sea esta key. En sandbox tiene que
    // ser una `TEST-` (la `APP_USR-` da 404 card not found): en dev se usa la de un Vendedor de
    // prueba, porque la consola de `movosend` no muestra una `TEST-` de Movo. En producción
    // se espera la de Movo (pendiente de confirmar, spike MOVO-283). Opcional como el resto de
    // las MP_*: sin ella `checkout-data` responde 503 CARDS_NOT_CONFIGURED.
    MP_PUBLIC_KEY: { type: "string" },
    // MOVO-100, solo sandbox (`MP_TEST_MODE=true`): JSON `{"<userId de Movo>": "<email de una
    // cuenta de prueba Comprador>"}`. En sandbox el customer tiene que usar el email de un
    // Comprador de prueba (con otro, MP responde 225), y la cuenta de Movo de cada tester
    // tiene su email real. Fuera de test mode se ignora.
    MP_TEST_PAYER_EMAILS: { type: "string" },
    // MOVO-100: el email del customer sale de `svc-users` (GET /users/me, ADR-010). El
    // default ya es el nombre del servicio en movo-net, mismo criterio que en svc-shipments.
    USERS_SERVICE_URL: { type: "string", default: "http://movo-svc-users:3000" },
    // MOVO-268: a quién avisarle que MP canceló o venció un hold
    // (`POST /internal/shipments/:id/hold-events`). El default es el nombre del servicio
    // en la red de Docker, mismo criterio que PAYMENTS_SERVICE_URL en svc-shipments.
    SHIPMENTS_SERVICE_URL: { type: "string", default: "http://movo-svc-shipments:3000" },
    // MOVO-268: reintentos del procesamiento de una notificación del webhook (backoff
    // exponencial 1, 2, 4... min hasta 6 h). Con 10 intentos se insiste ~8 h; después la
    // notificación queda `failed` y se alerta al equipo.
    MP_WEBHOOK_MAX_ATTEMPTS: { type: "number", minimum: 1, default: 10 },
    MP_WEBHOOK_SWEEP_INTERVAL_MINUTES: { type: "number", minimum: 0, default: 1 },
    MP_WEBHOOK_SWEEP_ENABLED: { type: "boolean", default: true },
    // MOVO-213 (AC2): reintentos de una captura fallida tras la entrega. Cada valor es la espera (en minutos)
    // antes del reintento N; su largo es el máximo de reintentos (3 con el default) y, agotados, la
    // liquidación pasa a `escalated` y se alerta al equipo. Un fallo que reintentar no arregla escala sin gastarlos.
    SETTLEMENT_RETRY_DELAYS_MINUTES: { type: "string", default: "5,30,120" },
    SETTLEMENT_RETRY_SWEEP_ENABLED: { type: "boolean", default: true },
    SETTLEMENT_RETRY_SWEEP_INTERVAL_MINUTES: { type: "number", minimum: 1, default: 1 },
    // MOVO-268: alertas al equipo (contracargos, holds perdidos con el paquete en camino,
    // notificaciones que no se pudieron procesar). `console` = solo log (dev/test/CI);
    // `telegram` = además al chat del equipo. La reusa MOVO-213 (`settlement_escalated`).
    ALERT_PROVIDER: { type: "string", enum: ["console", "telegram"], default: "console" },
    ALERT_TELEGRAM_BOT_TOKEN: { type: "string" },
    ALERT_TELEGRAM_CHAT_ID: { type: "string" },
    // Prefijo de cada alerta (`dev`, `prod`) para distinguir ambientes en el mismo chat.
    ALERT_ENVIRONMENT_LABEL: { type: "string" },
  },
};

declare module "fastify" {
  interface FastifyInstance {
    config: EnvConfig;
  }
}

export type MercadoPagoSecretName =
  | "MP_CLIENT_ID"
  | "MP_CLIENT_SECRET"
  | "MP_REDIRECT_URI"
  | "MP_WEBHOOK_SECRET"
  | "MP_TOKEN_ENCRYPTION_KEY";

/**
 * Las credenciales de MP son opcionales en el schema y Compose las inyecta como string
 * vacío cuando no están cargadas, así que "vacío" equivale a "no configurado". Todo
 * código que las use (canje OAuth en MOVO-111, firma del webhook en MOVO-268) tiene que
 * leerlas por acá: un secreto vacío jamás puede llegar a una comparación de firma.
 */
export function requireMercadoPagoSecret(config: EnvConfig, name: MercadoPagoSecretName): string {
  const value = config[name];
  if (!value) {
    throw new Error(`${name} no está configurada: cargala en el secret del ambiente.`);
  }
  return value;
}
