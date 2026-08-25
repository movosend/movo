import { KycStatus } from "@movo/shared/dist/types/user";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import type {
  VerificationErrorType,
  VerificationResult,
} from "@didit-protocol/sdk-react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  CameraOff,
  ShieldAlert,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../components/auth/primary-button";
import { ErrorBanner } from "../../components/ui/error-banner";
import { authClient } from "../../src/api/auth-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../src/lib/error-messages";
import {
  KYC_TONE_BG_CLASS,
  KYC_TONE_ICON_HEX,
  kycStatusIcon,
} from "../../src/lib/kyc-status-ui";

/**
 * Verificación de licencia de conducir (MOVO-15) — mismo mecanismo de KYC que
 * `app/(auth)/kyc.tsx` (identidad, MOVO-72/73), reusando el mismo SDK nativo de Didit
 * y el mismo vocabulario de estados/íconos (`src/lib/kyc-status-ui.ts`). A propósito
 * **desacoplada** de `useRegistration()`: esta pantalla se llega desde el banner de
 * licencia en Perfil (MOVO-15), con el transportista ya logueado de verdad — el
 * estado del flujo (fase/resultado/error) es local a este componente, y las llamadas a
 * `authClient.createLicenseKycSession`/`getLicenseKycStatus` no llevan `accessToken`
 * explícito (a diferencia de las de identidad): el interceptor de `http-client.ts` lo
 * adjunta solo desde la sesión real, con refresh automático incluido (MOVO-76). Ver el
 * comentario del módulo en `kyc.tsx` para el detalle del `require()` diferido del SDK.
 */

type ResultKind =
  | "approved"
  | "declined"
  | "manual_review"
  | "in_progress"
  | VerificationErrorType;

const RESULT_COPY: Record<ResultKind, { title: string; body: string }> = {
  approved: {
    title: "¡Licencia verificada!",
    body: "Ya aparecés como transportista verificado en tu perfil.",
  },
  declined: {
    title: "No pudimos verificar tu licencia",
    body: "Los datos no coincidieron con tu carnet. Podés intentarlo de nuevo o hablar con soporte.",
  },
  manual_review: {
    title: "Tu verificación está en revisión",
    body: "A veces necesitamos un poco más de tiempo para confirmar tu licencia. Te avisamos por notificación en cuanto esté lista.",
  },
  in_progress: {
    title: "Tu verificación quedó a medias",
    body: "Iniciamos tu sesión con Didit pero nunca llegó un resultado — puede ser que la hayas dejado por la mitad, por ejemplo por un corte de conexión. Podés empezarla de nuevo cuando quieras.",
  },
  sessionExpired: {
    title: "La sesión de verificación venció",
    body: "Pasó demasiado tiempo y Didit cerró la sesión por seguridad. Podés empezar de nuevo cuando quieras.",
  },
  networkError: {
    title: "Se cortó la conexión",
    body: "No pudimos completar la verificación por un problema de red. Revisá tu conexión e intentá de nuevo.",
  },
  cameraAccessDenied: {
    title: "Necesitamos acceso a tu cámara",
    body: "Didit necesita la cámara para la foto de tu licencia y una selfie. Activá el permiso en Ajustes y volvé a intentar.",
  },
  notInitialized: {
    title: "Verificación interrumpida",
    body: "Hubo un problema iniciando la verificación. Intentá de nuevo.",
  },
  apiError: {
    title: "Verificación interrumpida",
    body: "Hubo un problema con el servicio de verificación. Intentá de nuevo en unos minutos.",
  },
  retryBlocked: {
    title: "Alcanzaste el límite de intentos",
    body: "Por seguridad, contactá a soporte para continuar con la verificación.",
  },
  unknown: {
    title: "Verificación interrumpida",
    body: "Algo salió mal. Podés retomarla cuando quieras.",
  },
};

// Mismo criterio que kyc.tsx#RESULT_BADGE: los 5 casos 1:1 con un KycStatus delegan a
// src/lib/kyc-status-ui.ts para quedar consistentes con el resto de la app; los
// VerificationErrorType del SDK de Didit siguen con su propio ícono acá.
const RESULT_BADGE: Record<
  ResultKind,
  { Icon: LucideIcon; tone: "success" | "danger" | "warning" | "neutral" }
> = {
  approved: { Icon: kycStatusIcon(KycStatus.APPROVED), tone: "success" },
  declined: { Icon: kycStatusIcon(KycStatus.REJECTED), tone: "danger" },
  manual_review: { Icon: kycStatusIcon(KycStatus.MANUAL_REVIEW), tone: "warning" },
  in_progress: { Icon: kycStatusIcon(KycStatus.PENDING), tone: "warning" },
  sessionExpired: { Icon: kycStatusIcon(KycStatus.EXPIRED), tone: "warning" },
  networkError: { Icon: WifiOff, tone: "neutral" },
  cameraAccessDenied: { Icon: CameraOff, tone: "neutral" },
  notInitialized: { Icon: TriangleAlert, tone: "neutral" },
  apiError: { Icon: TriangleAlert, tone: "neutral" },
  retryBlocked: { Icon: ShieldAlert, tone: "danger" },
  unknown: { Icon: TriangleAlert, tone: "neutral" },
};

const BADGE_TONE_CLASS = KYC_TONE_BG_CLASS;
const BADGE_ICON_COLOR = KYC_TONE_ICON_HEX;

const RETRYABLE: ResultKind[] = [
  "declined",
  "in_progress",
  "sessionExpired",
  "networkError",
  "cameraAccessDenied",
  "notInitialized",
  "apiError",
  "unknown",
];

function kycStatusToResultKind(status: KycStatus): ResultKind | null {
  switch (status) {
    case KycStatus.APPROVED:
      return "approved";
    case KycStatus.REJECTED:
      return "declined";
    case KycStatus.MANUAL_REVIEW:
      return "manual_review";
    case KycStatus.PENDING:
      return "in_progress";
    case KycStatus.EXPIRED:
      return "sessionExpired";
    default:
      return null;
  }
}

/**
 * `KYC_SESSION_NOT_ALLOWED` mapea en `error-messages.ts#CODE_MESSAGES` a "Tu identidad
 * ya está verificada." — correcto para el flujo de identidad, incorrecto acá (es la
 * licencia). Se resuelve el mensaje a mano para ese código en vez de usar
 * `friendlyErrorMessage` a secas.
 */
function licenseErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.code === "KYC_SESSION_NOT_ALLOWED") {
    return "Tu licencia ya está verificada.";
  }
  return friendlyErrorMessage(err, fallback);
}

export default function LicenseKycScreen() {
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const params = useLocalSearchParams<{ status?: string }>();
  const initialLicenseStatus = (params.status as KycStatus) || null;
  const initialKind = initialLicenseStatus ? kycStatusToResultKind(initialLicenseStatus) : null;

  const [phase, setPhase] = useState<"intro" | "connecting" | "result">(
    () => (initialKind ? "result" : "intro"),
  );
  const [resultKind, setResultKind] = useState<ResultKind | null>(
    () => initialKind,
  );
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  // Mismo criterio que kyc.tsx: una sola revalidación al entrar, no polling continuo.
  const autoRefreshedRef = useRef(false);

  /** Consulta `GET /kyc/license/status` y refleja el resultado si hay uno terminal —
   * silencioso ante error a propósito (mismo criterio que kyc.tsx#refreshKycStatus):
   * no es una acción disparada explícitamente por el usuario en el efecto de entrada,
   * y en el botón "actualizar estado" un fallo no debe tapar el resultado ya mostrado. */
  async function refreshLicenseKycStatus(): Promise<ResultKind | null> {
    try {
      const { status } = await authClient.getLicenseKycStatus();
      const resumed = kycStatusToResultKind(status);
      if (resumed) {
        setResultKind(resumed);
        setPhase("result");
      }
      return resumed;
    } catch {
      return null;
    }
  }

  // Reanudable: si ya existe un resultado (sesión previa, o retomando después de
  // cerrar la app), saltamos directo al resultado en vez de mostrar la intro de nuevo.
  // Igual que kyc.tsx: `in_progress`/`manual_review` disparan una única revalidación
  // extra al entrar, por si el resultado real ya se resolvió del lado del backend.
  useEffect(() => {
    void (async () => {
      const resumed = await refreshLicenseKycStatus();
      if (!autoRefreshedRef.current && (resumed === "in_progress" || resumed === "manual_review")) {
        autoRefreshedRef.current = true;
        void refreshLicenseKycStatus();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function beginVerification() {
    setLoading(true);
    setErrorBanner(null);
    let sessionToken: string;
    try {
      const session = await authClient.createLicenseKycSession();
      sessionToken = session.sessionToken;
    } catch (err) {
      setErrorBanner(licenseErrorMessage(err, "No pudimos iniciar la verificación. Intentá de nuevo."));
      setLoading(false);
      return;
    }
    setLoading(false);
    setPhase("connecting");

    let result: VerificationResult;
    try {
      // Ver comentario del módulo (y el de kyc.tsx): import diferido a propósito, el
      // SDK nativo no está registrado en Expo Go.
      const sdk =
        require("@didit-protocol/sdk-react-native") as typeof import("@didit-protocol/sdk-react-native");
      result = await sdk.startVerification(sessionToken, { languageCode: "es" });
    } catch {
      setResultKind("notInitialized");
      setPhase("result");
      return;
    }

    if (result.type === "completed") {
      switch (result.session.status) {
        case "Approved":
          setResultKind("approved");
          break;
        case "Declined":
          setResultKind("declined");
          break;
        case "Pending":
          setResultKind("manual_review");
          break;
        default:
          setResultKind("unknown");
          break;
      }
      setPhase("result");
      void refreshLicenseKycStatus();
    } else if (result.type === "cancelled") {
      setPhase("intro");
    } else {
      setResultKind(result.error.type);
      setPhase("result");
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshLicenseKycStatus();
    } finally {
      setRefreshing(false);
    }
  }

  // Siempre autenticado de verdad (el guard de app/(app)/_layout.tsx lo garantiza) —
  // a diferencia de kyc.tsx, no hay caso "sin sesión real" que contemplar acá.
  function goHome() {
    router.replace("/home");
  }

  if (phase === "connecting") {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-bg px-8">
        <ActivityIndicator size="large" color={colors.fg1} />
        <Text className="mb-2 mt-6 text-center font-sans-semibold text-h3 text-fg">
          Conectando con Didit…
        </Text>
        <Text className="text-center font-sans text-[13px] text-fg-2">
          Te vamos a llevar a la ventana segura de verificación de nuestro socio.
        </Text>
      </SafeAreaView>
    );
  }

  if (phase === "result") {
    const kind = resultKind ?? "unknown";
    const copy = RESULT_COPY[kind];
    const badge = RESULT_BADGE[kind];
    const BadgeIcon = badge.Icon;
    const canRetry = RETRYABLE.includes(kind);
    const canRefresh = kind === "in_progress" || kind === "manual_review";
    return (
      <SafeAreaView className="flex-1 bg-bg px-8 pt-16">
        <View className="flex-1 items-center">
          <View
            testID="license-kyc-result-badge"
            className={`mb-5 h-14 w-14 items-center justify-center rounded-[14px] ${BADGE_TONE_CLASS[badge.tone]}`}
          >
            <BadgeIcon
              size={26}
              strokeWidth={2.25}
              color={badge.tone === "neutral" ? colors.fg2 : BADGE_ICON_COLOR[badge.tone]}
            />
          </View>
          <Text testID="license-kyc-result-title" className="mb-2 text-center font-sans-semibold text-h2 text-fg">
            {copy.title}
          </Text>
          <Text className="text-center font-sans text-body text-fg-2">{copy.body}</Text>
        </View>
        <PrimaryButton
          testID="license-kyc-primary-action"
          label={canRetry ? "Reintentar verificación" : "Ir al inicio"}
          onPress={canRetry ? beginVerification : goHome}
          loading={loading || refreshing}
        />
        {canRefresh ? (
          <Text
            testID="license-kyc-refresh-status"
            onPress={handleRefresh}
            className="mb-3 text-center font-sans text-[13px] text-fg-3"
          >
            {kind === "manual_review" ? "Actualizar estado" : "Ya la completé — actualizar estado"}
          </Text>
        ) : null}
        {canRetry ? (
          <Text onPress={goHome} className="mb-2 text-center font-sans text-[13px] text-fg-3">
            Ir al inicio
          </Text>
        ) : null}
      </SafeAreaView>
    );
  }

  const MOVO_LOGO_HEIGHT = 36;
  const DIDIT_LOGO_HEIGHT = 32;
  const movoLogoSource = isDark
    ? require("../../assets/movo_logo_full_dark.png")
    : require("../../assets/movo_logo_full.png");
  const movoLogoAspectRatio = isDark ? 7375 / 2583 : 7369 / 2693;
  const movoLogoWidth = MOVO_LOGO_HEIGHT * movoLogoAspectRatio;
  const diditLogoSource = isDark
    ? require("../../assets/didit_logo_full_dark.png")
    : require("../../assets/didit_logo_full.png");
  const diditLogoAspectRatio = 1964 / 680;
  const diditLogoWidth = DIDIT_LOGO_HEIGHT * diditLogoAspectRatio;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-1 px-6 pt-14">
        <View className="mb-8 flex-row items-center gap-3">
          <Image
            source={movoLogoSource}
            style={{ height: MOVO_LOGO_HEIGHT, width: movoLogoWidth }}
            resizeMode="contain"
            accessibilityLabel="Movo"
          />
          <Text className="font-sans-semibold text-[16px] text-fg-3">+</Text>
          <Image
            source={diditLogoSource}
            style={{ height: DIDIT_LOGO_HEIGHT, width: diditLogoWidth }}
            resizeMode="contain"
            accessibilityLabel="Didit"
          />
        </View>

        <ErrorBanner testID="license-kyc-error-banner" message={errorBanner} />

        <Text className="mb-3 font-sans-semibold text-[11px] uppercase tracking-[0.6px] text-fg-3">
          Verificación de licencia
        </Text>
        <Text className="mb-3 font-sans-semibold text-title text-fg">
          Confirmemos tu licencia de conducir
        </Text>
        <Text className="mb-6 font-sans text-body text-fg-2">
          Para que puedas aparecer como transportista verificado, necesitamos verificar
          tu licencia de conducir. Lo hacemos junto con{" "}
          <Text className="font-sans-semibold text-fg">Didit</Text>, nuestro socio de
          verificación. No te va a tomar más de 2 minutos.
        </Text>

        <View className="gap-4">
          <IntroStep number={1} text="Te pedimos unas fotos de tu licencia de conducir" />
          <IntroStep
            number={2}
            text="Capturamos una selfie de tu rostro para asegurarnos de que efectivamente sos vos"
          />
          <IntroStep number={3} text="Validamos tu licencia con un sistema seguro y privado" />
        </View>

        <Text className="mt-6 font-sans text-[12px] text-fg-3">
          Tus datos están protegidos y solo se usan para verificar tu licencia. Movo no
          almacena imágenes de tu carnet ni tu rostro.
        </Text>
      </View>

      <PrimaryButton
        testID="license-kyc-begin-verification"
        label={loading ? "Iniciando…" : "Empezar verificación con Didit"}
        onPress={beginVerification}
        loading={loading}
        disabled={loading}
      />
    </SafeAreaView>
  );
}

function IntroStep({ number, text }: { number: number; text: string }) {
  return (
    <View className="flex-row items-center gap-3.5">
      <View className="h-8 w-8 items-center justify-center rounded-full bg-lime-500">
        <Text className="font-sans-semibold text-[13px] text-ink-950">{number}</Text>
      </View>
      <Text className="flex-1 font-sans text-[13px] leading-5 text-fg">{text}</Text>
    </View>
  );
}
