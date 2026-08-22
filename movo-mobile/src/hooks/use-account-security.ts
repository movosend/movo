import { useMutation } from "@tanstack/react-query";
import type { SessionResponse } from "../api/session-types";
import { usersClient, type ChangePasswordInput } from "../api/users-client";
import { useAuthStore } from "../store/auth-store";

type SetSession = (session: SessionResponse) => Promise<void>;

/**
 * Cambia la contraseña Y persiste la sesión nueva que devuelve el backend, como una
 * sola operación (MOVO-136 AC2 / backend MOVO-134).
 *
 * Que la persistencia viva acá adentro y no en un `onSuccess` de `useMutation` es
 * deliberado: `POST /users/me/password` revoca todas las sesiones del usuario en Redis
 * y emite un par de tokens nuevo. Si esa respuesta no se guarda, el access token en
 * memoria sigue funcionando (el JWT es stateless, ADR-004) y la app recién se rompe
 * cuando expira — hasta 60 minutos más tarde, con el refresh token ya revocado. Es un
 * fallo diferido e invisible en una prueba manual, así que no puede depender de que un
 * caller se acuerde de encadenar un callback: "cambiar la contraseña" y "guardar los
 * tokens" son un solo paso indivisible. De paso, garantiza el orden — la pantalla que
 * pasa su propio `onSuccess` a `mutate()` corre siempre después de que la sesión nueva
 * quedó escrita en secure-store.
 *
 * Exportada aparte del hook para poder testearla sin montar React ni un
 * `QueryClientProvider` (ver `test/use-account-security.test.ts`).
 */
export async function changePasswordAndPersistSession(
  setSession: SetSession,
  body: ChangePasswordInput,
): Promise<SessionResponse> {
  const session = await usersClient.changePassword(body);
  await setSession(session);
  return session;
}

export function useChangePassword() {
  const setSession = useAuthStore((s) => s.setSession);

  return useMutation<SessionResponse, unknown, ChangePasswordInput>({
    mutationFn: (body) => changePasswordAndPersistSession(setSession, body),
    // Un 401 acá es "la contraseña actual no es correcta", no una sesión vencida —
    // reintentar solo gastaría el rate limit del backend (5 intentos / 15 min por
    // usuario), así que se deja explícito el default de TanStack Query para
    // mutaciones (sin reintentos) para que no se cambie por descuido.
    retry: false,
  });
}
