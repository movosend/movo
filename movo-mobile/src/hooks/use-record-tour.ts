import type { UserTourRecord } from "@movo/shared/dist/config/tours";
import type { PrivateProfile } from "@movo/shared/dist/types/user-profile";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { usersClient } from "../api/users-client";
import { addPendingTour, readPendingTours, removePendingTour } from "../lib/tour-pending";
import { useAuthStore } from "../store/auth-store";
import { useTourStore } from "../store/tour-store";
import { MY_PROFILE_QUERY_KEY } from "./use-profile";

/** Reemplaza (o suma) el registro del tour en el perfil cacheado, sin esperar al backend. */
function applyTourToProfileCache(queryClient: QueryClient, record: UserTourRecord) {
  queryClient.setQueryData<PrivateProfile>(MY_PROFILE_QUERY_KEY, (profile) => {
    if (!profile) return profile;
    // `?? []` por si el backend todavía no expone `tours` (deploy de MOVO-169 en curso).
    const tours = (profile.tours ?? []).filter((item) => item.tourId !== record.tourId);
    return { ...profile, tours: [...tours, record] };
  });
}

async function sendTourRecord(queryClient: QueryClient, userId: string | undefined, record: UserTourRecord) {
  const saved = await usersClient.recordTour(record.tourId, { version: record.version, outcome: record.outcome });
  // El pendiente persistido es de `userId`, se borra siempre; el store y el cache son de la
  // sesión en curso: si la cuenta cambió mientras el PUT estaba en vuelo, no son de este registro.
  if (userId) await removePendingTour(userId, record.tourId);
  if (useAuthStore.getState().user?.userId !== userId) return saved;
  useTourStore.getState().removePending(record.tourId);
  applyTourToProfileCache(queryClient, saved);
  return saved;
}

/**
 * MOVO-169 (AC4): `PUT /users/me/tours/:tourId` con actualización optimista. El registro
 * entra al perfil cacheado y a los pendientes antes del `PUT`, así el tour no reaparece si
 * el `PUT` tarda o falla. Un `PUT` fallido queda pendiente y se reintenta en el próximo
 * arranque (`usePendingToursFlush`).
 */
export function useRecordTour() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.userId);

  return useMutation<UserTourRecord, unknown, UserTourRecord>({
    onMutate: (record) => {
      useTourStore.getState().addPending(record);
      applyTourToProfileCache(queryClient, record);
    },
    mutationFn: async (record) => {
      if (userId) await addPendingTour(userId, record);
      return sendTourRecord(queryClient, userId, record);
    },
  });
}

/**
 * Carga los registros pendientes de la cuenta y los reintenta. Se monta una sola vez, en
 * el layout autenticado; hasta que termina de leerlos, ningún tour arranca solo
 * (`pendingLoaded`).
 */
export function usePendingToursFlush() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.userId);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const pending = await readPendingTours(userId);
      if (cancelled) return;
      useTourStore.getState().setPending(pending);
      for (const record of pending) {
        applyTourToProfileCache(queryClient, record);
        try {
          await sendTourRecord(queryClient, userId, record);
        } catch {
          // Sigue pendiente: se reintenta en el próximo arranque.
        }
      }
    })();
    return () => {
      cancelled = true;
      useTourStore.getState().resetPending();
    };
  }, [userId, queryClient]);
}
