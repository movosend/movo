import { Redirect, Stack } from 'expo-router';
import { View } from 'react-native';
import { TourOverlay, useTourOverlayVisible } from '../../components/tour/tour-overlay';
import { TripMatchAlertBanner } from '../../components/trips/trip-match-alert-banner';
import { usePendingToursFlush } from '../../src/hooks/use-record-tour';
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
 *
 * `TourOverlay` (MOVO-169) también: el tutorial cruza tabs y tiene que tapar la tab bar.
 * Mientras está a la vista, el resto de la app queda oculto a los lectores de pantalla.
 */
export default function AuthenticatedLayout() {
  const status = useAuthStore((s) => s.status);

  if (status !== 'authenticated') {
    return <Redirect href="/login" />;
  }

  return <AuthenticatedContent />;
}

function AuthenticatedContent() {
  usePendingToursFlush();
  const tourVisible = useTourOverlayVisible();

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={tourVisible}
        importantForAccessibility={tourVisible ? 'no-hide-descendants' : 'auto'}
      >
        <Stack screenOptions={{ headerShown: false }} />
      </View>
      <TripMatchAlertBanner />
      <TourOverlay />
    </View>
  );
}
