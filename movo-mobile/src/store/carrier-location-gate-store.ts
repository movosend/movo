import { create } from "zustand";
import {
  firstMissingRequirement,
  getCarrierLocationReadiness,
} from "../lib/carrier-location-readiness";

type PendingAction = () => void | Promise<void>;

interface CarrierLocationGateState {
  /** Hay una acción de transportista esperando a que se cumplan los requisitos. */
  requested: boolean;
  pendingAction: PendingAction | null;
  onCancel: (() => void) | null;
  open: (action: PendingAction, onCancel?: () => void) => void;
  /** Saca la acción pendiente sin ejecutarla (la ejecuta el gate). */
  take: () => PendingAction | null;
  cancel: () => void;
}

/**
 * Estado compartido entre las pantallas que disparan una acción de transportista
 * (ofertar, declarar/iniciar un viaje, retirar) y el único gate montado en
 * `app/_layout.tsx`. Una sola instancia del `Modal` en toda la app: dos `Modal`
 * nativos presentándose a la vez no conviven en iOS.
 */
export const useCarrierLocationGateStore = create<CarrierLocationGateState>((set, get) => ({
  requested: false,
  pendingAction: null,
  onCancel: null,
  open: (action, onCancel) => set({ requested: true, pendingAction: action, onCancel: onCancel ?? null }),
  take: () => {
    const action = get().pendingAction;
    set({ requested: false, pendingAction: null, onCancel: null });
    return action;
  },
  cancel: () => {
    const onCancel = get().onCancel;
    set({ requested: false, pendingAction: null, onCancel: null });
    onCancel?.();
  },
}));

// Hay una llamada a `requireCarrierLocation` en curso (releyendo permisos o corriendo
// la acción). Vive a nivel de módulo y no en cada pantalla: cubre a todos los callers
// de una sola vez.
let inFlight = false;

/**
 * Corre `action` si el transportista ya cumple los requisitos de ubicación
 * (`carrier-location-readiness.ts`); si no, abre la pantalla de acceso y la corre
 * sola apenas se cumplan. `onCancel` se llama si el usuario sale de esa pantalla sin
 * resolverlos.
 *
 * Un segundo llamado mientras el primero sigue en curso se descarta: leer los
 * permisos son tres llamadas nativas, y durante esa espera la mutación del caller
 * todavía no está `isPending`, así que su botón sigue habilitado — sin esto, un doble
 * tap creaba dos viajes o disparaba dos `POST /trips/:id/start`.
 */
export async function requireCarrierLocation(
  action: PendingAction,
  options?: { onCancel?: () => void },
): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const readiness = await getCarrierLocationReadiness();
    if (firstMissingRequirement(readiness) === null) {
      await action();
      return;
    }
    useCarrierLocationGateStore.getState().open(action, options?.onCancel);
  } finally {
    inFlight = false;
  }
}
