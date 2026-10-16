import {
  AccountStatus,
  ApiError,
  CarrierRequirement,
  CarrierRequirementsErrorDetails,
  KycStatus,
  UserRole,
} from "@movo/shared";
import { UsersClient } from "../adapters/users-client";
import { PaymentsClient } from "../adapters/payments-client";
import { ShipmentRepository } from "../repositories/shipment-repository";

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
  /** MOVO-278 (ADR-045): disputa abierta como transportista, consulta local (misma DB). */
  shipmentRepository: Pick<ShipmentRepository, "hasOpenDisputeAsCarrier">;
}

export interface CarrierEligibility {
  /** KYC de identidad aprobado: prerequisito del rol, no entra en `missingRequirements`. */
  identityApproved: boolean;
  /** Requisitos habilitantes que faltan, en orden fijo: disputa abierta primero (la única
   * que el transportista no puede resolver), después licencia y MP, y al final la deuda
   * vencida (MOVO-313: es lo último que se resuelve, con un pago, y no abre la checklist). */
  missingRequirements: CarrierRequirement[];
  /** MOVO-265: estado de la cuenta, de la misma llamada a svc-users. `null` si la cuenta no
   * existe o se dio de baja; `undefined` si svc-users no lo informó (versión anterior). Lo
   * usa la generación de viajes recurrentes; los gates de escritura no lo miran (no estaba
   * en ADR-036). */
  account: { status: AccountStatus; bannedUntil: Date | null } | null | undefined;
}

/**
 * MOVO-116 (ADR-036): consulta en paralelo los requisitos habilitantes (licencia en
 * svc-users, cuenta de MP en svc-payments, desde MOVO-278/ADR-045 ninguna disputa abierta
 * como transportista en la propia DB y, desde MOVO-313/ADR-044, ninguna deuda vencida en la
 * cuenta corriente de svc-payments) más el KYC de identidad, que sale de la misma llamada a
 * svc-users. Lanza el 502 del servicio que no responda: quien llama falla cerrado (mismo
 * criterio que `assertNotBlocked` en escrituras, ADR-026).
 *
 * Sin cache (criterio 4 de MOVO-116, decisión documentada): las escrituras protegidas
 * son pocas por transportista, y cachear haría que alguien recién vinculado siguiera
 * bloqueado (negativo) o que alguien recién desvinculado siguiera operando (positivo). Con la
 * deuda es igual (MOVO-313 criterio 5): saldarla levanta el bloqueo en la siguiente consulta.
 *
 * La deuda es de la PERSONA, no del rol, pero este gate solo lo usan las operaciones de
 * transportista: como emisor no se bloquea (su próximo pago ya incluye la deuda, MOVO-311).
 */
export async function resolveCarrierEligibility(
  deps: CarrierGateDeps,
  carrierId: string,
): Promise<CarrierEligibility> {
  const [kyc, mpAccount, hasOpenDispute, debt] = await Promise.all([
    deps.usersClient.findKycStatus(carrierId),
    deps.paymentsClient.getCarrierMpAccountStatus(carrierId),
    deps.shipmentRepository.hasOpenDisputeAsCarrier(carrierId),
    deps.paymentsClient.getUserDebtStatus(carrierId),
  ]);
  const missingRequirements: CarrierRequirement[] = [];
  if (hasOpenDispute) missingRequirements.push("no_open_dispute");
  if (kyc?.kycStatusLicense !== KycStatus.APPROVED) missingRequirements.push("license");
  if (!mpAccount.linked) missingRequirements.push("mp_account");
  if (debt.overdue) missingRequirements.push("no_overdue_debt");
  return {
    identityApproved: kyc?.kycStatusIdentity === KycStatus.APPROVED,
    missingRequirements,
    account: !kyc
      ? null
      : kyc.accountStatus === undefined
        ? undefined
        : { status: kyc.accountStatus, bannedUntil: kyc.bannedUntil ? new Date(kyc.bannedUntil) : null },
  };
}

/** Requisitos que son un paso a completar (la checklist de MOVO-117). La disputa y la deuda no:
 * van con su propio mensaje. */
type ChecklistRequirement = Exclude<CarrierRequirement, "no_open_dispute" | "no_overdue_debt">;

const REQUIREMENT_LABELS: Record<ChecklistRequirement, string> = {
  license: "verificar tu licencia de conducir",
  mp_account: "vincular tu cuenta de Mercado Pago",
};

const REQUIREMENT_CODES = {
  no_open_dispute: "CARRIER_DISPUTE_OPEN",
  license: "CARRIER_LICENSE_NOT_APPROVED",
  mp_account: "CARRIER_MP_ACCOUNT_NOT_LINKED",
  no_overdue_debt: "USER_DEBT_OVERDUE",
} as const satisfies Record<CarrierRequirement, string>;

function missingRequirementsError(missingRequirements: CarrierRequirement[]): ApiError {
  const details: CarrierRequirementsErrorDetails = { missingRequirements };
  const code = REQUIREMENT_CODES[missingRequirements[0]];
  // La disputa no es algo que "falte hacer": va con su propio mensaje.
  if (code === "CARRIER_DISPUTE_OPEN") {
    return new ApiError(
      403,
      code,
      "Tenés una disputa abierta como transportista. Vas a poder operar cuando se resuelva.",
      { ...details }
    );
  }
  // MOVO-313: la deuda vencida tampoco es un paso de la checklist (se resuelve con un pago).
  // Solo es el primer requisito cuando es el único que falta: va al final del orden.
  if (code === "USER_DEBT_OVERDUE") {
    return new ApiError(
      403,
      code,
      "Tenés una deuda vencida con Movo. Saldala para volver a operar como transportista.",
      { ...details }
    );
  }
  const pending = missingRequirements
    .filter((requirement): requirement is ChecklistRequirement => requirement in REQUIREMENT_LABELS)
    .map((requirement) => REQUIREMENT_LABELS[requirement])
    .join(" y ");
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
