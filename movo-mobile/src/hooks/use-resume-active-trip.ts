import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { TripStatus, type TripWithAcceptedPackages } from "../api/trips-client";
import { useBootStore } from "../store/boot-store";

/**
 * Feedback de TestFlight: "si cierro la app, aparezco en la pantalla de inicio y no en el viaje en curso". Al llegar
 * a Inicio después de abrir la app (o de iniciar sesión), si el transportista tiene un viaje en curso, lo lleva a su
 * pantalla (`/route`), con Inicio debajo para volver.
 *
 * Decide una sola vez por sesión de la app y por usuario (`activeTripResumeCheckedFor`): volver a Inicio desde el
 * viaje no lo reabre. Espera a que Inicio esté enfocada (en el arranque puede montarse sin foco todavía, durante el
 * `replace` desde `/`); si Inicio estuvo enfocada y la dejó antes de decidir (la app se abrió desde una notificación
 * que navegó a otra pantalla), no la pisa al volver. Sin la lista de viajes no decide: espera a que llegue.
 */
export function useResumeActiveTrip(input: {
  userId: string | null | undefined;
  isCarrier: boolean;
  isFocused: boolean;
  trips: TripWithAcceptedPackages[] | undefined;
}): void {
  const { userId, isCarrier, isFocused, trips } = input;
  const checkedFor = useBootStore((s) => s.activeTripResumeCheckedFor);
  const markChecked = useBootStore((s) => s.markActiveTripResumeChecked);
  const wasFocusedRef = useRef(false);

  useEffect(() => {
    if (!userId || checkedFor === userId) return;
    if (!isFocused) {
      // Dejó Inicio antes de que se pudiera decidir: otra pantalla tomó el arranque.
      if (wasFocusedRef.current) markChecked(userId);
      return;
    }
    wasFocusedRef.current = true;
    if (!isCarrier || trips === undefined) return;
    markChecked(userId);
    // Mismo criterio que "Estoy transportando" (`splitCarrierHomeTrips`): un `active` sin paquetes vivos ya no está en curso.
    const activeTrip = trips.find((t) => t.status === TripStatus.ACTIVE && t.hasAcceptedPackages);
    if (activeTrip) router.push({ pathname: "/route", params: { tripId: activeTrip.id } } as never);
  }, [userId, checkedFor, isCarrier, isFocused, trips, markChecked]);
}
