import type { FastifyBaseLogger } from "fastify";

/**
 * Alerta operativa para el equipo (no para usuarios): algo de plata que una persona
 * tiene que mirar. Solo ids, estados y montos: nunca emails, tokens ni datos de tarjeta.
 */
export interface TeamAlert {
  /** Tipo estable, para filtrar en los logs (`mp_chargeback`, `mp_webhook_failed`, ...). */
  kind: string;
  message: string;
  context: Record<string, string | number | boolean | null | undefined>;
}

/**
 * MOVO-268: canal de alertas al equipo, mismo molde que `SmsProvider`/`EmailProvider`
 * (ADR-012/017): consola por default en dev/test/CI y Telegram con
 * `ALERT_PROVIDER=telegram`. Pensado para reusarse en MOVO-213 (liquidación escalada a
 * proceso manual).
 *
 * Mandar una alerta nunca tira: si Telegram falla se loguea y el caller sigue. Toda
 * alerta queda además en el log con `alert: <kind>`, así no se pierde aunque el canal
 * externo no responda.
 */
export interface AlertNotifier {
  send(alert: TeamAlert): Promise<void>;
}

export function createConsoleAlertNotifier(log: FastifyBaseLogger): AlertNotifier {
  return {
    async send(alert) {
      log.error({ alert: alert.kind, ...alert.context }, `[ALERTA] ${alert.message}`);
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

function formatTelegramText(alert: TeamAlert, environmentLabel?: string): string {
  const lines = Object.entries(alert.context)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${String(value)}`);
  const header = environmentLabel ? `[${environmentLabel}] ` : "";
  return [`${header}⚠️ ${alert.message}`, `tipo: ${alert.kind}`, ...lines].join("\n");
}

export function createTelegramAlertNotifier(config: TelegramAlertConfig, log: FastifyBaseLogger): AlertNotifier {
  const consoleNotifier = createConsoleAlertNotifier(log);
  return {
    async send(alert) {
      await consoleNotifier.send(alert);
      try {
        const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: config.chatId, text: formatTelegramText(alert, config.environmentLabel) }),
          signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
        });
        if (!response.ok) {
          log.error({ alert: alert.kind, telegramStatus: response.status }, "no se pudo mandar la alerta a Telegram");
        }
      } catch (error) {
        log.error(
          { alert: alert.kind, reason: error instanceof Error ? error.message : String(error) },
          "no se pudo mandar la alerta a Telegram"
        );
      }
    },
  };
}
