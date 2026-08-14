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
import { usePushNotifications } from '../src/hooks/use-push-notifications';
import { RegistrationProvider } from '../src/hooks/use-registration';
import { loadApiOverride } from '../src/lib/api-override';
import { useAuthStore } from '../src/store/auth-store';

SplashScreen.preventAutoHideAsync();

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
    <QueryClientProvider client={queryClient}>
      <RegistrationProvider>
        <View onLayout={onLayout} className="flex-1 bg-bg">
          <Stack screenOptions={{ headerShown: false }} />
          <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
        </View>
      </RegistrationProvider>
    </QueryClientProvider>
  );
}
