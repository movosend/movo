import { KycStatus } from "@movo/shared/dist/types/user";
import { Link, router } from "expo-router";
import { ArrowRight } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DotPattern } from "../components/ui/dot-pattern";
import { useRegistration } from "../src/hooks/use-registration";
import { useThemeColors } from "../src/hooks/use-theme-colors";
import { useAuthStore } from "../src/store/auth-store";

export default function WelcomeScreen() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = useThemeColors();
  const registration = useRegistration();
  const { resumeChecked, hasPendingRegistration, kycStatus } = registration;

  // MOVO-76 AC7: `restoreSession()` (app/_layout.tsx) deja el *estado* en
  // "authenticated" correctamente, pero por sí solo nunca navega a nadie — sin este
  // efecto, un usuario que reabre la app con una sesión válida se quedaba viendo esta
  // misma pantalla de bienvenida como si nunca se hubiera registrado. Mismo criterio de
  // ramificación por kycStatus que ya usa `login.tsx#handleLogin`: aprobado → directo a
  // `/home`; cualquier otro estado → hidrata el contexto de registro (para que `/kyc`
  // pueda leer `kycStatus` y ofrecer reintentar/revisar) y manda ahí, nunca a `/home`
  // con un aviso — eso es lo que muestra ese mismo estado dentro de `(app)/home.tsx`
  // para el caso de un usuario que llega aprobado y luego su KYC vence, no el de recién
  // entrar. `authRedirectedRef` evita relanzar el efecto ante cada re-render mientras la
  // navegación está en curso (`hydrateFromLogin` es async).
  const authStatus = useAuthStore((s) => s.status);
  const authUser = useAuthStore((s) => s.user);
  const authAccessToken = useAuthStore((s) => s.accessToken);
  const authRefreshToken = useAuthStore((s) => s.refreshToken);
  const isAuthenticatedSession = authStatus === "authenticated" && authUser !== null;
  const authRedirectedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticatedSession || !authUser || authRedirectedRef.current) return;
    authRedirectedRef.current = true;

    if (authUser.kycStatus === KycStatus.APPROVED) {
      router.replace("/home");
      return;
    }

    void (async () => {
      await registration.hydrateFromLogin({
        userId: authUser.userId,
        accessToken: authAccessToken ?? "",
        refreshToken: authRefreshToken ?? "",
        kycStatus: authUser.kycStatus,
      });
      router.replace("/kyc");
    })();
  }, [isAuthenticatedSession, authUser, authAccessToken, authRefreshToken, registration]);

  // AC7 (MOVO-73): si ya hay una cuenta creada que **nunca llegó a intentar** el KYC
  // (`RegistrationProvider` vive en `app/_layout.tsx`, por fuera de esta pantalla, así
  // que el estado sobrevive a volver acá), "Soy nuevo" no puede mandar al usuario a
  // rehacer el wizard de registro desde cero — salta directo a `/kyc`.
  //
  // Ojo: el auto-redirect se limita a `NOT_STARTED` a propósito, no a
  // `hasPendingRegistration` en general (como en una primera versión de este fix). Con
  // cualquier otro estado (`PENDING`, `MANUAL_REVIEW`, etc. — el usuario ya interactuó
  // con el KYC, aunque no haya terminado) redirigir siempre convierte al botón "Ir al
  // inicio" de `kyc.tsx` en un loop sin salida: vuelve acá, esto lo manda de nuevo para
  // allá. Con `NOT_STARTED` no hay ese riesgo porque `kyc.tsx` en ese estado no muestra
  // ninguna pantalla de resultado (`kycStatusToResultKind` devuelve `null`) — solo la
  // intro, así que no hay ningún botón "Ir al inicio" al que este redirect le compita.
  const shouldAutoRedirect = hasPendingRegistration && kycStatus === KycStatus.NOT_STARTED;

  useEffect(() => {
    if (resumeChecked && shouldAutoRedirect) {
      router.replace("/kyc");
    }
  }, [resumeChecked, shouldAutoRedirect]);

  if (!resumeChecked || shouldAutoRedirect || isAuthenticatedSession) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator size="large" color={colors.fg1} />
      </SafeAreaView>
    );
  }
  const logoSource = isDark
    ? require("../assets/movo_logo_full_dark.png")
    : require("../assets/movo_logo_full.png");
  // Los dos PNG no comparten exactamente el mismo aspect ratio (7369x2693 el
  // claro, 7375x2583 el oscuro) — se calcula por variante para que ninguno
  // se vea estirado.
  //
  // Ancho en píxeles calculado a mano (no `style.aspectRatio`): con solo la
  // altura fijada por className y el ancho dejado a `aspectRatio`, `Image`
  // no resolvía el ancho en el dev client y caía a su tamaño intrínseco
  // (7369x2693) — se veía como una mancha blanca gigante ocupando casi toda
  // la pantalla. Fijar `width`/`height` numéricos evita depender de que
  // Yoga resuelva `aspectRatio` en `Image` para este build (ver kyc.tsx).
  const LOGO_HEIGHT = 44;
  const logoAspectRatio = isDark ? 7375 / 2583 : 7369 / 2693;
  const logoWidth = LOGO_HEIGHT * logoAspectRatio;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <DotPattern />
      <View className="flex-1 justify-center px-6 pt-8">
        <Image
          source={logoSource}
          className="mb-5"
          style={{ height: LOGO_HEIGHT, width: logoWidth }}
          resizeMode="contain"
          accessibilityLabel="Movo"
        />
        <Text className="mb-4 font-sans-semibold text-[28px] leading-[34px] tracking-[-0.3px] text-fg">
          La red logística pensada{" "}
          <Text className="font-sans-semibold text-[28px] leading-[34px] tracking-[-0.3px] text-fg-2">
            para personas
          </Text>
          .
        </Text>
        <Text className="max-w-[290px] font-sans text-body text-fg-2">
          Movo conecta tu paquete con personas que hacen ese camino todos los
          días. Sin sucursales, sin esperas.
        </Text>
      </View>

      <View className="gap-2.5 px-6 pb-6">
        {hasPendingRegistration ? (
          // Ya hay una cuenta creada con el KYC en algún estado post-`NOT_STARTED`
          // (`PENDING`/`MANUAL_REVIEW`/etc. — el usuario ya interactuó con Didit,
          // aunque no haya terminado, o volvió acá a propósito desde "Ir al inicio" de
          // `kyc.tsx`). No la escondemos detrás de "Soy nuevo" (que rearmaría el
          // wizard de registro entero) ni la auto-redirigimos (ver comentario de
          // `shouldAutoRedirect` arriba) — se ofrece como acción explícita.
          <Link href="/kyc" asChild>
            <Pressable
              className="w-full flex-row items-center justify-center gap-2 rounded-lg bg-lime-500 py-4"
              testID="welcome-continue-kyc"
            >
              <Text className="font-sans-semibold text-body text-ink-950">
                Continuar verificación
              </Text>
              <ArrowRight size={16} color="#0A0A0B" strokeWidth={2} />
            </Pressable>
          </Link>
        ) : (
          <Link href="/register" asChild>
            <Pressable
              className="w-full flex-row items-center justify-center gap-2 rounded-lg bg-lime-500 py-4"
              testID="welcome-go-register"
            >
              <Text className="font-sans-semibold text-body text-ink-950">
                Soy nuevo
              </Text>
              <ArrowRight size={16} color="#0A0A0B" strokeWidth={2} />
            </Pressable>
          </Link>
        )}
        <Link href="/login" asChild>
          <Pressable
            className="w-full items-center justify-center rounded-lg border border-border-strong py-4"
            testID="welcome-go-login"
          >
            <Text className="font-sans-semibold text-body text-fg">
              Ya tengo cuenta
            </Text>
          </Pressable>
        </Link>
      </View>
    </SafeAreaView>
  );
}
