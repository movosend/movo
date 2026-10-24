import type { FastifyBaseLogger } from "fastify";
import type { EnvConfig } from "../config/env";

/**
 * MOVO-334: copia mínima del `AlertNotifier` de `svc-payments` (MOVO-268), para avisarle al
 * equipo que una parte abrió una disputa. Se replica en vez de moverlo a `@movo/shared` para
 * que shared siga sin código de I/O; si las dos copias divergen, unificarlas ahí.
 *
 * Solo ids, estados y motivos: nunca emails, teléfonos ni la descripción de la disputa.
 * Mandar una alerta nunca tira: si Telegram falla se loguea y el caller sigue.
 */
export interface TeamAlert {
  /** Tipo estable, para filtrar en los logs (`dispute_opened`). */
  kind: string;
  message: string;
  context: Record<string, string | number | boolean | null | undefined>;
}

export interface AlertNotifier {
  send(alert: TeamAlert): Promise<void>;
}

export function createConsoleAlertNotifier(
  log: FastifyBaseLogger,
): AlertNotifier {
  return {
    async send(alert) {
      log.warn(
        { alert: alert.kind, ...alert.context },
        `[ALERTA] ${alert.message}`,
      );
    },
  };
}

export interface TelegramAlertConfig {
  botToken: string;
  chatId: string;
  /** Prefijo del mensaje para distinguir ambientes en el mismo chat (`dev`, `prod`). */
  environmentLabel?: string;
}

const TELEGRAM_TIMEOUT_MS = 5_000;

function formatTelegramText(
  alert: TeamAlert,
  environmentLabel?: string,
): string {
  const lines = Object.entries(alert.context)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${String(value)}`);
  const header = environmentLabel ? `[${environmentLabel}] ` : "";
  return [`${header}⚠️ ${alert.message}`, `tipo: ${alert.kind}`, ...lines].join(
    "\n",
  );
}

export function createTelegramAlertNotifier(
  config: TelegramAlertConfig,
  log: FastifyBaseLogger,
): AlertNotifier {
  const consoleNotifier = createConsoleAlertNotifier(log);
  return {
    async send(alert) {
      await consoleNotifier.send(alert);
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${config.botToken}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: config.chatId,
              text: formatTelegramText(alert, config.environmentLabel),
            }),
            signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
          },
        );
        if (!response.ok) {
          log.error(
            { alert: alert.kind, telegramStatus: response.status },
            "no se pudo mandar la alerta a Telegram",
          );
        }
      } catch (error) {
        log.error(
          {
            alert: alert.kind,
            reason: error instanceof Error ? error.message : String(error),
          },
          "no se pudo mandar la alerta a Telegram",
        );
      }
    },
  };
}

export function createAlertNotifier(
  config: EnvConfig,
  log: FastifyBaseLogger,
): AlertNotifier {
  const {
    ALERT_PROVIDER,
    ALERT_TELEGRAM_BOT_TOKEN,
    ALERT_TELEGRAM_CHAT_ID,
    ALERT_ENVIRONMENT_LABEL,
  } = config;
  if (ALERT_PROVIDER === "telegram") {
    if (!ALERT_TELEGRAM_BOT_TOKEN || !ALERT_TELEGRAM_CHAT_ID) {
      throw new Error(
        "ALERT_PROVIDER=telegram necesita ALERT_TELEGRAM_BOT_TOKEN y ALERT_TELEGRAM_CHAT_ID",
      );
    }
    return createTelegramAlertNotifier(
      {
        botToken: ALERT_TELEGRAM_BOT_TOKEN,
        chatId: ALERT_TELEGRAM_CHAT_ID,
        environmentLabel: ALERT_ENVIRONMENT_LABEL || undefined,
      },
      log,
    );
  }
  return createConsoleAlertNotifier(log);
}
