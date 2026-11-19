import { useEffect, useRef, useState } from "react";
import type { TripWithAcceptedPackages } from "../api/trips-client";
import type { TripStartSheetProps } from "../../components/trips/trip-start-sheet";

/**
 * Confirmación de "Iniciar viaje" con `TripStartSheet`, compartida por Inicio, el detalle del viaje y el mapa.
 * Iniciar no se deshace (arranca el tracking), y en Inicio el botón ocupa media tarjeta: un toque pensado para
 * abrir el viaje lo iniciaba sin aviso (feedback de TestFlight).
 *
 * La acción corre en `onClosed`, con la hoja ya desmontada: el gate de ubicación que sigue puede abrir su propio
 * `Modal`, y iOS no presenta uno mientras otro se está cerrando (ver `BottomSheetModal#onClosed`). Si quien la
 * contiene se desmonta durante la animación de cierre, `onClosed` no llega: la acción confirmada corre en el
 * cleanup, así una confirmación nunca se pierde. Mientras hay una confirmación en curso (hoja abierta o cerrándose
 * con la acción pendiente), un segundo toque en "Iniciar viaje" no hace nada.
 */
export function useTripStartConfirm(): {
  requestStart: (trip: TripWithAcceptedPackages, onConfirm: () => void) => void;
  sheetProps: Pick<TripStartSheetProps, "visible" | "trip" | "onConfirm" | "onClose" | "onClosed">;
} {
  const [trip, setTrip] = useState<TripWithAcceptedPackages | null>(null);
  const [visible, setVisible] = useState(false);
  const requestedRef = useRef<(() => void) | null>(null);
  const confirmedRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      const action = confirmedRef.current;
      confirmedRef.current = null;
      action?.();
    },
    [],
  );

  return {
    requestStart: (nextTrip, onConfirm) => {
      if (requestedRef.current || confirmedRef.current) return;
      requestedRef.current = onConfirm;
      setTrip(nextTrip);
      setVisible(true);
    },
    sheetProps: {
      visible,
      trip,
      onConfirm: () => {
        confirmedRef.current = requestedRef.current;
        setVisible(false);
      },
      onClose: () => {
        confirmedRef.current = null;
        setVisible(false);
      },
      onClosed: () => {
        const action = confirmedRef.current;
        confirmedRef.current = null;
        requestedRef.current = null;
        action?.();
      },
    },
  };
}
