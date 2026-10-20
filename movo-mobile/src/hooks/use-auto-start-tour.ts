import type { TourId } from "@movo/shared/dist/config/tours";
import { useEffect, useRef } from "react";
import { selectIsBlocked, useBlockingGatesStore } from "../store/blocking-gates-store";
import { useTourStore } from "../store/tour-store";
import { TOURS } from "../tours";
import { shouldAutoShowTour, type TourContext } from "../tours/types";
import { useMyProfile } from "./use-profile";

interface AutoStartOptions {
  /** Las condiciones propias de la pantalla (foco, datos cargados, requisitos). */
  enabled: boolean;
  /** Espera antes de arrancar, para que la pantalla termine de asentarse (prototipo). */
  delayMs: number;
  context: Partial<TourContext>;
}

/**
 * MOVO-169: arranca un tour solo cuando todavía no tiene registro (o el registrado es de
 * una versión anterior), no hay otro tour en curso ni una pantalla bloqueante encima, y la
 * pantalla dice que está lista. Se reevalúa cada vez que cambia alguna de esas condiciones
 * (ej. `canBrowse` pasa a `true` estando en el tab).
 */
export function useAutoStartTour(tourId: TourId, { enabled, delayMs, context }: AutoStartOptions) {
  const { data: profile } = useMyProfile();
  const pending = useTourStore((s) => s.pending);
  const pendingLoaded = useTourStore((s) => s.pendingLoaded);
  const tourActive = useTourStore((s) => s.active !== null);
  const blocked = useBlockingGatesStore(selectIsBlocked);
  const contextRef = useRef(context);
  contextRef.current = context;

  // `?? []` por si el backend todavía no expone `tours` (deploy de MOVO-169 en curso).
  const recorded = [...(profile?.tours ?? []), ...pending];
  const shouldShow = !!profile && pendingLoaded && shouldAutoShowTour(TOURS[tourId], recorded);
  const ready = enabled && shouldShow && !tourActive && !blocked;

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      const state = useTourStore.getState();
      if (state.active) return;
      state.startTour(tourId, { context: contextRef.current });
    }, delayMs);
    return () => clearTimeout(timer);
  }, [ready, tourId, delayMs]);
}
