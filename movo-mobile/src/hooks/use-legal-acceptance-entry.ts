import { router } from "expo-router";
import { useEffect, useState } from "react";
import { getPrivacyAcceptanceState, getTermsAcceptanceState, legalEntrySheetCopy, type LegalEntrySheetCopy } from "../lib/legal-acceptance";
import { useAuthStore } from "../store/auth-store";
import { useMyProfile } from "./use-profile";

export interface LegalAcceptanceEntry {
  visible: boolean;
  copy: LegalEntrySheetCopy;
  onReview: () => void;
  onDismiss: () => void;
}

/**
 * MOVO-229 (rediseño Claude Design "Rediseño página Legal con estados de firma"):
 * al abrir la app con una sesión autenticada, si falta aceptar la versión vigente de
 * Términos y/o Privacidad (nunca aceptados, o versión vieja), expone el estado para
 * que `LegalEntrySheet` (`app/_layout.tsx`) se muestre — reemplaza el `Alert.alert`
 * genérico de la primera pasada por un sheet propio, mismo criterio **no
 * bloqueante** ya confirmado con el usuario: "Ahora no" solo cierra el sheet, no
 * impide seguir usando el resto de la app.
 *
 * `dismissed` reemplaza al `useRef` de guard de la versión anterior — acá el sheet
 * es un elemento de UI persistente, no un disparo puntual, así que su visibilidad
 * es 100% derivada de `anyPending && !dismissed` en vez de un efecto imperativo.
 * Se resetea al des-autenticar, para que un logout/login vuelva a mostrarlo si
 * sigue pendiente.
 */
export function useLegalAcceptanceEntry(): LegalAcceptanceEntry {
  const sessionStatus = useAuthStore((s) => s.status);
  const { data: profile } = useMyProfile({ enabled: sessionStatus === "authenticated" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (sessionStatus !== "authenticated") setDismissed(false);
  }, [sessionStatus]);

  const terms = getTermsAcceptanceState(profile);
  const privacy = getPrivacyAcceptanceState(profile);
  const anyPending = terms.status !== "up_to_date" || privacy.status !== "up_to_date";
  // Sin `profile` todavía (primer fetch en vuelo) no se afirma nada — evita un
  // parpadeo del sheet antes de conocer el estado real.
  const visible = sessionStatus === "authenticated" && !!profile && anyPending && !dismissed;

  return {
    visible,
    copy: legalEntrySheetCopy(terms, privacy),
    onReview: () => {
      setDismissed(true);
      router.push("/profile/legal" as any);
    },
    onDismiss: () => setDismissed(true),
  };
}
