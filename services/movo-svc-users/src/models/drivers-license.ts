import { InvalidEnumValueError } from "./user";

/**
 * Ciclo de vida del carnet en sí (distinto del ciclo de vida del intento de
 * verificación, que ya cubre `KycStatus`) — mismo criterio que `VerificationType` en
 * `kyc-verification.ts`: no vive en `@movo/shared` porque no es parte del contrato de
 * wire de ningún endpoint (detalle interno de esta tabla).
 */
export type DriversLicenseStatus = "pending" | "verified" | "expired";

/**
 * Fila de `users.drivers_license` (DER: registro del carnet en sí, distinto de
 * `kyc_verification` que es el log de intentos). Solo se crea/actualiza cuando una
 * verificación de licencia se aprueba (ver `kyc.service.ts#applyTerminalDecision`).
 */
export interface DriversLicense {
  id: string;
  userId: string;
  kycVerificationId: string;
  expirationDate: Date | null;
  status: DriversLicenseStatus;
  createdAt: Date;
  updatedAt: Date;
}

const DRIVERS_LICENSE_STATUS_VALUES: ReadonlySet<string> = new Set<DriversLicenseStatus>([
  "pending",
  "verified",
  "expired",
]);

export function parseDriversLicenseStatus(value: string): DriversLicenseStatus {
  if (!DRIVERS_LICENSE_STATUS_VALUES.has(value)) {
    throw new InvalidEnumValueError("drivers_license.status", value);
  }
  return value as DriversLicenseStatus;
}
