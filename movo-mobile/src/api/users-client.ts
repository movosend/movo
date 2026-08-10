import type { PrivateProfile } from "@movo/shared/dist/types/user-profile";
import { httpClient } from "./http-client";

/**
 * `PrivateProfile` viene de `@movo/shared` (MOVO-78, migrado desde
 * `services/movo-svc-users/src/models/user-profile.ts` para no duplicar el wire
 * contract) — subpath directo (`dist/types/user-profile`), nunca el barrel raíz
 * `@movo/shared` (arrastra `jsonwebtoken`/`node:crypto`, rompe Metro — mismo criterio
 * que `@movo/shared/dist/types/user` en el resto del mobile).
 */
export const usersClient = {
  /** Protegida — `httpClient` adjunta `Authorization` automáticamente vía el
   * interceptor de sesión (MOVO-76), no hay razón para pasar el header a mano acá
   * como sí hace `authClient.logout`. */
  getMyProfile(): Promise<PrivateProfile> {
    return httpClient.get<PrivateProfile>("/users/me");
  },
};
