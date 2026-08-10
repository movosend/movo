import { useQuery } from "@tanstack/react-query";
import { usersClient } from "../api/users-client";

/**
 * `GET /users/me` (MOVO-78, MOVO-77 backend). Expone `data`/`isLoading`/`isError`/
 * `refetch` de TanStack Query tal cual — la pantalla de perfil los consume directo
 * para sus estados de skeleton/error con reintentar (AC8), sin envolver de más.
 */
export function useMyProfile() {
  return useQuery({
    queryKey: ["profile", "me"],
    queryFn: usersClient.getMyProfile,
  });
}
