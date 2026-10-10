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
  MP_HOLD_VALIDITY_DAYS: number;
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
    // MOVO-209 AC4: cuánto sostiene MP un hold sin capturar, y de ahí el `expires_at`
    // que se persiste. Configuración y no constante en el código: el valor real sale
    // de la medición de MOVO-215 (la documentación de MP dice 5 o 7 días según la
    // página). 5 es el mínimo de los documentados: provisorio hasta que cierre el spike.
    MP_HOLD_VALIDITY_DAYS: { type: "number", minimum: 1, default: 5 },
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
