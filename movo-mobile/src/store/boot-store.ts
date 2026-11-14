import { create } from "zustand";

interface BootState {
  /**
   * MOVO-247: pasa a `true` una única vez que `app/index.tsx` terminó de resolver a
   * dónde navegar en el arranque (Bienvenida / Home / Kyc) -- incluido haber llamado
   * a `router.replace` si correspondía (sesión autenticada, o continuación de
   * registro pendiente). `AnimatedSplash` (`app/_layout.tsx`) usa esta señal, junto
   * con fuentes/apiOverride/sesión, como la última condición para empezar su
   * animación de salida -- revelar antes de esto dejaría ver la pantalla de
   * Bienvenida por un instante seguido del push a Home/Kyc (el "push sobre la vista"
   * que este ticket vino a sacar): con el splash todavía tapando todo, esa
   * navegación pasa detrás del telón, invisible.
   */
  initialRouteResolved: boolean;
  markInitialRouteResolved: () => void;
  /**
   * Usuario para el que ya se decidió si volver al viaje en curso al llegar a Inicio (`useResumeActiveTrip`):
   * una vez por sesión de la app y por usuario, así volver a Inicio desde el viaje no lo reabre.
   */
  activeTripResumeCheckedFor: string | null;
  markActiveTripResumeChecked: (userId: string) => void;
}

export const useBootStore = create<BootState>((set, get) => ({
  initialRouteResolved: false,
  markInitialRouteResolved: () => {
    if (!get().initialRouteResolved) set({ initialRouteResolved: true });
  },
  activeTripResumeCheckedFor: null,
  markActiveTripResumeChecked: (userId) => {
    if (get().activeTripResumeCheckedFor !== userId) set({ activeTripResumeCheckedFor: userId });
  },
}));
