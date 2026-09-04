import { useCallback, useEffect, useState } from "react";
import { DEFAULT_TRANSPORT_RADIUS_KM } from "./use-shipments";
import { SECURE_STORE_KEYS, secureStore } from "../lib/secure-store";

/**
 * Radio del tab "Transportar" (MOVO-148, AC3), persistido localmente para no
 * repreguntarlo en cada apertura. Arranca en el default mientras se lee el valor
 * guardado — evita un parpadeo entre "sin selección" y el valor real, a costa de una
 * request de más si el usuario cambió el radio antes de que la lectura terminara (caso
 * borde aceptado, el guardado es idempotente).
 */
export function useTransportRadius() {
  const [radiusKm, setRadiusKmState] = useState(DEFAULT_TRANSPORT_RADIUS_KM);

  useEffect(() => {
    let cancelled = false;
    secureStore.getItem(SECURE_STORE_KEYS.transportRadiusKm).then((stored) => {
      if (cancelled || !stored) return;
      const parsed = Number(stored);
      if (!Number.isNaN(parsed)) setRadiusKmState(parsed);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setRadiusKm = useCallback((value: number) => {
    setRadiusKmState(value);
    void secureStore.setItem(SECURE_STORE_KEYS.transportRadiusKm, String(value));
  }, []);

  return { radiusKm, setRadiusKm };
}
