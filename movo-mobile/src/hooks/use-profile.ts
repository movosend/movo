import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PrivateProfile } from "@movo/shared/dist/types/user-profile";
import {
  usersClient,
  type OtpRequestResponse,
  type OtpVerifyInput,
  type UpdateProfileInput,
} from "../api/users-client";
import { useAuthStore } from "../store/auth-store";

export const MY_PROFILE_QUERY_KEY = ["profile", "me"] as const;

/**
 * `GET /users/me` (MOVO-78, MOVO-77 backend). Expone `data`/`isLoading`/`isError`/
 * `refetch` de TanStack Query tal cual — la pantalla de perfil los consume directo
 * para sus estados de skeleton/error con reintentar (AC8), sin envolver de más.
 *
 * `enabled` (default `true`) existe para callers que todavía pueden no tener una
 * sesión autenticada activa en el momento del mount (`app/(auth)/profile-photo.tsx`,
 * MOVO-98) — sin esto, el primer fetch sale sin `Authorization` (el interceptor de
 * `http-client.ts` no tiene token que adjuntar todavía) y TanStack Query lo reintenta
 * en vano hasta que la sesión se activa.
 */
export function useMyProfile(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: MY_PROFILE_QUERY_KEY,
    queryFn: usersClient.getMyProfile,
    enabled: options?.enabled ?? true,
  });
}

/** Proyección pública de un usuario (`GET /users/:id`, MOVO-77) — usada por la card
 * de receptor/transportista del detalle de envío (MOVO-127). `enabled` solo con un id
 * real (nunca `undefined` — p.ej. transportista antes de asignarse). */
export function usePublicProfile(id: string | undefined) {
  return useQuery({
    queryKey: ["profile", "public", id],
    queryFn: () => usersClient.getPublicProfile(id!),
    enabled: !!id,
  });
}

/** Varias proyecciones públicas a la vez — mismo query key por id que `usePublicProfile`
 * (comparten cache, `useQueries` no dispara de nuevo lo que ya esté cacheado), usado
 * por el filtro "Destinatario" de "Mis Envíos" (MOVO-127) para resolver los nombres de
 * los receptores únicos de la tab activa antes de listarlos como opciones. */
export function usePublicProfiles(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ["profile", "public", id],
      queryFn: () => usersClient.getPublicProfile(id),
    })),
  });
}

/**
 * Siembra la cache de `useMyProfile` con un `PrivateProfile` recién devuelto por el
 * backend, en vez de invalidar y refetchear.
 *
 * Los tres endpoints de escritura de MOVO-133 (`PATCH /users/me` y los dos `verify`
 * de teléfono/email) responden el perfil completo, así que un refetch sería una
 * request de más y dejaría a la tab de perfil mostrando el dato viejo durante ese
 * viaje de ida y vuelta. El AC2 pide justamente lo contrario: que al volver el
 * cambio ya esté reflejado.
 *
 * Sincroniza además `fullName` en el store de sesión: vive persistido en
 * secure-store (`SessionUser`) y `home.tsx` lo usa como fallback del saludo, así que
 * sin esto el nombre viejo sobreviviría al cambio hasta el próximo login.
 */
function useProfileMutationSuccess() {
  const queryClient = useQueryClient();
  const updateFullName = useAuthStore((s) => s.updateFullName);

  return (profile: PrivateProfile) => {
    queryClient.setQueryData(MY_PROFILE_QUERY_KEY, profile);
    void updateFullName(profile.fullName);
  };
}

/** `PATCH /users/me` — nombre y apellido (MOVO-133/MOVO-135 AC2). */
export function useUpdateProfile() {
  const onProfileUpdated = useProfileMutationSuccess();
  return useMutation<PrivateProfile, unknown, UpdateProfileInput>({
    mutationFn: (body) => usersClient.updateProfile(body),
    onSuccess: onProfileUpdated,
  });
}

/** Paso 1 del cambio de teléfono — no toca la cache: todavía no cambió nada. */
export function useRequestPhoneChange() {
  return useMutation<OtpRequestResponse, unknown, string>({
    mutationFn: (phone) => usersClient.requestPhoneChange(phone),
  });
}

/** Paso 2 del cambio de teléfono (AC4). */
export function useVerifyPhoneChange() {
  const onProfileUpdated = useProfileMutationSuccess();
  return useMutation<PrivateProfile, unknown, OtpVerifyInput>({
    mutationFn: (body) => usersClient.verifyPhoneChange(body),
    onSuccess: onProfileUpdated,
  });
}

/** Paso 1 del cambio de email — el OTP viaja al email nuevo (MOVO-139), no toca la
 * cache: todavía no cambió nada. */
export function useRequestEmailChange() {
  return useMutation<OtpRequestResponse, unknown, string>({
    mutationFn: (email) => usersClient.requestEmailChange(email),
  });
}

/** Paso 2 del cambio de email (AC5). */
export function useVerifyEmailChange() {
  const onProfileUpdated = useProfileMutationSuccess();
  return useMutation<PrivateProfile, unknown, OtpVerifyInput>({
    mutationFn: (body) => usersClient.verifyEmailChange(body),
    onSuccess: onProfileUpdated,
  });
}

/** Paso 1 de verificar el email ACTUAL (MOVO-139) — CTA de la pantalla de perfil
 * para cuentas sin verificar. No toca la cache: todavía no cambió nada. */
export function useRequestEmailVerification() {
  return useMutation<OtpRequestResponse, unknown, void>({
    mutationFn: () => usersClient.requestEmailVerification(),
  });
}

/** Paso 2 de verificar el email actual: solo marca `emailVerified`, el email en sí
 * no cambia. */
export function useVerifyEmailVerification() {
  const onProfileUpdated = useProfileMutationSuccess();
  return useMutation<PrivateProfile, unknown, OtpVerifyInput>({
    mutationFn: (body) => usersClient.verifyEmailVerification(body),
    onSuccess: onProfileUpdated,
  });
}

/** Conexiones mutuas con otro usuario (MOVO-174, todavía sin backend en
 * `svc-users`) para el rediseño de perfil — falla/carga independiente del resto
 * de la pantalla, mismo criterio que `useSharedHistory`. */
export function useMutualConnections(id: string | undefined) {
  return useQuery({
    queryKey: ["profile", "mutual-connections", id],
    queryFn: () => usersClient.getMutualConnections(id!),
    enabled: !!id,
  });
}
