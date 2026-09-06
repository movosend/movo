import { Redirect, Stack } from 'expo-router';
import { View } from 'react-native';
import { TripMatchAlertBanner } from '../../components/trips/trip-match-alert-banner';
import { useAuthStore } from '../../src/store/auth-store';

/**
 * Guard de navegación (AC9): un solo lugar. Cualquier pantalla nueva agregada dentro
 * de `app/(app)/` queda protegida gratis, sin repetir el chequeo pantalla por
 * pantalla. `status === "checking"` no debería llegar a renderizarse acá — el splash
 * de `app/_layout.tsx` ya tapa toda la app hasta que `restoreSession()` resuelve — pero
 * se cubre igual de forma defensiva.
 *
 * `TripMatchAlertBanner` (MOVO-163) vive acá, hermano superpuesto del `<Stack>`, en
 * vez de en una pantalla puntual — es el único lugar común a toda la app
 * autenticada, y el aviso tiene que verse sin importar en qué pantalla esté el
 * usuario.
 */
export default function AuthenticatedLayout() {
  const status = useAuthStore((s) => s.status);

  if (status !== 'authenticated') {
    return <Redirect href="/login" />;
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      <TripMatchAlertBanner />
    </View>
  );
}
