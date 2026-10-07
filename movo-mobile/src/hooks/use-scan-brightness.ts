import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import * as Brightness from "expo-brightness";

const SCAN_BRIGHTNESS = 1;

/**
 * Sube el brillo de la pantalla al máximo mientras el componente que lo usa está
 * montado (una pantalla que muestra un QR para que otro lo escanee) y lo devuelve al
 * valor previo al desmontar.
 *
 * `setBrightnessAsync` no pide permisos: en Android solo afecta a la activity actual
 * (se restaura con `restoreSystemBrightnessAsync`); en iOS cambia el brillo del
 * dispositivo hasta que se bloquea, así que hay que guardar el valor previo y
 * reponerlo a mano -- también al dejar de estar `active` (background, pero también
 * `inactive`: centro de control, llamada entrante), si no el usuario se queda con el
 * brillo al máximo fuera de la app.
 *
 * Las llamadas nativas se encadenan en una cola: si el desmontaje llega con un
 * `raise()` todavía en vuelo, el `restore()` corre recién después, así el último
 * valor aplicado siempre es el previo y nunca queda el brillo al máximo.
 *
 * Best-effort: cualquier fallo del módulo nativo se ignora, nunca rompe la pantalla.
 */
export function useScanBrightness(): void {
  useEffect(() => {
    let previous: number | null = null;
    let active = true;
    let queue: Promise<void> = Promise.resolve();
    // Cada paso ya atrapa sus propios errores, así que la cola nunca queda rechazada.
    const enqueue = (step: () => Promise<void>) => {
      queue = queue.then(step);
    };

    async function raise() {
      try {
        if (previous === null) previous = await Brightness.getBrightnessAsync();
        if (!active) return;
        await Brightness.setBrightnessAsync(SCAN_BRIGHTNESS);
      } catch {
        // Sin módulo nativo (Expo Go viejo, simulador) no hay nada que hacer.
      }
    }

    async function restore() {
      try {
        if (Platform.OS === "android") {
          await Brightness.restoreSystemBrightnessAsync();
        } else if (previous !== null) {
          await Brightness.setBrightnessAsync(previous);
        }
      } catch {
        // Idem.
      }
    }

    enqueue(raise);

    const subscription = AppState.addEventListener("change", (state) => {
      enqueue(state === "active" ? raise : restore);
    });

    return () => {
      active = false;
      subscription.remove();
      enqueue(restore);
    };
  }, []);
}
