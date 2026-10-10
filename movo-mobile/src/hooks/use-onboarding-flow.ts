import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { markOnboardingSeen } from "../lib/onboarding-storage";
import {
  getRequiredPermissionStatus,
  openAppSettings,
  requestRequiredPermission,
  type RequiredPermissionKind,
} from "../lib/required-permissions";

/** Los 6 pasos del carrusel (MOVO-249), en el mismo orden que el prototipo de Claude
 * Design: 2 de concepto, 3 de priming de permisos, 1 final. */
export const ONBOARDING_STEP_COUNT = 6;
const LAST_CONTENT_STEP = 1; // "La red" / "Confianza" — los únicos con "Omitir".
const LAST_PERMISSION_STEP = 4;
const READY_STEP = ONBOARDING_STEP_COUNT - 1;

export type OnboardingPermissionKind = "location" | "notifications" | "camera";

/** `denied` = el usuario dijo que no pero el SO todavía puede volver a preguntar;
 * `blocked` = denegado de forma permanente, solo se arregla desde Ajustes; `later` =
 * "Ahora no", exclusivo de los permisos opcionales (hoy solo notificaciones). */
export type PermissionOutcome = "granted" | "denied" | "blocked" | "later";

type PermissionState = Partial<Record<OnboardingPermissionKind, PermissionOutcome>>;

/** Qué paso del carrusel pide cada permiso obligatorio — usado para revalidar al
 * volver de Ajustes sin tener que duplicar el mapa de pasos en la pantalla. */
const STEP_REQUIRED_PERMISSION: Record<number, RequiredPermissionKind> = {
  2: "location",
  4: "camera",
};

/** Delay antes de avanzar tras resolver un permiso — deja ver un instante el
 * resultado (mismo criterio que el prototipo, que auto-avanza 380ms después de
 * cerrar el diálogo simulado) en vez de saltar de pantalla en el mismo frame. */
const ADVANCE_DELAY_MS = 350;

/**
 * Estado + navegación del carrusel de onboarding (MOVO-249). Los 3 pasos de permisos
 * disparan el diálogo REAL del SO — a diferencia del prototipo, acá no hay ningún
 * alert simulado que dibujar.
 *
 * **Ubicación y cámara son obligatorias y bloqueantes** (ver `required-permissions.ts`
 * para el porqué y el riesgo aceptado): esos dos pasos no tienen "Ahora no" y no
 * avanzan hasta que el permiso esté concedido de verdad. Denegado se reintenta en el
 * mismo paso; denegado de forma permanente manda a Ajustes y se revalida solo al
 * volver a la app. Notificaciones sigue siendo opcional: nada del flujo de un envío
 * se rompe sin push.
 */
export function useOnboardingFlow() {
  const [step, setStep] = useState(0);
  const [permissions, setPermissions] = useState<PermissionState>({});
  const [pendingPermission, setPendingPermission] = useState<OnboardingPermissionKind | null>(
    null,
  );
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // El prompt nativo manda la app a background y la devuelve a `active` al cerrarse:
  // sin esta guarda, la revalidación de foreground competiría con el propio request.
  const requestingRef = useRef(false);

  const clamp = useCallback((n: number) => Math.max(0, Math.min(READY_STEP, n)), []);

  // Forma funcional a propósito (no `clamp(step + 1)`): varias llamadas a `next()`
  // encoladas en el mismo ciclo de eventos (p. ej. en un test, o un doble tap antes
  // del primer re-render) tienen que acumularse contra el estado real, no todas
  // contra el mismo `step` capturado por closure.
  const next = useCallback(() => setStep((s) => clamp(s + 1)), [clamp]);
  const back = useCallback(() => setStep((s) => clamp(s - 1)), [clamp]);
  const skipIntro = useCallback(() => setStep(() => clamp(LAST_PERMISSION_STEP - 2)), [clamp]);

  const scheduleAdvance = useCallback(() => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => {
      if (!mountedRef.current) return;
      setPendingPermission(null);
      setStep((s) => Math.min(READY_STEP, s + 1));
    }, ADVANCE_DELAY_MS);
  }, []);

  const resolvePermission = useCallback(
    (kind: OnboardingPermissionKind, outcome: PermissionOutcome) => {
      setPermissions((prev) => ({ ...prev, [kind]: outcome }));
      // Un permiso obligatorio sin conceder deja al usuario en el mismo paso: es
      // justamente lo que lo hace bloqueante. Los opcionales avanzan igual.
      const blocksAdvance =
        (kind === "location" || kind === "camera") && outcome !== "granted";
      if (blocksAdvance) {
        setPendingPermission(null);
        return;
      }
      scheduleAdvance();
    },
    [scheduleAdvance],
  );

  const requestRequired = useCallback(
    async (kind: RequiredPermissionKind) => {
      requestingRef.current = true;
      setPendingPermission(kind);
      try {
        const snapshot = await requestRequiredPermission(kind);
        if (!mountedRef.current) return;
        resolvePermission(
          kind,
          snapshot.granted ? "granted" : snapshot.canAskAgain ? "denied" : "blocked",
        );
      } finally {
        requestingRef.current = false;
      }
    },
    [resolvePermission],
  );

  const requestLocation = useCallback(() => requestRequired("location"), [requestRequired]);
  const requestCamera = useCallback(() => requestRequired("camera"), [requestRequired]);

  const requestNotifications = useCallback(async () => {
    requestingRef.current = true;
    setPendingPermission("notifications");
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (!mountedRef.current) return;
      resolvePermission("notifications", status === "granted" ? "granted" : "denied");
    } catch {
      if (mountedRef.current) resolvePermission("notifications", "denied");
    } finally {
      requestingRef.current = false;
    }
  }, [resolvePermission]);

  /** Solo para permisos opcionales. Llamarlo con uno obligatorio es un no-op
   * defensivo: la pantalla ni siquiera dibuja el botón "Ahora no" en esos pasos. */
  const skipPermission = useCallback(
    (kind: OnboardingPermissionKind) => {
      if (kind === "location" || kind === "camera") return;
      resolvePermission(kind, "later");
    },
    [resolvePermission],
  );

  const openSettings = useCallback(() => {
    void openAppSettings();
  }, []);

  // Revalidación al volver a foreground: cubre al usuario que fue a Ajustes desde el
  // estado `blocked` y vuelve con el permiso ya concedido. Sin esto quedaría trabado
  // mirando "Abrir Ajustes" con el permiso puesto, sin ninguna forma de avanzar.
  // Ciclo de vida del montaje, separado del listener de abajo a propósito: ese se
  // re-suscribe en cada cambio de paso, y mezclar ambas cosas dejaría `mountedRef`
  // en `false` por un instante en cada avance.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state !== "active" || requestingRef.current) return;
      const kind = STEP_REQUIRED_PERMISSION[step];
      if (!kind) return;

      void (async () => {
        const snapshot = await getRequiredPermissionStatus(kind);
        if (!mountedRef.current || !snapshot.granted) return;
        resolvePermission(kind, "granted");
      })();
    });

    return () => subscription.remove();
  }, [step, resolvePermission]);

  const finish = useCallback(async () => {
    await markOnboardingSeen();
    router.replace("/");
  }, []);

  return {
    step,
    permissions,
    pendingPermission,
    showProgress: step <= LAST_PERMISSION_STEP,
    showBack: step > 0 && step <= LAST_PERMISSION_STEP,
    showSkip: step <= LAST_CONTENT_STEP,
    isDarkStep: step >= 2 && step <= LAST_PERMISSION_STEP,
    next,
    back,
    skipIntro,
    requestLocation,
    requestNotifications,
    requestCamera,
    skipPermission,
    openSettings,
    finish,
  };
}
