import { Redirect, Stack } from 'expo-router';
import { View } from 'react-native';
import { TourOverlay, useTourOverlayVisible } from '../../components/tour/tour-overlay';
import { TripMatchAlertBanner } from '../../components/trips/trip-match-alert-banner';
import { useAccountRestrictionSync } from '../../src/hooks/use-account-restriction';
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
 *
 * MOVO-300: si la sesión se cerró porque la cuenta se inhabilitó con la app abierta, el guard
 * manda a la pantalla que lo explica en vez de al login. `useAccountRestrictionSync` mantiene
 * al día el aviso de suspensión.
 */
export default function AuthenticatedLayout() {
  const status = useAuthStore((s) => s.status);
  const signOutReason = useAuthStore((s) => s.signOutReason);

  if (status !== 'authenticated') {
    // `as any`: ruta nueva de MOVO-300, todavía fuera de los tipos generados de expo-router.
    return <Redirect href={(signOutReason === 'account_disabled' ? '/account-disabled' : '/login') as any} />;
  }

  return <AuthenticatedContent />;
}

function AuthenticatedContent() {
  usePendingToursFlush();
  useAccountRestrictionSync();
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
