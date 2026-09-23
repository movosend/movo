import '../global.css';

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts as useInterFonts,
} from '@expo-google-fonts/inter';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
  useFonts as useJetBrainsMonoFonts,
} from '@expo-google-fonts/jetbrains-mono';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useColorScheme } from 'nativewind';
import { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { Stack, usePathname } from 'expo-router';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { LegalEntrySheet } from '../components/legal/legal-entry-sheet';
import { RequiredPermissionsGate } from '../components/permissions/required-permissions-gate';
import { useDeviceKeyBootstrap } from '../src/hooks/use-device-key-bootstrap';
import { useLegalAcceptanceEntry } from '../src/hooks/use-legal-acceptance-entry';
import { useRequiredPermissionsGate } from '../src/hooks/use-required-permissions-gate';
import { usePushNotifications } from '../src/hooks/use-push-notifications';
import { RegistrationProvider } from '../src/hooks/use-registration';
import { loadApiOverride } from '../src/lib/api-override';
import { useAuthStore } from '../src/store/auth-store';

SplashScreen.preventAutoHideAsync();

/**
 * MOVO-229 depende de `useMyProfile()` (React Query) — tiene que vivir DENTRO del
 * árbol de `QueryClientProvider`, no en el propio `RootLayout` (que es quien lo
 * define: su cuerpo de función no es descendiente de su propio JSX de salida).
 */
function LegalAcceptanceEntryMount() {
  const entry = useLegalAcceptanceEntry();
  return (
    <LegalEntrySheet
      visible={entry.visible}
      copy={entry.copy}
      onReview={entry.onReview}
      onDismiss={entry.onDismiss}
    />
  );
}

/**
 * Gate de permisos obligatorios (ubicación y cámara, ver `required-permissions.ts`),
 * revalidado en cada apertura y en cada vuelta a foreground. Se monta acá arriba, por
 * fuera del `<Stack>`, porque bloquea la app entera y no una pantalla: da igual dónde
 * esté el usuario, autenticado o no.
 *
 * Única excepción: `/onboarding` (MOVO-249), que es exactamente la pantalla donde se
 * piden por primera vez — tapar el carrusel con este gate sería mostrar dos veces la
 * misma conversación, una encima de la otra.
 */
function RequiredPermissionsGateMount() {
  const pathname = usePathname();
  const gate = useRequiredPermissionsGate();
  const isOnboarding = pathname === '/onboarding';

  return (
    <RequiredPermissionsGate
      visible={gate.blocked && !isOnboarding}
      missing={gate.missing}
      statuses={gate.statuses}
      pendingKind={gate.pendingKind}
      onRequest={(kind) => {
        void gate.request(kind);
      }}
      onOpenSettings={gate.openSettings}
    />
  );
}

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const [interLoaded] = useInterFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  const [jetBrainsMonoLoaded] = useJetBrainsMonoFonts({
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
  });
  // Solo relevante en dev (ver getApiBaseUrl en src/lib/env.ts) pero se carga
  // siempre para no bifurcar el flujo de boot entre dev/prod.
  const [apiOverrideLoaded, setApiOverrideLoaded] = useState(false);
  const [queryClient] = useState(() => new QueryClient());
  const sessionStatus = useAuthStore((s) => s.status);
  const restoreSession = useAuthStore((s) => s.restoreSession);

  const fontsLoaded = interLoaded && jetBrainsMonoLoaded;
  // AC8: gatea el mismo splash que fuentes/api-override — restaura la sesión (lee
  // secure-store, intenta refresh silencioso si venció, AC7) antes de mostrar
  // cualquier pantalla, para no dejar ver un parpadeo de login en un usuario ya
  // autenticado. El *a dónde* navegar según el resultado no vive acá: lo resuelve el
  // guard de `app/(app)/_layout.tsx`, este layout solo decide cuándo dejar de tapar.
  const sessionChecked = sessionStatus !== 'checking';
  const appReady = fontsLoaded && apiOverrideLoaded && sessionChecked;

  useEffect(() => {
    loadApiOverride().finally(() => setApiOverrideLoaded(true));
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // MOVO-107: pide permiso de notificaciones y registra el push token al detectar
  // sesión autenticada (login o `restoreSession()` de arriba). No participa de
  // `appReady`/el splash — corre en paralelo, nunca es un muro (AC1).
  usePushNotifications();

  // MOVO-195: genera (u obtiene) el par de claves del handshake y registra la pública
  // al detectar sesión autenticada — mismo criterio que `usePushNotifications`, no
  // participa de `appReady`. El `status`/`retry()` que devuelve son para que una
  // pantalla futura de handshake (MOVO-159/160) pueda gatear su entrada; este layout
  // no los consume todavía.
  useDeviceKeyBootstrap();

  useEffect(() => {
    if (appReady) {
      SplashScreen.hideAsync();
    }
  }, [appReady]);

  const onLayout = useCallback(() => {
    if (appReady) {
      SplashScreen.hideAsync();
    }
  }, [appReady]);

  if (!appReady) {
    return null;
  }

  return (
    // Requerido por react-native-gesture-handler v2 (pinch-to-zoom del visor de fotos,
    // MOVO-127) — tiene que envolver todo el árbol de navegación, no solo la pantalla
    // que lo usa, o los gestos nativos no se registran (sobre todo en Android).
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <RegistrationProvider>
          <LegalAcceptanceEntryMount />
          <RequiredPermissionsGateMount />
          <View onLayout={onLayout} className="flex-1 bg-bg">
            <Stack screenOptions={{ headerShown: false }} />
            <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
          </View>
        </RegistrationProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
