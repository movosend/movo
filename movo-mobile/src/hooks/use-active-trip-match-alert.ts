import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { tripsClient, TripStatus } from "../api/trips-client";
import { useMyTrips } from "./use-trips";

const TRIP_MATCH_POLL_INTERVAL_MS = 30_000;
const TRIP_MATCH_ALERT_LIMIT = 5;

export interface TripMatchAlert {
  tripId: string;
  newCount: number;
}

/**
 * MOVO-163 (extensión de alcance acordada con el usuario, "tipo Uber"): mientras el
 * transportista tiene un viaje `active` declarado y la app está en foreground, vigila
 * `GET /trips/:id/matches` con un polling propio y expone una alerta cuando aparecen
 * envíos nuevos que no estaban en el poll anterior. Pensado para un aviso global
 * (`TripMatchAlertBanner`, montado en `app/(app)/_layout.tsx`) — no reemplaza a
 * `useTripMatches` (el feed en sí, sin polling, MOVO-163 AC1-5).
 *
 * Simplificaciones aceptadas:
 * - Con más de un viaje `active` simultáneo, solo se vigila el primero que devuelve
 *   `useMyTrips()` — sin selector de "cuál viaje vigilar".
 * - Sin persistencia entre reinicios de la app: los "ya vistos" viven en memoria
 *   (`useRef`), se resetean al abrir la app de nuevo.
 * - Polling manual con `AppState` (no `refetchInterval` de React Query): el repo no
 *   tiene `focusManager` de RN configurado, un interval nativo pausado en background
 *   es más predecible y evita gastar batería sin la app en primer plano.
 */
export function useActiveTripMatchAlert() {
  const { data: tripsData } = useMyTrips();
  const activeTrip = (tripsData?.items ?? []).find((trip) => trip.status === TripStatus.ACTIVE) ?? null;
  const activeTripId = activeTrip?.id ?? null;

  const seenIdsRef = useRef<Set<string> | null>(null);
  const seededTripIdRef = useRef<string | null>(null);
  const [alert, setAlert] = useState<TripMatchAlert | null>(null);

  const matchesQuery = useQuery({
    queryKey: ["trips", "matches", "alert-watch", activeTripId],
    queryFn: () => tripsClient.getMatches(activeTripId!, { limit: TRIP_MATCH_ALERT_LIMIT }),
    enabled: !!activeTripId,
  });

  const refetchRef = useRef(matchesQuery.refetch);
  refetchRef.current = matchesQuery.refetch;

  // Reset al cambiar de viaje activo (o al perderlo) — un "ya visto" de un viaje
  // anterior no tiene sentido para otro.
  useEffect(() => {
    if (seededTripIdRef.current !== activeTripId) {
      seenIdsRef.current = null;
      seededTripIdRef.current = activeTripId;
      setAlert(null);
    }
  }, [activeTripId]);

  useEffect(() => {
    if (!activeTripId || !matchesQuery.data) return;
    const currentIds = matchesQuery.data.items.map((item) => item.id);

    if (seenIdsRef.current === null) {
      // Primera respuesta para este viaje: sembrar sin alertar — no avisar por todo
      // el historial ya existente apenas se abre la app.
      seenIdsRef.current = new Set(currentIds);
      return;
    }

    const newIds = currentIds.filter((id) => !seenIdsRef.current!.has(id));
    if (newIds.length > 0) {
      newIds.forEach((id) => seenIdsRef.current!.add(id));
      setAlert({ tripId: activeTripId, newCount: newIds.length });
    }
  }, [activeTripId, matchesQuery.data]);

  useEffect(() => {
    if (!activeTripId) return;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (intervalId) return;
      intervalId = setInterval(() => {
        void refetchRef.current();
      }, TRIP_MATCH_POLL_INTERVAL_MS);
    };
    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    if (AppState.currentState === "active") startPolling();

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void refetchRef.current();
        startPolling();
      } else {
        stopPolling();
      }
    });

    return () => {
      stopPolling();
      subscription.remove();
    };
  }, [activeTripId]);

  return {
    alert,
    dismiss: () => setAlert(null),
  };
}
