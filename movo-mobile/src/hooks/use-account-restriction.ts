import { useEffect, useState } from "react";
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import { useQueryClient } from "@tanstack/react-query";
import { AccountStatus } from "@movo/shared/dist/types/user";
import type { OwnAccountSanction } from "@movo/shared/dist/types/account-sanctions";
import { registerAccountSuspendedListener } from "../api/http-client";
import {
  ACCOUNT_SANCTION_NOTIFICATION_TYPES,
  isActiveSuspension,
  notificationType,
} from "../lib/account-restriction";
import { useAuthStore } from "../store/auth-store";
import { MY_PROFILE_QUERY_KEY, useMyProfile } from "./use-profile";

/** `setTimeout` con un delay mayor a 2^31-1 ms dispara de inmediato: una suspensión de más de
 * ~24 días se re-evalúa al volver a primer plano o en el próximo refetch, no por timer. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Suspensión vigente del usuario logueado (MOVO-300), o `null`. Sale de `GET /users/me`
 * (`activeSanction`), así que la ven todas las pantallas que ya comparten esa query.
 *
 * AC7: cuando llega `endsAt`, re-renderiza (la suspensión deja de contar) e invalida el perfil
 * para traer el estado real, sin esperar al barrido de `svc-users` ni a un cierre de sesión.
 */
export function useActiveSuspension(): OwnAccountSanction | null {
  const queryClient = useQueryClient();
  const { data } = useMyProfile();
  const sanction = data?.activeSanction ?? null;
  const [, setTick] = useState(0);

  const endsAt = sanction?.type === "suspension" ? sanction.endsAt : null;
  useEffect(() => {
    if (!endsAt) return;
    const delay = new Date(endsAt).getTime() - Date.now();
    if (delay <= 0 || delay > MAX_TIMER_MS) return;
    const timer = setTimeout(() => {
      setTick((t) => t + 1);
      void queryClient.invalidateQueries({ queryKey: MY_PROFILE_QUERY_KEY });
    }, delay);
    return () => clearTimeout(timer);
  }, [endsAt, queryClient]);

  return isActiveSuspension(sanction) ? sanction : null;
}

/**
 * Mantiene al día el estado de la cuenta mientras hay sesión (MOVO-300). Se monta una vez en
 * `app/(app)/_layout.tsx`:
 * - AC3: un `403 ACCOUNT_SUSPENDED` (la suspensión se aplicó con la app abierta) refresca el
 *   perfil, y con eso aparecen el aviso y los botones bloqueados.
 * - AC7: al volver a primer plano se refresca el perfil, así un levantamiento hecho mientras la
 *   app estaba en segundo plano saca el aviso. Es un listener puntual y no el `focusManager`
 *   global de React Query, para no cambiar cuándo se refetchea el resto de la app. Lo mismo
 *   cuando llega un push de sanción con la app abierta (AC6).
 * - AC4: si el perfil dice que la cuenta está inhabilitada, cierra la sesión con ese motivo. Es
 *   lo que corta la sesión mientras no esté el `403 ACCOUNT_DISABLED` del gateway (MOVO-298), y
 *   después sigue sirviendo de respaldo.
 */
export function useAccountRestrictionSync(): void {
  const queryClient = useQueryClient();
  const { data: profile } = useMyProfile();
  const isDisabled = profile?.accountStatus === AccountStatus.BANNED;

  useEffect(() => {
    if (isDisabled) void useAuthStore.getState().signOutDisabledAccount();
  }, [isDisabled]);

  useEffect(() => {
    const refreshProfile = () =>
      void queryClient.invalidateQueries({ queryKey: MY_PROFILE_QUERY_KEY });
    const unregister = registerAccountSuspendedListener(refreshProfile);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshProfile();
    });
    const received = Notifications.addNotificationReceivedListener(
      (notification) => {
        const type = notificationType(notification.request.content.data);
        if (type && ACCOUNT_SANCTION_NOTIFICATION_TYPES.includes(type))
          refreshProfile();
      },
    );
    return () => {
      unregister();
      appState.remove();
      received.remove();
    };
  }, [queryClient]);
}
