import type { CarrierRequirement } from "@movo/shared/dist/types/carrier-eligibility";
import { KycStatus } from "@movo/shared/dist/types/user";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import type {
  CarrierRequirementsContext,
  CarrierRequirementsSheetProps,
} from "../../components/carrier/carrier-requirements-checklist";
import { carrierRequirementsFromError } from "../lib/carrier-requirements";
import { MP_CONNECT_STATUS_QUERY_KEY, useMpConnectStatus } from "./use-mp-connect";
import { MY_PROFILE_QUERY_KEY, useMyProfile } from "./use-profile";

/**
 * Sheet de requisitos ante el 403 del backend (MOVO-117 AC5). Una pantalla que ejecuta una
 * acción de transportista (ofertar, editar oferta, declarar o iniciar un viaje) le pasa a
 * `handleError` el error de la mutación: si es `CARRIER_LICENSE_NOT_APPROVED` o
 * `CARRIER_MP_ACCOUNT_NOT_LINKED` abre el sheet con `details.missingRequirements` y
 * devuelve `true` (la pantalla no muestra además un error genérico); con cualquier otro
 * error —incluido un 502 `*_SERVICE_UNAVAILABLE`, que es para reintentar— devuelve `false`.
 *
 * Ese 403 vale como señal de que el estado del cliente (perfil + MP) estaba desactualizado:
 * se invalidan para que la checklist del tab y el resto de la app se pongan al día.
 *
 *     const requirements = useCarrierRequirementsSheet("offer");
 *     … catch (err) { if (requirements.handleError(err)) return; … }
 *     <CarrierRequirementsSheet {...requirements.sheetProps} />
 */
export function useCarrierRequirementsSheet(context: CarrierRequirementsContext) {
  const queryClient = useQueryClient();
  const { data: profile } = useMyProfile();
  const { data: mp } = useMpConnectStatus();
  const [missing, setMissing] = useState<CarrierRequirement[] | null>(null);
  // El sheet se anima al cerrar: `missing` se conserva para no vaciar la checklist a mitad
  // de la animación, y `visible` es lo que realmente lo abre y cierra.
  const [visible, setVisible] = useState(false);

  const handleError = useCallback(
    (error: unknown): boolean => {
      const required = carrierRequirementsFromError(error);
      if (!required) return false;
      setMissing(required);
      setVisible(true);
      void queryClient.invalidateQueries({ queryKey: MY_PROFILE_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: MP_CONNECT_STATUS_QUERY_KEY });
      return true;
    },
    [queryClient],
  );

  const licenseStatus = profile?.licenseKycStatus ?? null;
  // El perfil cacheado puede decir `approved` cuando el backend acaba de reportar la licencia
  // como faltante: no se pasa ese estado a `/license-kyc` para que no arranque en "aprobada".
  const licenseStatusParam =
    licenseStatus === KycStatus.APPROVED && missing?.includes("license") ? null : licenseStatus;

  const sheetProps: CarrierRequirementsSheetProps = {
    visible,
    onClose: () => setVisible(false),
    missing: missing ?? [],
    licenseStatus,
    mpStatus: mp?.status ?? null,
    context,
    onPressLicense: () => router.push({ pathname: "/license-kyc", params: { status: licenseStatusParam ?? undefined } }),
    onPressMp: () => router.push("/profile/payments?tab=methods"),
    onPressDebt: () => router.push("/profile/payments?tab=balance&pay=1"),
  };

  return { handleError, sheetProps };
}
