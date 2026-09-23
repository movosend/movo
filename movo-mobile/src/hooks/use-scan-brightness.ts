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
 * reponerlo a mano -- también al pasar a background, si no el usuario se queda con
 * el brillo al máximo fuera de la app.
 *
 * Best-effort: cualquier fallo del módulo nativo se ignora, nunca rompe la pantalla.
 */
export function useScanBrightness(): void {
  useEffect(() => {
    let previous: number | null = null;
    let active = true;

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

    void raise();

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void raise();
      else if (state === "background") void restore();
    });

    return () => {
      active = false;
      subscription.remove();
      void restore();
    };
  }, []);
}
