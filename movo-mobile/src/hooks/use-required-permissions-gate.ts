import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import {
  getRequiredPermissionsStatus,
  missingRequiredPermissions,
  openAppSettings,
  requestRequiredPermission,
  type RequiredPermissionKind,
  type RequiredPermissionsSnapshot,
} from "../lib/required-permissions";

/**
 * Revalidación **en cada entrada a la app** de los permisos obligatorios
 * (`required-permissions.ts`): al montar y en cada vuelta a foreground. Lo segundo no
 * es redundante — iOS y Android dejan revocar un permiso desde Ajustes con la app
 * viva en background, así que chequear solo al bootear dejaría una sesión entera
 * corriendo sin ubicación ni cámara hasta el próximo cold start.
 *
 * Nunca pide el permiso por su cuenta (usa las lecturas de solo lectura): el prompt
 * nativo solo sale si el usuario toca el botón del gate. Un prompt disparado solo al
 * volver a foreground sería una interrupción sin contexto.
 */
export interface RequiredPermissionsGateState {
  /** `false` hasta la primera lectura — el gate no se muestra mientras tanto, para no
   * hacer parpadear una pantalla bloqueante sobre alguien que sí tiene los permisos. */
  checked: boolean;
  statuses: RequiredPermissionsSnapshot | null;
  missing: RequiredPermissionKind[];
  blocked: boolean;
  pendingKind: RequiredPermissionKind | null;
  request: (kind: RequiredPermissionKind) => Promise<void>;
  openSettings: () => void;
  recheck: () => void;
}

export function useRequiredPermissionsGate(): RequiredPermissionsGateState {
  const [statuses, setStatuses] = useState<RequiredPermissionsSnapshot | null>(null);
  const [checked, setChecked] = useState(false);
  const [pendingKind, setPendingKind] = useState<RequiredPermissionKind | null>(null);
  const mountedRef = useRef(true);
  // Un prompt nativo manda la app a `inactive`/`background` y la devuelve a `active`
  // al cerrarse: sin esta guarda, el `recheck()` del listener de AppState pisaría el
  // resultado de `request()` con una lectura hecha a mitad del propio diálogo.
  const requestingRef = useRef(false);

  const recheck = useCallback(() => {
    void (async () => {
      const snapshot = await getRequiredPermissionsStatus();
      if (!mountedRef.current) return;
      setStatuses(snapshot);
      setChecked(true);
    })();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    recheck();

    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active" && !requestingRef.current) recheck();
    });

    return () => {
      mountedRef.current = false;
      subscription.remove();
    };
  }, [recheck]);

  const request = useCallback(async (kind: RequiredPermissionKind) => {
    requestingRef.current = true;
    setPendingKind(kind);
    try {
      const snapshot = await requestRequiredPermission(kind);
      if (!mountedRef.current) return;
      setStatuses((prev) => (prev ? { ...prev, [kind]: snapshot } : prev));
      setChecked(true);
    } finally {
      requestingRef.current = false;
      if (mountedRef.current) setPendingKind(null);
    }
  }, []);

  const openSettings = useCallback(() => {
    // Al volver de Ajustes, el listener de AppState relee solo — no hace falta
    // acordarse de refrescar a mano desde la pantalla que llamó acá.
    void openAppSettings();
  }, []);

  const missing = statuses ? missingRequiredPermissions(statuses) : [];

  return {
    checked,
    statuses,
    missing,
    blocked: checked && missing.length > 0,
    pendingKind,
    request,
    openSettings,
    recheck,
  };
}
