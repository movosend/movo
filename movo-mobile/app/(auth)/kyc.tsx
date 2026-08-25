import { KycStatus } from "@movo/shared/dist/types/user";
import type {
  VerificationErrorType,
  VerificationResult,
} from "@didit-protocol/sdk-react-native";
import { router } from "expo-router";
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
import { useRegistration } from "../../src/hooks/use-registration";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  KYC_TONE_BG_CLASS,
  KYC_TONE_ICON_HEX,
  kycStatusIcon,
} from "../../src/lib/kyc-status-ui";
import { useAuthStore } from "../../src/store/auth-store";

/**
 * Usa el SDK nativo de Didit (`startVerification`) en vez de un WebView: ya
 * está instalado y linkeado en el proyecto (ver package.json/app.json), y
 * cumple mejor el criterio "sin salir de la app" que el WebView que asume el
 * mockup de Claude Design — la UI de captura corre nativa, dentro de la app.
 *
 * El pedido de permiso de cámara lo maneja el SDK internamente: no hay
 * código propio de permisos acá. Si el usuario lo rechaza, `startVerification`
 * resuelve con `type: 'failed'` y `error.type === 'cameraAccessDenied'`, que
 * se mapea a la pantalla de error de más abajo.
 *
 * El paquete se importa con `require()` recién dentro de `beginVerification`,
 * nunca en el top del archivo: `NativeSdkReactNative.ts` (dependencia interna
 * del SDK) llama a `TurboModuleRegistry.getEnforcing(...)` en el scope del
 * módulo, que tira una `Invariant Violation` apenas se evalúa si el módulo
 * nativo no está registrado — como pasa siempre en Expo Go, que no soporta
 * módulos nativos custom. Como expo-router evalúa todas las rutas al
 * arrancar la app, un `import` estático acá tumbaba la app entera (todas
 * las pantallas, no solo esta) en cuanto se abría en Expo Go. Con `require`
 * diferido, el resto de la app funciona en Expo Go; solo este botón
 * requiere un development build (`npx expo prebuild` + build nativo).
 */

type ResultKind =
  | "approved"
  | "declined"
  | "manual_review"
  | "in_progress"
  | VerificationErrorType;

const RESULT_COPY: Record<ResultKind, { title: string; body: string }> = {
  approved: {
    title: "¡Verificación aprobada!",
    body: "Ya podés enviar y llevar paquetes con total confianza.",
  },
  declined: {
    title: "No pudimos verificar tu identidad",
    body: "Los datos no coincidieron con tu documento. Podés intentarlo de nuevo o hablar con soporte.",
  },
  manual_review: {
    title: "Tu verificación está en revisión",
    body: "A veces necesitamos un poco más de tiempo para confirmar tu identidad. Te avisamos por notificación en cuanto esté lista.",
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
    body: "Didit necesita la cámara para la foto del DNI y la selfie. Activá el permiso en Ajustes y volvé a intentar.",
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

/**
 * Ícono + paleta del badge de cada resultado. Antes esto era un glifo de texto
 * (`✓`/`✕`/`…`): el `…` aparecía tal cual en *todos* los estados que no eran
 * aprobado/rechazado (revisión, sesión vencida, sin conexión, etc.), que es
 * justo el caso más frecuente, y encima se renderizaba mal (el glifo no queda
 * centrado ópticamente en el cuadro y depende de la fuente del sistema).
 *
 * Los tonos `danger`/`warning` usan los rellenos claros de la escala semántica
 * en ambos temas, igual que `ErrorBanner` — esas escalas todavía no tienen paso
 * dark en `global.css` (ver nota de dark mode en CLAUDE.md). El tono `neutral`
 * sí es temático: `bg-mute` + `fg-2` vía `useThemeColors()`.
 */
// Los 5 casos que son 1:1 con un `KycStatus` (approved/declined/manual_review/
// in_progress/sessionExpired, ver `kycStatusToResultKind` abajo) delegan ícono/tono a
// `src/lib/kyc-status-ui.ts` (MOVO-78) para quedar consistentes con el banner de
// `home.tsx` y el badge de perfil. Los `VerificationErrorType` del SDK de Didit
// (networkError, cameraAccessDenied, etc.) son fallas del flujo de verificación, no
// estados de KYC — siguen con su propio ícono/tono acá, sin tocar.
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

// Hex y no className: `lucide-react-native` recibe el color por prop `color`,
// que NativeWind no intercepta (mismo motivo que `use-theme-colors.ts`).
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
    // PENDING = ya existe una sesión de Didit creada (kyc.service.ts#createSession la
    // pone acá apenas se pide, no cuando se resuelve) pero todavía sin decisión
    // terminal — nunca significa "en revisión humana" (eso es MANUAL_REVIEW). Es
    // reintentable: el backend descarta el intento anterior como `expired` y abre uno
    // nuevo (ver ALLOWED_SESSION_SOURCE_STATUSES en kyc.service.ts), justamente porque
    // el caso típico acá es que el SDK de Didit nunca llegó a correr (sin conexión, sin
    // development build) y entonces no hay ningún webhook en camino que vaya a
    // resolverlo solo.
    case KycStatus.PENDING:
      return "in_progress";
    case KycStatus.EXPIRED:
      return "sessionExpired";
    default:
      return null;
  }
}

export default function KycScreen() {
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const registration = useRegistration();
  const authStatus = useAuthStore((s) => s.status);
  const authUser = useAuthStore((s) => s.user);
  const {
    kycStatus: registrationKycStatus,
    loading,
    errorBanner,
    createKycSession,
    refreshKycStatus,
  } = registration;

  // Si se llega desde el wizard de registro, `registration.kycStatus` tiene prioridad.
  // Si se llega desde "Mi perfil" (usuario autenticado), `registration.kycStatus` es null
  // y se lee el estado actual desde `authStore`.
  const kycStatus = registrationKycStatus ?? authUser?.kycStatus ?? null;

  const [phase, setPhase] = useState<"intro" | "connecting" | "result">(
    () => (kycStatus && kycStatusToResultKind(kycStatus) ? "result" : "intro"),
  );
  const [resultKind, setResultKind] = useState<ResultKind | null>(
    () => (kycStatus ? kycStatusToResultKind(kycStatus) : null),
  );
  const [refreshing, setRefreshing] = useState(false);
  // Evita que el refresh automático de abajo se repita en cada cambio de `kycStatus`
  // durante el mismo montaje (el propio refresh cambia `kycStatus`, lo que retriggerea
  // este efecto) — solo nos interesa una revalidación al entrar a la pantalla, no un
  // polling continuo.
  const autoRefreshedRef = useRef(false);

  // Reanudable (AC7): si venimos de un registro en curso (o de un login a una cuenta
  // existente, MOVO-76) con un kycStatus ya distinto de "not_started", saltamos
  // directo al resultado en vez de mostrar la intro de nuevo.
  //
  // NOTA: el estado inicial de `phase`/`resultKind` ya se deriva de `kycStatus` en el
  // `useState` de arriba — este efecto cubre únicamente los cambios posteriores
  // (ej: `refreshKycStatus` devuelve un estado distinto al que había al montar). Sin
  // esta distinción, el efecto re-seteaba phase/resultKind al mismo valor en cada
  // render y no cumplía ningún rol útil para el caso de montaje inicial.
  //
  // Caso real que motivó el auto-refresh: un usuario quedó en `manual_review`, un
  // operador lo aprobó manualmente en la consola de Didit (webhook entregado, según la
  // propia consola), pero al volver a abrir la app seguía viendo "en revisión" — el
  // `kycStatus` que trae el contexto es el que se leyó al reanudar/loguearse, no se
  // revalida solo. `in_progress`/`manual_review` son justamente los dos estados que
  // pueden haberse resuelto del lado del backend mientras el usuario no miraba esta
  // pantalla (una sesión de Didit que sigue abierta, o una revisión manual que un
  // operador ya cerró) — se revalida contra `/kyc/status` una vez al entrar, en vez de
  // confiar ciegamente en ese valor.
  useEffect(() => {
    const resumed = kycStatus ? kycStatusToResultKind(kycStatus) : null;
    if (resumed) {
      setResultKind(resumed);
      setPhase("result");
      if (
        !autoRefreshedRef.current &&
        (resumed === "in_progress" || resumed === "manual_review")
      ) {
        autoRefreshedRef.current = true;
        void refreshKycStatus();
      }
    }
  }, [kycStatus, refreshKycStatus]);

  async function beginVerification() {
    const session = await createKycSession();
    if (!session.ok || !session.sessionToken) return;

    setPhase("connecting");

    let result: VerificationResult;
    try {
      // Ver comentario del módulo: import diferido a propósito.
      const sdk =
        require("@didit-protocol/sdk-react-native") as typeof import("@didit-protocol/sdk-react-native");
      result = await sdk.startVerification(session.sessionToken, {
        languageCode: "es",
      });
    } catch {
      // No hay development build (ej: corriendo en Expo Go) — el módulo
      // nativo no está registrado. No es un error de Didit en sí.
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
        // A nivel de tipos el switch ya es exhaustivo (VerificationStatus tiene esos 3
        // valores), pero el valor llega del módulo nativo, donde el bridge lo declara
        // `status?: string` — sin garantía real. Y la API de Didit maneja 10 estados
        // crudos (ver DiditRawStatus en svc-users/src/adapters/didit-client.ts): si el
        // nativo alguna vez emite uno de esos en vez del mapeado, sin este default la
        // pantalla se quedaba sin resultKind y no mostraba nada.
        default:
          setResultKind("unknown");
          break;
      }
      setPhase("result");
      void refreshKycStatus();
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
      await refreshKycStatus();
    } finally {
      setRefreshing(false);
    }
  }

  function handlePrimaryAction() {
    const isRetryable = resultKind ? RETRYABLE.includes(resultKind) : false;
    if (isRetryable) {
      void beginVerification();
      return;
    }
    // Solo un KYC aprobado pasa al paso de foto de perfil (cierre de onboarding)
    if (resultKind === "approved") {
      router.replace("/profile-photo" as never);
      return;
    }
    goHome();
  }

  function goHome() {
    // Esta pantalla se llega tanto desde el wizard de registro (sin sesión real
    // todavía, `useAuthStore` en 'unauthenticated'/'checking') como desde un login o una
    // sesión restaurada a una cuenta con KYC no aprobado (MOVO-76,
    // `login.tsx#handleLogin` / `app/index.tsx`). Solo en el segundo caso hay una sesión
    // autenticada real para mandar a `/home` — que ya muestra el aviso de AC11
    // (`app/(app)/(tabs)/home.tsx#KYC_BANNER_TEXT`) para cualquier estado no aprobado. Crítico
    // no mandar siempre a `/` acá: con el redirect de sesión restaurada de
    // `app/index.tsx` (AC7), un usuario autenticado que vuelve a `/` con KYC no
    // aprobado es enviado de nuevo a esta misma pantalla — "Ir al inicio" se convertía
    // en un loop. Sin sesión real, `/home` no es alcanzable (el guard de
    // `app/(app)/_layout.tsx` lo rebotaría a `/login`), así que ahí se mantiene `/`.
    router.replace(authStatus === "authenticated" ? "/home" : "/");
  }

  if (phase === "connecting") {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-bg px-8">
        <ActivityIndicator size="large" color={colors.fg1} />
        <Text className="mb-2 mt-6 text-center font-sans-semibold text-h3 text-fg">
          Conectando con Didit…
        </Text>
        <Text className="text-center font-sans text-[13px] text-fg-2">
          Te vamos a llevar a la ventana segura de verificación de nuestro
          socio.
        </Text>
      </SafeAreaView>
    );
  }

  if (phase === "result") {
    // Red de seguridad: `phase === 'result'` sin `resultKind` caía a la intro, que le
    // dice al usuario que arranque la verificación cuando en realidad ya la hizo y no
    // sabemos cómo terminó. 'unknown' al menos lo dice y ofrece reintentar. Cubre
    // cualquier camino futuro que setee la fase sin setear el resultado, no solo el
    // switch de `beginVerification`.
    const kind = resultKind ?? "unknown";
    const copy = RESULT_COPY[kind];
    const badge = RESULT_BADGE[kind];
    const BadgeIcon = badge.Icon;
    const canRetry = RETRYABLE.includes(kind);
    // 'in_progress' y 'manual_review' son los dos casos donde el resultado real puede
    // estar resuelto del lado del backend aunque esta pantalla todavía no se haya
    // enterado (sesión de Didit con webhook en camino, o revisión manual que un
    // operador ya cerró — caso real reportado, ver comentario del auto-refresh de
    // arriba). El auto-refresh al entrar ya cubre el caso típico ("volví a abrir la
    // app"/"toqué Continuar verificación"); este link es la vía manual para cuando el
    // usuario se queda en la pantalla esperando y quiere volver a chequear sin salir.
    const canRefresh = kind === "in_progress" || kind === "manual_review";
    const isApproved = kind === "approved";
    return (
      <SafeAreaView className="flex-1 bg-bg px-8 pt-16">
        <View className="flex-1 items-center">
          <View
            testID="kyc-result-badge"
            className={`mb-5 h-14 w-14 items-center justify-center rounded-[14px] ${
              BADGE_TONE_CLASS[badge.tone]
            }`}
          >
            <BadgeIcon
              size={26}
              strokeWidth={2.25}
              color={
                badge.tone === "neutral"
                  ? colors.fg2
                  : BADGE_ICON_COLOR[badge.tone]
              }
            />
          </View>
          <Text
            testID="kyc-result-title"
            className="mb-2 text-center font-sans-semibold text-h2 text-fg"
          >
            {copy.title}
          </Text>
          <Text className="text-center font-sans text-body text-fg-2">
            {copy.body}
          </Text>
        </View>
        <PrimaryButton
          testID="kyc-primary-action"
          label={
            canRetry
              ? "Reintentar verificación"
              : isApproved
                ? "Continuar"
                : "Ir al inicio"
          }
          onPress={handlePrimaryAction}
          loading={loading || refreshing}
        />
        {canRefresh ? (
          <Text
            testID="kyc-refresh-status"
            onPress={handleRefresh}
            className="mb-3 text-center font-sans text-[13px] text-fg-3"
          >
            {kind === "manual_review"
              ? "Actualizar estado"
              : "Ya la completé — actualizar estado"}
          </Text>
        ) : null}
        {canRetry ? (
          <Text
            onPress={goHome}
            className="mb-2 text-center font-sans text-[13px] text-fg-3"
          >
            Ir al inicio
          </Text>
        ) : null}
      </SafeAreaView>
    );
  }

  // Tamaño en píxeles calculado a mano (no `style.aspectRatio`): con solo la
  // altura fijada por className y el ancho dejado a `aspectRatio`, `Image`
  // no resolvía el ancho en el dev client y caía a su tamaño intrínseco
  // (7369x2693 el PNG de Movo) — se veía como una mancha blanca gigante
  // ocupando casi toda la pantalla (un fragmento de la "o" del wordmark,
  // zoomeado). Fijar `width`/`height` numéricos evita depender de que Yoga
  // resuelva `aspectRatio` en `Image` para este build.
  const MOVO_LOGO_HEIGHT = 36;
  const DIDIT_LOGO_HEIGHT = 32;
  const movoLogoSource = isDark
    ? require("../../assets/movo_logo_full_dark.png")
    : require("../../assets/movo_logo_full.png");
  // Los dos PNG de Movo no comparten exactamente el mismo aspect ratio (7369x2693
  // el claro, 7375x2583 el oscuro) — se calcula por variante para que ninguno se
  // vea estirado.
  const movoLogoAspectRatio = isDark ? 7375 / 2583 : 7369 / 2693;
  const movoLogoWidth = MOVO_LOGO_HEIGHT * movoLogoAspectRatio;
  const diditLogoSource = isDark
    ? require("../../assets/didit_logo_full_dark.png")
    : require("../../assets/didit_logo_full.png");
  // Rasterizados a mano con `rsvg-convert` a partir del SVG original de
  // Didit (isotipo + wordmark, 1964x680 los dos, mismo aspect ratio) — el
  // SVG original tenía un `<image>` (isotipo, anillo degradé) recortado por
  // `clip-path="url(#markClip)"` que `react-native-svg` no aplicaba bien
  // (el clip no se respetaba y el raster se veía sin recortar). `rsvg-convert`
  // sí es un renderer SVG conforme al spec, así que el recorte se resuelve
  // bien ahí; el resultado ya viene aplanado a PNG con canal alfa, sin
  // depender del soporte de clip-path en runtime.
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

        <ErrorBanner testID="kyc-error-banner" message={errorBanner} />

        <Text className="mb-3 font-sans-semibold text-[11px] uppercase tracking-[0.6px] text-fg-3">
          Verificación de identidad
        </Text>
        <Text className="mb-3 font-sans-semibold text-title text-fg">
          Confirmemos que sos vos
        </Text>
        <Text className="mb-6 font-sans text-body text-fg-2">
          Para que puedas enviar y llevar paquetes con confianza, necesitamos
          verificar tu identidad. Lo hacemos junto con{" "}
          <Text className="font-sans-semibold text-fg">Didit</Text>, nuestro
          socio de verificación. No te va a tomar más de 2 minutos.
        </Text>

        <View className="gap-4">
          <IntroStep
            number={1}
            text="Te pedimos unas fotos de tu Documento Nacional de Identidad"
          />
          <IntroStep
            number={2}
            text="Capturamos una selfie de tu rostro para asegurarnos de que efectivamente sos vos"
          />
          <IntroStep
            number={3}
            text="Validamos tu identidad con un sistema seguro y privado"
          />
        </View>

        <Text className="mt-6 font-sans text-[12px] text-fg-3">
          Tus datos están protegidos y solo se usan para verificar tu identidad.
          Movo no almacena imágenes de tu DNI ni tu rostro.
        </Text>
      </View>

      <PrimaryButton
        testID="kyc-begin-verification"
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
        <Text className="font-sans-semibold text-[13px] text-ink-950">
          {number}
        </Text>
      </View>
      <Text className="flex-1 font-sans text-[13px] leading-5 text-fg">
        {text}
      </Text>
    </View>
  );
}
