import { Redirect, Stack } from 'expo-router';
import { useAuthStore } from '../../src/store/auth-store';

/**
 * Guard de navegación (AC9): un solo lugar. Cualquier pantalla nueva agregada dentro
 * de `app/(app)/` queda protegida gratis, sin repetir el chequeo pantalla por
 * pantalla. `status === "checking"` no debería llegar a renderizarse acá — el splash
 * de `app/_layout.tsx` ya tapa toda la app hasta que `restoreSession()` resuelve — pero
 * se cubre igual de forma defensiva.
 */
export default function AuthenticatedLayout() {
  const status = useAuthStore((s) => s.status);

  if (status !== 'authenticated') {
    return <Redirect href="/login" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
