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
import { AnimatedSplash } from '../components/splash/animated-splash';
import { LegalEntrySheet } from '../components/legal/legal-entry-sheet';
import { RequiredPermissionsGate } from '../components/permissions/required-permissions-gate';
import { useDeviceKeyBootstrap } from '../src/hooks/use-device-key-bootstrap';
import { useLegalAcceptanceEntry } from '../src/hooks/use-legal-acceptance-entry';
import { useRequiredPermissionsGate } from '../src/hooks/use-required-permissions-gate';
import { usePushNotifications } from '../src/hooks/use-push-notifications';
import { RegistrationProvider } from '../src/hooks/use-registration';
import { loadApiOverride } from '../src/lib/api-override';
import { useAuthStore } from '../src/store/auth-store';
import { useBootStore } from '../src/store/boot-store';
import { useCarrierTrackingCoordinator, useIsCarrierTracking } from '../src/hooks/use-carrier-tracking';
import { CarrierLocationGate } from '../components/location/carrier-location-gate';
import { useCarrierLocationReadiness } from '../src/hooks/use-carrier-location-readiness';
import {
  firstMissingRequirement,
  getCarrierLocationReadiness,
} from '../src/lib/carrier-location-readiness';
import { locationService } from '../src/location/location-service';
import { useCarrierLocationGateStore } from '../src/store/carrier-location-gate-store';
import '../src/location/tracking-task';

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
 * Pantallas bloqueantes de arranque, montadas acá arriba (por fuera del `<Stack>`)
 * porque tapan la app entera y no una pantalla. Las tres se presentan con un `Modal`
 * nativo, y dos `Modal` a la vez no conviven en iOS (el segundo no se presenta o se
 * apila mal, y no se puede operar ninguno) — por eso este mount decide cuál se ve, una
 * sola por vez, en este orden de prioridad:
 *
 * 1. **Permisos obligatorios** (ubicación de primer plano y cámara,
 *    `required-permissions.ts`): sin ellos la app no sirve para nada.
 * 2. **Ubicación del transportista** (`carrier-location-readiness.ts`): pedida por una
 *    acción (ofertar, declarar/iniciar un viaje, retirar) vía `requireCarrierLocation()`
 *    — se cierra con "Ahora no" — o sin salida con un viaje en curso, el caso de quien
 *    quitó "Siempre" desde Ajustes a mitad del viaje.
 * 3. **Aceptación de documentos legales** (MOVO-229): se puede posponer, así que cede
 *    ante cualquiera de las otras dos.
 *
 * Vive DENTRO de `QueryClientProvider` porque MOVO-229 usa `useMyProfile()`, y se monta
 * recién cuando terminó el splash animado (MOVO-247) para que ningún `Modal` aparezca por
 * encima del splash a mitad de su animación.
 *
 * Los permisos obligatorios no se muestran en `/onboarding` (MOVO-249), que es la
 * pantalla donde se piden por primera vez, ni en `/`, que en un dispositivo nuevo es solo
 * el spinner que decide si redirigir al carrusel: sin esa excepción todo usuario nuevo
 * veía el bloqueo antes del carrusel que justamente presenta esos permisos.
 */
function BlockingGatesMount() {
  const pathname = usePathname();
  const permissions = useRequiredPermissionsGate();
  const legal = useLegalAcceptanceEntry();
  const readiness = useCarrierLocationReadiness();
  const isTracking = useIsCarrierTracking();
  const isAuthenticated = useAuthStore((s) => s.status === 'authenticated');
  const requested = useCarrierLocationGateStore((s) => s.requested);

  const permissionsVisible =
    permissions.blocked && pathname !== '/onboarding' && pathname !== '/';

  // La ubicación de primer plano la pide el gate de permisos obligatorios: esta
  // pantalla arranca recién desde el escalón siguiente.
  const carrierBlocking = isAuthenticated && isTracking;
  const foregroundGranted = readiness.readiness?.foregroundGranted ?? false;
  const carrierVisible =
    !permissionsVisible &&
    readiness.checked &&
    !readiness.ready &&
    foregroundGranted &&
    (requested || carrierBlocking);

  const legalVisible = legal.visible && !permissionsVisible && !carrierVisible;

  const runPendingAction = useCallback(() => {
    const action = useCarrierLocationGateStore.getState().take();
    if (action) void action();
  }, []);

  // Al pedirse, se relee en el momento: el estado del hook puede ser de antes de que
  // el usuario cambiara algo en Ajustes, y no puede dejar pasar una acción con un
  // "listo" viejo.
  useEffect(() => {
    if (!requested) return;
    let cancelled = false;
    void (async () => {
      const fresh = await getCarrierLocationReadiness();
      if (cancelled) return;
      if (firstMissingRequirement(fresh) === null) runPendingAction();
      else void readiness.recheck();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  useEffect(() => {
    if (!readiness.ready) return;
    void locationService.refreshPermissions();
    if (useCarrierLocationGateStore.getState().requested) runPendingAction();
  }, [readiness.ready, runPendingAction]);

  return (
    <>
      <RequiredPermissionsGate
        visible={permissionsVisible}
        missing={permissions.missing}
        statuses={permissions.statuses}
        pendingKind={permissions.pendingKind}
        onRequest={(kind) => {
          void permissions.request(kind);
        }}
        onOpenSettings={permissions.openSettings}
      />
      <CarrierLocationGate
        visible={carrierVisible}
        readiness={readiness.readiness}
        missing={readiness.missing}
        needsSettings={readiness.needsSettings}
        pending={readiness.pending}
        onResolve={() => {
          void readiness.resolve();
        }}
        onDismiss={
          carrierBlocking ? undefined : () => useCarrierLocationGateStore.getState().cancel()
        }
      />
      <LegalEntrySheet
        visible={legalVisible}
        copy={legal.copy}
        onReview={legal.onReview}
        onDismiss={legal.onDismiss}
      />
    </>
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
          {!showAnimatedSplash ? <BlockingGatesMount /> : null}
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
