import type { AccountStatus, KycStatus } from "./user";

/**
 * MOVO-116 (DD-036): requisitos habilitantes para operar como transportista, además
 * del KYC de identidad (que es prerequisito del rol y responde `CARRIER_NOT_VERIFIED`).
 * - `license`: licencia de conducir aprobada (`kyc_status_license`, MOVO-15).
 * - `mp_account`: cuenta de Mercado Pago vinculada y vigente (MOVO-111).
 * - `no_open_dispute` (MOVO-278, DD-045): ningún envío en `disputed` como transportista.
 *   El transportista no lo puede resolver por su cuenta: se levanta cuando un admin
 *   resuelve la disputa (MOVO-34).
 * - `no_overdue_debt` (MOVO-313, DD-044): ninguna deuda de la cuenta corriente sin saldar
 *   hace más de `USER_DEBT_OVERDUE_DAYS` (14). La deuda es de la persona, no del rol, pero
 *   solo bloquea operar como transportista: como emisor, su próximo pago ya la incluye
 *   (MOVO-311). Se levanta al saldarla (MOVO-311/312), en la siguiente consulta.
 */
export type CarrierRequirement = "no_open_dispute" | "license" | "mp_account" | "no_overdue_debt";

/**
 * MOVO-37: requisitos que solo rigen en un envío pagado en efectivo, por fuera de los habilitantes
 * generales (no aparecen en `GET /shipments/carrier-requirements`).
 * - `cash_debt_within_limit`: la deuda total del transportista (vencida o no) no supera
 *   `CASH_SHIPMENT_MAX_CARRIER_DEBT_ARS`. 403 `CASH_DEBT_LIMIT_EXCEEDED` al ofertar o editar la oferta.
 * - `no_pending_debt`: el emisor no tiene deuda en su cuenta corriente. 403
 *   `CASH_PAYMENT_SENDER_HAS_DEBT` al crear un envío en efectivo (con tarjeta la deuda se cobra en el pago).
 * Las dos se levantan al saldar con "Pagar mi saldo" (MOVO-312).
 */
export type CashPaymentRequirement = "cash_debt_within_limit" | "no_pending_debt";

/**
 * `details` de un `ApiError` `CARRIER_DISPUTE_OPEN`/`CARRIER_LICENSE_NOT_APPROVED`/`CARRIER_MP_ACCOUNT_NOT_LINKED`/
 * `USER_DEBT_OVERDUE` de `svc-shipments`: el `code` es el primer requisito que falta, esta
 * lista los trae a todos (para mostrar un CTA por cada uno, MOVO-117). MOVO-37: también la de
 * `CASH_DEBT_LIMIT_EXCEEDED`/`CASH_PAYMENT_SENDER_HAS_DEBT`, con su requisito de efectivo.
 */
export interface CarrierRequirementsErrorDetails {
  missingRequirements: Array<CarrierRequirement | CashPaymentRequirement>;
}

/** Respuesta de `GET /internal/users/:id/kyc-status` (`svc-users`). */
export interface CarrierKycStatusResponse {
  kycStatusIdentity: KycStatus;
  kycStatusLicense: KycStatus;
  /** MOVO-265: estado de la cuenta (`deleted` nunca llega, el endpoint da 404). Lo usa la
   * generación de viajes recurrentes para cortar la serie de una cuenta suspendida. Opcional
   * para tolerar un `svc-users` anterior a MOVO-265 durante el deploy. */
  accountStatus?: AccountStatus;
  /** ISO 8601, o `null` sin suspensión temporal. */
  bannedUntil?: string | null;
}

/**
 * Respuesta de `GET /internal/payments/mp-connect/:userId/status` (`svc-payments`).
 * `linked` usa el mismo criterio que el hold (credenciales activas): una cuenta que pasa
 * este chequeo puede cobrar.
 */
export interface CarrierMpAccountStatusResponse {
  linked: boolean;
}
