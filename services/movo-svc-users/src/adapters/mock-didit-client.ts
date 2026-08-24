import { randomUUID } from "node:crypto";
import { CreateDiditSessionInput, DiditClient, DiditSession } from "./didit-client";

/**
 * Implementación de desarrollo (DIDIT_MODE=mock, default): genera una sesión sintética
 * sin red, mismo criterio que `ConsoleSmsProvider` (MOVO-71) — no depender de
 * credenciales de sandbox para levantar el servicio ni bloquear el resto de la US
 * mientras se gestionan (riesgo de cronograma señalado en la guía de MOVO-72).
 */
export function createMockDiditClient(): DiditClient {
  return {
    async createSession(_input: CreateDiditSessionInput): Promise<DiditSession> {
      const sessionId = randomUUID();
      return {
        sessionId,
        sessionToken: `mock-session-token-${sessionId}`,
        url: `https://verification.didit.me/mock/${sessionId}`,
      };
    },

    // Una sesión sintética nunca llegó a Didit, así que nunca hay una decisión real que
    // preservar: `null` deja el comportamiento de dev exactamente igual que antes de la
    // reconciliación (el intento `pending` se descarta y se abre uno nuevo).
    async getSessionDecision(): Promise<null> {
      return null;
    },
  };
}
