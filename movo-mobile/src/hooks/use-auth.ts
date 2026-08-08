import { useAuthStore } from "../store/auth-store";

/**
 * Wrapper fino sobre `useAuthStore` para componentes — da una API estable y evita
 * que las pantallas importen el store crudo de Zustand.
 */
export function useAuth() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return {
    status,
    user,
    isAuthenticated: status === "authenticated",
    logout,
  };
}
