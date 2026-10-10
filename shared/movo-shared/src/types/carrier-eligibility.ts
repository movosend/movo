import type { KycStatus } from "./user";

/**
 * MOVO-116 (ADR-036): requisitos habilitantes para operar como transportista, además
 * del KYC de identidad (que es prerequisito del rol y responde `CARRIER_NOT_VERIFIED`).
 * - `license`: licencia de conducir aprobada (`kyc_status_license`, MOVO-15).
 * - `mp_account`: cuenta de Mercado Pago vinculada y vigente (MOVO-111).
 */
export type CarrierRequirement = "license" | "mp_account";

/**
 * `details` de un `ApiError` `CARRIER_LICENSE_NOT_APPROVED`/`CARRIER_MP_ACCOUNT_NOT_LINKED`
 * de `svc-shipments`: el `code` es el primer requisito que falta, esta lista los trae a
 * todos (para mostrar un CTA por cada uno, MOVO-117).
 */
export interface CarrierRequirementsErrorDetails {
  missingRequirements: CarrierRequirement[];
}

/** Respuesta de `GET /internal/users/:id/kyc-status` (`svc-users`). */
export interface CarrierKycStatusResponse {
  kycStatusIdentity: KycStatus;
  kycStatusLicense: KycStatus;
}

/**
 * Respuesta de `GET /internal/payments/mp-connect/:userId/status` (`svc-payments`).
 * `linked` usa el mismo criterio que el hold (credenciales activas): una cuenta que pasa
 * este chequeo puede cobrar.
 */
export interface CarrierMpAccountStatusResponse {
  linked: boolean;
}
