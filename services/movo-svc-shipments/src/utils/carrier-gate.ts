import { ApiError, CarrierRequirement, CarrierRequirementsErrorDetails, KycStatus, UserRole } from "@movo/shared";
import { UsersClient } from "../adapters/users-client";
import { PaymentsClient } from "../adapters/payments-client";

/**
 * MOVO-142 (AC6): gate de "transportista verificado" para las LECTURAS de transportista
 * (`GET /shipments/available`, detalle de un `published`, `GET /trips`, matches). El rol
 * sale del header `x-user-roles` (inyectado por el gateway desde el JWT, ADR-010), sin
 * llamada de red; el KYC de identidad, de `PublicProfile.isVerified`
 * (`kycStatusIdentity === approved` del lado de svc-users). Rol primero (sin I/O), mismo
 * criterio de "más barato primero" que `createShipment`.
 *
 * Las lecturas no exigen licencia ni Mercado Pago: alguien sin esos requisitos puede ver
 * qué hay disponible antes de completarlos. Para OPERAR (escrituras) se usa
 * `assertCarrierCanOperate` (MOVO-116, ADR-036).
 *
 * Antes vivía duplicada en `trips.service.ts` y `shipments.service.ts`, con distinto
 * mensaje para el rol faltante: `roleMessage` conserva esa diferencia.
 */
export async function assertVerifiedCarrier(
  usersClient: UsersClient,
  callerId: string,
  callerRoles: UserRole[],
  roleMessage = "Necesitás ser transportista para realizar esta acción.",
): Promise<void> {
  if (!callerRoles.includes(UserRole.CARRIER)) {
    throw new ApiError(403, "CARRIER_NOT_VERIFIED", roleMessage);
  }
  const profile = await usersClient.findPublicProfile(callerId, callerId);
  if (!profile || !profile.isVerified) {
    throw new ApiError(403, "CARRIER_NOT_VERIFIED", "Necesitás tener tu identidad verificada para transportar.");
  }
}

export interface CarrierGateDeps {
  usersClient: UsersClient;
  paymentsClient: PaymentsClient;
}

export interface CarrierEligibility {
  /** KYC de identidad aprobado: prerequisito del rol, no entra en `missingRequirements`. */
  identityApproved: boolean;
  /** Requisitos habilitantes que faltan, en orden fijo: licencia primero, después MP. */
  missingRequirements: CarrierRequirement[];
}

/**
 * MOVO-116 (ADR-036): consulta en paralelo los dos requisitos habilitantes (licencia en
 * svc-users, cuenta de MP en svc-payments) más el KYC de identidad, que sale de la misma
 * llamada a svc-users. Lanza el 502 del servicio que no responda: quien llama falla
 * cerrado (mismo criterio que `assertNotBlocked` en escrituras, ADR-026).
 *
 * Sin cache (criterio 4 de MOVO-116, decisión documentada): las escrituras protegidas
 * son pocas por transportista, y cachear haría que alguien recién vinculado siguiera
 * bloqueado (negativo) o que alguien recién desvinculado siguiera operando (positivo).
 */
export async function resolveCarrierEligibility(
  deps: CarrierGateDeps,
  carrierId: string,
): Promise<CarrierEligibility> {
  const [kyc, mpAccount] = await Promise.all([
    deps.usersClient.findKycStatus(carrierId),
    deps.paymentsClient.getCarrierMpAccountStatus(carrierId),
  ]);
  const missingRequirements: CarrierRequirement[] = [];
  if (kyc?.kycStatusLicense !== KycStatus.APPROVED) missingRequirements.push("license");
  if (!mpAccount.linked) missingRequirements.push("mp_account");
  return {
    identityApproved: kyc?.kycStatusIdentity === KycStatus.APPROVED,
    missingRequirements,
  };
}

const REQUIREMENT_LABELS: Record<CarrierRequirement, string> = {
  license: "verificar tu licencia de conducir",
  mp_account: "vincular tu cuenta de Mercado Pago",
};

function missingRequirementsError(missingRequirements: CarrierRequirement[]): ApiError {
  const details: CarrierRequirementsErrorDetails = { missingRequirements };
  const code = missingRequirements[0] === "license" ? "CARRIER_LICENSE_NOT_APPROVED" : "CARRIER_MP_ACCOUNT_NOT_LINKED";
  const pending = missingRequirements.map((requirement) => REQUIREMENT_LABELS[requirement]).join(" y ");
  return new ApiError(403, code, `Para operar como transportista te falta ${pending}.`, { ...details });
}

/**
 * MOVO-116: exige identidad + licencia + MP a `carrierId`, sin mirar roles. Lo usa
 * `POST /trips/:id/start`, donde el transportista es el dueño del viaje (y quien llama
 * puede ser un admin). 403 `CARRIER_NOT_VERIFIED` sin identidad; si no, 403 con el
 * primer requisito que falta como `code` y todos en `details.missingRequirements`.
 */
export async function assertCarrierEligible(deps: CarrierGateDeps, carrierId: string): Promise<void> {
  const { identityApproved, missingRequirements } = await resolveCarrierEligibility(deps, carrierId);
  if (!identityApproved) {
    throw new ApiError(403, "CARRIER_NOT_VERIFIED", "Necesitás tener tu identidad verificada para transportar.");
  }
  if (missingRequirements.length > 0) {
    throw missingRequirementsError(missingRequirements);
  }
}

/**
 * MOVO-116 (ADR-036): gate de las ESCRITURAS de transportista (declarar viaje, crear y
 * editar oferta). Rol primero, sin I/O; después `assertCarrierEligible`. Corre antes de
 * persistir nada en todos sus call sites (criterio 3 del ticket).
 */
export async function assertCarrierCanOperate(
  deps: CarrierGateDeps,
  carrierId: string,
  callerRoles: UserRole[],
): Promise<void> {
  if (!callerRoles.includes(UserRole.CARRIER)) {
    throw new ApiError(403, "CARRIER_NOT_VERIFIED", "Necesitás ser transportista para realizar esta acción.");
  }
  await assertCarrierEligible(deps, carrierId);
}
