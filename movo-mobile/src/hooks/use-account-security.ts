import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
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

type ClearSession = () => Promise<void>;

/**
 * Da de baja la cuenta Y borra todo rastro local de la sesión, como una sola
 * operación (MOVO-136 AC6 / backend MOVO-134). Mismo criterio que
 * `changePasswordAndPersistSession()`: el efecto local no es un `onSuccess`
 * opcional, es parte de la operación.
 *
 * Dos cosas que no se pueden invertir ni omitir:
 *
 * - **`clearSession()`, nunca `logout()`.** `logout()` pega contra
 *   `POST /auth/logout` y `DELETE /notifications/push-tokens` con el access token de
 *   una cuenta que el backend ya anonimizó y cuyas sesiones ya revocó: son dos
 *   requests condenados a fallar (los tolera, pero es ruido) contra recursos que ya
 *   no existen. La baja ya hace del lado del servidor todo lo que `logout()` haría.
 * - **`queryClient.clear()` antes de limpiar la sesión.** El guard de
 *   `app/(app)/_layout.tsx` redirige a `/login` en cuanto `status` deja de ser
 *   `authenticated`; si la caché de TanStack Query sobreviviera, el perfil, los
 *   envíos y las direcciones de la cuenta recién borrada quedarían en memoria y se
 *   pintarían por un frame en el próximo login de OTRO usuario en el mismo
 *   dispositivo (AC6: "sin sesión guardada ni caché de perfil").
 */
export async function deleteAccountAndClearSession(
  clearSession: ClearSession,
  queryClient: QueryClient,
  password: string,
): Promise<void> {
  await usersClient.deleteAccount(password);
  queryClient.clear();
  await clearSession();
}

export function useDeleteAccount() {
  const clearSession = useAuthStore((s) => s.clearSession);
  const queryClient = useQueryClient();

  return useMutation<void, unknown, string>({
    mutationFn: (password) => deleteAccountAndClearSession(clearSession, queryClient, password),
    // Igual que en `useChangePassword`: un 401 acá es "la contraseña no es correcta"
    // y los 409 son estados del servidor que solo el usuario puede resolver
    // (cancelar un envío, esperar una disputa). Reintentar solo gastaría el rate
    // limit del backend.
    retry: false,
  });
}
