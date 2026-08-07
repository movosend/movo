import { KycStatus } from "@movo/shared";
import { InvalidEnumValueError } from "./user";

/**
 * Distingue las dos verificaciones que el DER modela sobre la misma tabla (identidad/
 * licencia, ver `kyc_status_identity`/`kyc_status_license` en `User`). MOVO-72 solo
 * escribe filas `identity` — `license` queda listo para cuando exista esa integración
 * (MOVO-15/25). No vive en `@movo/shared` porque no es parte del contrato de wire de
 * ningún endpoint (es un detalle interno de esta tabla).
 */
export type VerificationType = "identity" | "license";

/**
 * Fila de `users.kyc_verification` (DER: "tiene intentos de", 1 a N desde `User`) — un
 * registro por sesión de verificación creada. `User.kycStatusIdentity` sigue siendo el
 * caché de lectura rápida; esta es la fuente de verdad histórica por intento.
 */
export interface KycVerification {
  id: string;
  userId: string;
  verificationType: VerificationType;
  provider: string;
  externalSessionId: string;
  status: KycStatus;
  requestedAt: Date;
  resolvedAt: Date | null;
  /** Payload del webhook de Didit REDACTADO (whitelist de campos seguros — nunca
   * imagen de documento ni dato biométrico, AC9). `unknown` a propósito: no es un
   * contrato de wire, es material de debugging (guía del ticket MOVO-72). */
  rawDecision: unknown;
}

const VERIFICATION_TYPE_VALUES: ReadonlySet<string> = new Set<VerificationType>(["identity", "license"]);

export function parseVerificationType(value: string): VerificationType {
  if (!VERIFICATION_TYPE_VALUES.has(value)) {
    throw new InvalidEnumValueError("kyc_verification.verification_type", value);
  }
  return value as VerificationType;
}
