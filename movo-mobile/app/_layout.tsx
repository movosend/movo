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
import { Stack } from 'expo-router';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AnimatedSplash } from '../components/splash/animated-splash';
import { LegalEntrySheet } from '../components/legal/legal-entry-sheet';
import { useDeviceKeyBootstrap } from '../src/hooks/use-device-key-bootstrap';
import { useLegalAcceptanceEntry } from '../src/hooks/use-legal-acceptance-entry';
import { usePushNotifications } from '../src/hooks/use-push-notifications';
import { RegistrationProvider } from '../src/hooks/use-registration';
import { loadApiOverride } from '../src/lib/api-override';
import { useAuthStore } from '../src/store/auth-store';
import { useBootStore } from '../src/store/boot-store';
import { useCarrierTrackingCoordinator } from '../src/hooks/use-carrier-tracking';

SplashScreen.preventAutoHideAsync();

/**
 * MOVO-203: Coordinador central de tracking del transportista — vive dentro de
 * `QueryClientProvider` para ejecutar un único ciclo de sincronización de envíos en tránsito
 * y permisos con el singleton `locationService` a nivel de toda la sesión de la app.
 */
function CarrierTrackingCoordinatorMount() {
  useCarrierTrackingCoordinator();
  return null;
}

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
  const initialRouteResolved = useBootStore((s) => s.initialRouteResolved);
  // MOVO-247: el splash animado (JS, no el nativo estático) se queda mostrado
  // hasta que termina su propia animación de salida (`AnimatedSplash#onFinished`),
  // no apenas `bootReady` pasa a `true` -- por eso es un state aparte y no
  // simplemente `!bootReady`.
  const [showAnimatedSplash, setShowAnimatedSplash] = useState(true);

  const fontsLoaded = interLoaded && jetBrainsMonoLoaded;
  // AC8: restaura la sesión (lee secure-store, intenta refresh silencioso si
  // venció, AC7) antes de mostrar cualquier pantalla real, para no dejar ver un
  // parpadeo de login en un usuario ya autenticado. El *a dónde* navegar según el
  // resultado no vive acá: lo resuelve `app/index.tsx` (welcome/home/kyc) y el
  // guard de `app/(app)/_layout.tsx` — este layout solo decide cuándo dejar de
  // tapar la app con el splash.
  const sessionChecked = sessionStatus !== 'checking';
  // MOVO-247: la señal que antes se llamaba `appReady` ahora sirve para dos
  // cosas distintas — `fontsLoaded` solo (abajo) decide cuándo el ÁRBOL REAL se
  // monta (para que `app/index.tsx` pueda arrancar su propia resolución de boot
  // detrás del splash) y `bootReady` decide cuándo el splash puede empezar su
  // salida (fuentes + api override + sesión + a dónde navegar, todo resuelto).
  const bootReady = fontsLoaded && apiOverrideLoaded && sessionChecked && initialRouteResolved;

  useEffect(() => {
    loadApiOverride().finally(() => setApiOverrideLoaded(true));
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // MOVO-107: pide permiso de notificaciones y registra el push token al detectar
  // sesión autenticada (login o `restoreSession()` de arriba). No participa de
  // `bootReady`/el splash — corre en paralelo, nunca es un muro (AC1).
  usePushNotifications();

  // MOVO-195: genera (u obtiene) el par de claves del handshake y registra la pública
  // al detectar sesión autenticada — mismo criterio que `usePushNotifications`, no
  // participa de `bootReady`. El `status`/`retry()` que devuelve son para que una
  // pantalla futura de handshake (MOVO-159/160) pueda gatear su entrada; este layout
  // no los consume todavía.
  useDeviceKeyBootstrap();

  // El splash NATIVO (imagen estática, sin animación) solo tiene que tapar el
  // hueco entre el arranque del proceso y el primer frame en el que ya tenemos
  // fuentes cargadas para poder dibujar el propio `AnimatedSplash` (que sí
  // necesita Inter para el wordmark) -- de ahí en más el splash animado, ya
  // montado, es quien tapa el resto del boot real (sesión, registro pendiente).
  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  const onLayout = useCallback(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    // Requerido por react-native-gesture-handler v2 (pinch-to-zoom del visor de fotos,
    // MOVO-127) — tiene que envolver todo el árbol de navegación, no solo la pantalla
    // que lo usa, o los gestos nativos no se registran (sobre todo en Android).
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <RegistrationProvider>
          <CarrierTrackingCoordinatorMount />
          {/* MOVO-247: recién cuando el splash animado ya terminó -- `LegalEntrySheet`
           * se presenta con el `Modal` nativo de RN (capa por fuera del árbol de
           * views normal), así que si se montara antes podría aparecer POR ENCIMA
           * del splash a mitad de su animación en vez de detrás. */}
          {!showAnimatedSplash ? <LegalAcceptanceEntryMount /> : null}
          <View onLayout={onLayout} className="flex-1 bg-bg">
            <Stack screenOptions={{ headerShown: false }} />
            <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
          </View>
          {showAnimatedSplash ? (
            <AnimatedSplash
              testID="animated-splash"
              colorScheme={colorScheme === 'dark' ? 'dark' : 'light'}
              ready={bootReady}
              onFinished={() => setShowAnimatedSplash(false)}
            />
          ) : null}
        </RegistrationProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
