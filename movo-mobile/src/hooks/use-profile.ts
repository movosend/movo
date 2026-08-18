import { useQuery } from "@tanstack/react-query";
import { usersClient } from "../api/users-client";

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
    queryKey: ["profile", "me"],
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
