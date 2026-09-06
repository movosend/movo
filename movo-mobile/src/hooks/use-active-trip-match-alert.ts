import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { AvailableShipment } from "../api/shipments-client";
import { tripsClient, TripStatus } from "../api/trips-client";
import { useMyTrips } from "./use-trips";

const TRIP_MATCH_POLL_INTERVAL_MS = 30_000;
const TRIP_MATCH_ALERT_LIMIT = 5;
/** Cuánto queda pospuesto el aviso completo tras descartarlo (X) antes de poder
 * volver a aparecer — pedido explícito del usuario ("que cada cierto tiempo, o si se
 * cierra la app, vuelva a aparecer"). Es un solo timestamp por viaje, no por envío:
 * con el carrusel (feedback post-implementación, reemplaza a los botones Aceptar/
 * Rechazar) el aviso muestra todos los pendientes juntos, así que descartarlo
 * descarta el conjunto, no un ítem puntual. */
const TRIP_MATCH_SNOOZE_MS = 5 * 60_000;
/** Espera desde que se abre la app hasta que el aviso puede mostrarse por primera
 * vez — pedido explícito del usuario ("que no sea tan agresivo"): sin esto, si ya
 * había un match pendiente, la card podía saltar apenas se abría la app, antes de
 * que el usuario llegue siquiera a ver qué pantalla es. No aplica al polling en sí
 * (que sigue cada `TRIP_MATCH_POLL_INTERVAL_MS` desde el arranque) ni al snooze tras
 * un descarte — solo retrasa la primera aparición de la sesión. */
const TRIP_MATCH_STARTUP_DELAY_MS = 10_000;

/** `shipments` son todos los matches pendientes (sin oferta todavía) del viaje
 * vigilado — la card los muestra en un carrusel swipeable (`TripMatchAlertBanner`),
 * no de a uno. Siempre no vacío mientras `alert` no sea `null`. */
export interface TripMatchAlert {
  tripId: string;
  shipments: AvailableShipment[];
}

/**
 * MOVO-163 (extensión de alcance acordada con el usuario, "tipo Uber"): mientras el
 * transportista tiene un viaje `active` declarado y la app está en foreground, vigila
 * `GET /trips/:id/matches` con un polling propio y expone una alerta con los envíos
 * compatibles sobre los que todavía no ofertó (`hasMyOffer: false`). Pensado para un
 * aviso global (`TripMatchAlertBanner`, montado en `app/(app)/_layout.tsx`) — no
 * reemplaza a `useTripMatches` (el feed en sí, sin polling, MOVO-163 AC1-5).
 *
 * A diferencia de la primera versión (que solo alertaba una vez por envío nuevo y
 * nunca más), esta vigila permanentemente los matches **pendientes** — el aviso vuelve
 * a aparecer pasado `TRIP_MATCH_SNOOZE_MS` de haberse descartado, y también apenas se
 * reabre la app (el snooze vive en memoria, se resetea solo al relanzar) — pedido
 * explícito del usuario viéndolo corrido: "que cada cierto tiempo, o si se cierra la
 * app, vuelva a aparecer ese posible envío". Un envío puntual deja de listarse solo
 * cuando `hasMyOffer` pasa a `true` (ya ofertó) o deja de venir en la respuesta (ya no
 * está `published`/compatible) — no hay rechazo explícito por ítem (se evaluó un
 * botón "Rechazar" y se descartó a favor de dejar que el transportista simplemente
 * los recorra con el carrusel).
 *
 * Espera `TRIP_MATCH_STARTUP_DELAY_MS` desde que se abre la app antes de poder
 * mostrar el primer aviso de la sesión (pedido explícito del usuario, "que no sea
 * tan agresivo") — no retrasa el polling en sí ni el snooze tras un descarte, solo
 * la primera aparición.
 *
 * Simplificaciones aceptadas:
 * - Con más de un viaje `active` simultáneo, solo se vigila el primero que devuelve
 *   `useMyTrips()` — sin selector de "cuál viaje vigilar".
 * - El snooze vive en memoria (`useRef`), no persiste entre reinicios — que se
 *   resetee solo al relanzar la app es justamente el comportamiento pedido, no una
 *   limitación a documentar aparte.
 * - Polling manual con `AppState` (no `refetchInterval` de React Query): el repo no
 *   tiene `focusManager` de RN configurado, un interval nativo pausado en background
 *   es más predecible y evita gastar batería sin la app en primer plano.
 */
export function useActiveTripMatchAlert() {
  const { data: tripsData } = useMyTrips();
  const activeTrip = (tripsData?.items ?? []).find((trip) => trip.status === TripStatus.ACTIVE) ?? null;
  const activeTripId = activeTrip?.id ?? null;

  const dismissedUntilRef = useRef(0);
  const trackedTripIdRef = useRef<string | null>(null);
  const [alert, setAlert] = useState<TripMatchAlert | null>(null);
  const [startupDelayElapsed, setStartupDelayElapsed] = useState(false);

  // Corre una sola vez por sesión (el hook vive montado en `_layout.tsx` mientras
  // dure la app abierta) — no reinicia el timer si `activeTripId` cambia en el medio.
  useEffect(() => {
    const timeout = setTimeout(() => setStartupDelayElapsed(true), TRIP_MATCH_STARTUP_DELAY_MS);
    return () => clearTimeout(timeout);
  }, []);

  const matchesQuery = useQuery({
    queryKey: ["trips", "matches", "alert-watch", activeTripId],
    queryFn: () => tripsClient.getMatches(activeTripId!, { limit: TRIP_MATCH_ALERT_LIMIT }),
    enabled: !!activeTripId,
  });

  const refetchRef = useRef(matchesQuery.refetch);
  refetchRef.current = matchesQuery.refetch;

  // Reset al cambiar de viaje activo (o al perderlo) — un snooze de un viaje anterior
  // no tiene sentido para otro.
  useEffect(() => {
    if (trackedTripIdRef.current !== activeTripId) {
      dismissedUntilRef.current = 0;
      trackedTripIdRef.current = activeTripId;
      setAlert(null);
    }
  }, [activeTripId]);

  useEffect(() => {
    if (!activeTripId || !matchesQuery.data || !startupDelayElapsed) return;
    const pending = matchesQuery.data.items.filter((item) => !item.hasMyOffer);

    if (pending.length === 0) {
      setAlert(null);
      return;
    }
    if (Date.now() < dismissedUntilRef.current) return;

    setAlert({ tripId: activeTripId, shipments: pending });
  }, [activeTripId, matchesQuery.data, startupDelayElapsed]);

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
    /** Descarta el aviso completo (X) y lo pospone `TRIP_MATCH_SNOOZE_MS` — sigue
     * pudiendo reaparecer, tanto por el snooze como por un relanzamiento de la app. */
    dismiss: () => {
      dismissedUntilRef.current = Date.now() + TRIP_MATCH_SNOOZE_MS;
      setAlert(null);
    },
  };
}
