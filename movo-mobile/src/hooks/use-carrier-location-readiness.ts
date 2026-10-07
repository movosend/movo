import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import {
  firstMissingRequirement,
  getCarrierLocationReadiness,
  requirementNeedsSettings,
  resolveCarrierLocationRequirement,
  type CarrierLocationReadiness,
  type CarrierLocationRequirement,
} from "../lib/carrier-location-readiness";

export interface CarrierLocationReadinessState {
  /** `false` hasta la primera lectura: nada se bloquea antes de saber el estado real. */
  checked: boolean;
  readiness: CarrierLocationReadiness | null;
  missing: CarrierLocationRequirement | null;
  ready: boolean;
  /** El próximo paso solo se resuelve desde Ajustes (ver `requirementNeedsSettings`). */
  needsSettings: boolean;
  pending: boolean;
  resolve: () => Promise<void>;
  recheck: () => Promise<void>;
}

/**
 * Estado de los requisitos de ubicación del transportista, releído al montar y en
 * cada vuelta a foreground — mismo criterio que `useRequiredPermissionsGate`: el
 * usuario puede quitar "Siempre" desde Ajustes con un viaje en curso, y volver de
 * Ajustes tiene que destrabar la pantalla sin tocar nada más.
 */
export function useCarrierLocationReadiness(): CarrierLocationReadinessState {
  const [readiness, setReadiness] = useState<CarrierLocationReadiness | null>(null);
  const [pending, setPending] = useState(false);
  // Requisitos ya pedidos por diálogo en esta sesión: si siguen faltando, el próximo
  // toque manda a Ajustes en vez de repetir un request que el SO ya no muestra.
  const [attempted, setAttempted] = useState<Set<CarrierLocationRequirement>>(() => new Set());
  const mountedRef = useRef(true);
  // Un diálogo nativo manda la app a `inactive` y la devuelve a `active` al cerrarse:
  // sin esta guarda, el listener de AppState releería a mitad del propio diálogo.
  const resolvingRef = useRef(false);

  const recheck = useCallback(async () => {
    const next = await getCarrierLocationReadiness();
    if (mountedRef.current) setReadiness(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void recheck();
    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active" && !resolvingRef.current) void recheck();
    });
    return () => {
      mountedRef.current = false;
      subscription.remove();
    };
  }, [recheck]);

  const missing = readiness ? firstMissingRequirement(readiness) : null;
  const needsSettings =
    readiness !== null && missing !== null
      ? requirementNeedsSettings(readiness, missing, attempted.has(missing))
      : false;

  const resolve = useCallback(async () => {
    if (!readiness || !missing) return;
    resolvingRef.current = true;
    setPending(true);
    try {
      const wentToSettings = requirementNeedsSettings(readiness, missing, attempted.has(missing));
      await resolveCarrierLocationRequirement(readiness, missing, attempted.has(missing));
      // Ir a Ajustes no cuenta como intento: al volver, si sigue faltando, se sigue
      // ofreciendo Ajustes por `canAskAgain`/plataforma, no por este set.
      if (!wentToSettings && mountedRef.current) {
        setAttempted((prev) => new Set(prev).add(missing));
      }
    } finally {
      resolvingRef.current = false;
      if (mountedRef.current) setPending(false);
      await recheck();
    }
  }, [readiness, missing, attempted, recheck]);

  return {
    checked: readiness !== null,
    readiness,
    missing,
    ready: readiness !== null && missing === null,
    needsSettings,
    pending,
    resolve,
    recheck,
  };
}
