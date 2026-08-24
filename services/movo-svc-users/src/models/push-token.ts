import { InvalidEnumValueError } from "./user";

/**
 * Plataforma del dispositivo que registró el push token (AC1/AC4 de MOVO-106) — no
 * vive en `@movo/shared` porque no es parte de ningún contrato de wire compartido con
 * otro servicio todavía, mismo criterio que `VerificationType` en `kyc-verification.ts`.
 */
export type PushPlatform = "ios" | "android";

const PUSH_PLATFORM_VALUES: ReadonlySet<string> = new Set<PushPlatform>(["ios", "android"]);

export function parsePushPlatform(value: string): PushPlatform {
  if (!PUSH_PLATFORM_VALUES.has(value)) {
    throw new InvalidEnumValueError("push_token.platform", value);
  }
  return value as PushPlatform;
}

/** Fila de `users.push_token` (AC1) — un usuario puede tener varios dispositivos, cada
 * uno con un solo token vigente (índice único `(user_id, device_id)`). */
export interface PushToken {
  id: string;
  userId: string;
  expoPushToken: string;
  deviceId: string;
  platform: PushPlatform;
  createdAt: Date;
  updatedAt: Date;
}
