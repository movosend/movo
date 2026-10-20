import { create } from "zustand";

/**
 * MOVO-169: si hay una pantalla bloqueante encima de la app (permisos, ubicación del
 * transportista, aceptación legal o el aviso de envío compatible). El tutorial espera a que
 * no haya ninguna: esas pantallas son `Modal` nativos y taparían el overlay del tour.
 *
 * `mounted` arranca en `false` porque `BlockingGatesMount` se monta recién al terminar el
 * splash: hasta entonces todavía no se sabe si va a aparecer alguna.
 */
interface BlockingGatesState {
  mounted: boolean;
  gateVisible: boolean;
  tripMatchVisible: boolean;
  setGates: (gates: { mounted: boolean; gateVisible: boolean }) => void;
  setTripMatchVisible: (visible: boolean) => void;
}

export const useBlockingGatesStore = create<BlockingGatesState>((set) => ({
  mounted: false,
  gateVisible: false,
  tripMatchVisible: false,
  setGates: ({ mounted, gateVisible }) =>
    set((state) => (state.mounted === mounted && state.gateVisible === gateVisible ? state : { mounted, gateVisible })),
  setTripMatchVisible: (tripMatchVisible) =>
    set((state) => (state.tripMatchVisible === tripMatchVisible ? state : { tripMatchVisible })),
}));

export function selectIsBlocked(state: Pick<BlockingGatesState, "mounted" | "gateVisible" | "tripMatchVisible">) {
  return !state.mounted || state.gateVisible || state.tripMatchVisible;
}
