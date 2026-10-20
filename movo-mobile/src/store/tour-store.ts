import type { TourId, UserTourRecord } from "@movo/shared/dist/config/tours";
import { create } from "zustand";
import { TOURS } from "../tours";
import type { TourContext, TourStep } from "../tours/types";

export interface TourRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Lo que registra `useTourAnchor`: el overlay mide recién cuando el paso es el suyo. */
export interface TourAnchorEntry {
  measure: () => Promise<TourRect | null>;
  /** Radio del elemento; el spotlight le suma `padding`. */
  radius: number;
  padding: number;
  /** Lleva el elemento a la vista si quedó fuera (ej. scroll de Inicio). */
  scrollIntoView?: () => void;
}

export interface ActiveTour {
  tourId: TourId;
  /** Relanzado desde "Ayuda y soporte": al terminar no se escribe `UserTour` (AC5). */
  manual: boolean;
  /** Pasos visibles: los de `when` falso ya quedaron afuera al arrancar. */
  steps: TourStep[];
  index: number;
  /** Para saltear un paso sin ancla en la misma dirección en que se venía (AC3). */
  direction: 1 | -1;
}

export interface FinishedTour {
  tourId: TourId;
  manual: boolean;
}

const EMPTY_CONTEXT: TourContext = { firstName: null, canBrowse: false, hasFeed: false };

interface TourState {
  active: ActiveTour | null;
  context: TourContext;
  anchors: Record<string, TourAnchorEntry>;
  /** Registros que todavía no confirmó el backend (`use-record-tour.ts`): cuentan como vistos. */
  pending: UserTourRecord[];
  pendingLoaded: boolean;
  startTour: (tourId: TourId, options?: { manual?: boolean; context?: Partial<TourContext> }) => void;
  next: () => void;
  prev: () => void;
  /** El ancla del paso actual no apareció: se lo saca de la lista sin colgar el tour. */
  skipCurrentStep: () => void;
  finish: () => FinishedTour | null;
  registerAnchor: (id: string, entry: TourAnchorEntry) => () => void;
  setPending: (pending: UserTourRecord[]) => void;
  addPending: (record: UserTourRecord) => void;
  removePending: (tourId: TourId) => void;
  /** Cambio de cuenta: los pendientes son de la sesión anterior y todavía no se leyeron los nuevos. */
  resetPending: () => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  active: null,
  context: EMPTY_CONTEXT,
  anchors: {},
  pending: [],
  pendingLoaded: false,

  startTour: (tourId, options = {}) => {
    const context = { ...EMPTY_CONTEXT, ...options.context };
    const steps = TOURS[tourId].steps.filter((step) => step.when?.(context) ?? true);
    set({ context, active: { tourId, manual: options.manual ?? false, steps, index: 0, direction: 1 } });
  },

  next: () =>
    set((state) => {
      if (!state.active || state.active.index >= state.active.steps.length - 1) return state;
      return { active: { ...state.active, index: state.active.index + 1, direction: 1 } };
    }),

  prev: () =>
    set((state) => {
      if (!state.active || state.active.index === 0) return state;
      return { active: { ...state.active, index: state.active.index - 1, direction: -1 } };
    }),

  skipCurrentStep: () =>
    set((state) => {
      if (!state.active) return state;
      const { steps, index, direction } = state.active;
      const remaining = steps.filter((_, i) => i !== index);
      // Hacia adelante el siguiente queda en el mismo índice; hacia atrás, en el anterior.
      const nextIndex = direction === -1 ? Math.max(0, index - 1) : index;
      return { active: { ...state.active, steps: remaining, index: nextIndex } };
    }),

  finish: () => {
    const { active } = get();
    if (!active) return null;
    set({ active: null });
    return { tourId: active.tourId, manual: active.manual };
  },

  registerAnchor: (id, entry) => {
    set((state) => ({ anchors: { ...state.anchors, [id]: entry } }));
    return () =>
      set((state) => {
        // Si otra instancia ya registró el mismo id, no se la pisa al desmontar esta.
        if (state.anchors[id] !== entry) return state;
        const { [id]: _removed, ...rest } = state.anchors;
        return { anchors: rest };
      });
  },

  setPending: (pending) => set({ pending, pendingLoaded: true }),
  addPending: (record) =>
    set((state) => ({ pending: [...state.pending.filter((item) => item.tourId !== record.tourId), record] })),
  removePending: (tourId) => set((state) => ({ pending: state.pending.filter((item) => item.tourId !== tourId) })),
  resetPending: () => set({ pending: [], pendingLoaded: false }),
}));

export function selectCurrentStep(state: Pick<TourState, "active">): TourStep | null {
  return state.active?.steps[state.active.index] ?? null;
}
