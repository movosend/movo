import { resolveTransportGate } from "../lib/carrier-requirements";
import { useCarrierEligibility } from "./use-carrier-eligibility";
import { useMpConnectStatus } from "./use-mp-connect";
import { useMyProfile } from "./use-profile";

/**
 * MOVO-167 / MOVO-117: gating de entrada al tab Transportar por identidad, licencia,
 * Mercado Pago y deuda vencida, sobre el perfil propio, el estado de MP y la elegibilidad.
 * Es solo UX -- el backend sigue siendo la autoridad (DD-036). Si no se puede consultar
 * el perfil, MP o la elegibilidad no se deja pasar: sin ellos no se sabe qué falta.
 *
 * MOVO-169: extraído de `transport.tsx` para que el tutorial (último paso del Tour 1, sheet
 * de "Ayuda y soporte") use el mismo `canBrowse` que el tab, sin duplicar la regla.
 */
export function useTransportGate() {
  const profileQuery = useMyProfile();
  const mpQuery = useMpConnectStatus();
  const eligibilityQuery = useCarrierEligibility();
  const profile = profileQuery.data;
  const mpConnect = mpQuery.data;

  const profileGate = resolveTransportGate({
    kycStatus: profile?.kycStatus ?? null,
    licenseKycStatus: profile?.licenseKycStatus ?? null,
    mpStatus: mpConnect?.status ?? null,
    debtOverdue: eligibilityQuery.data?.missingRequirements.includes("no_overdue_debt") ?? false,
  });
  // Sin identidad aprobada la checklist no se muestra, así que MP no hace falta para decidir.
  const profileUnavailable = !profile && profileQuery.isError;
  const mpUnavailable = !mpConnect && mpQuery.isError && profileGate !== "identity";
  const eligibilityUnavailable = !eligibilityQuery.data && eligibilityQuery.isError && profileGate !== "identity";
  const requirementsError = profileUnavailable ? profileQuery.error : mpUnavailable ? mpQuery.error : eligibilityQuery.error;
  const isRequirementsLoading =
    profileQuery.isLoading ||
    (mpQuery.isLoading && profileGate !== "identity") ||
    (eligibilityQuery.isLoading && profileGate !== "identity");
  const canBrowse =
    !isRequirementsLoading && !(profileUnavailable || mpUnavailable || eligibilityUnavailable) && profileGate === null;

  return {
    profileQuery,
    mpQuery,
    eligibilityQuery,
    profileGate,
    profileUnavailable,
    mpUnavailable,
    eligibilityUnavailable,
    requirementsError,
    isRequirementsLoading,
    canBrowse,
  };
}
