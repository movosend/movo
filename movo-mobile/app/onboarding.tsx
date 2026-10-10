import { StatusBar } from "expo-status-bar";
import {
  Bell,
  Camera as CameraIcon,
  MapPin,
  Settings,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { OnboardingInfoRow } from "../components/onboarding/onboarding-info-row";
import {
  CameraIllustration,
  LocationIllustration,
  NetworkIllustration,
  NotificationsIllustration,
  ReadyIllustration,
  TrustIllustration,
} from "../components/onboarding/onboarding-illustrations";
import { OnboardingProgressBar } from "../components/onboarding/onboarding-progress-bar";
import { type PermissionOutcome, useOnboardingFlow } from "../src/hooks/use-onboarding-flow";

/**
 * Carrusel de onboarding pre-cuenta (MOVO-249) — se muestra una sola vez, antes de
 * llegar a la pantalla de bienvenida (`app/index.tsx`), gateado por
 * `src/lib/onboarding-storage.ts`. Implementación fiel al prototipo de Claude Design
 * ("Onboarding"), con tres diferencias deliberadas: los 3 pasos de permisos disparan
 * el diálogo REAL del SO en vez de uno simulado (no hace falta reconstruir la UI del
 * alert nativo); las ilustraciones son una reinterpretación en RN puro del
 * `<canvas>`/avatares remotos del prototipo (ver `onboarding-illustrations.tsx`); y
 * **ubicación y cámara son bloqueantes** (sin "Ahora no", no se avanza sin ellas —
 * ver `src/lib/required-permissions.ts`), a diferencia del prototipo, donde los tres
 * permisos eran salteables por igual.
 *
 * Fondo fijo por paso (blanco en concepto/final, negro en permisos) — a propósito NO
 * theme-aware: es una secuencia de diseño, no una reacción al tema del sistema
 * (mismo criterio que `handshake-confirmation-result.tsx`, `bg-ink-950` fijo).
 */
export default function OnboardingScreen() {
  const flow = useOnboardingFlow();
  const bgClass = flow.isDarkStep ? "bg-ink-950" : "bg-paper";

  return (
    <SafeAreaView className={`flex-1 ${bgClass}`} edges={["top", "bottom"]}>
      <StatusBar style={flow.isDarkStep ? "light" : "dark"} />

      {flow.showProgress ? (
        <OnboardingProgressBar
          step={flow.step}
          showBack={flow.showBack}
          showSkip={flow.showSkip}
          isDark={flow.isDarkStep}
          onBack={flow.back}
          onSkip={flow.skipIntro}
        />
      ) : null}

      <View className="flex-1 justify-between pb-6 pt-2">
        {flow.step === 0 ? (
          <ConceptStep
            illustration={<NetworkIllustration />}
            title="Enviá algo a cualquier lado. A través de alguien que ya va."
            subtitle="Movo conecta tu paquete con personas que hacen ese camino todos los días."
            onNext={flow.next}
          />
        ) : null}

        {flow.step === 1 ? (
          <ConceptStep
            illustration={<TrustIllustration />}
            title="Confiá en un desconocido como en alguien conocido."
            subtitle="Verificamos la identidad de todos los miembros, seguís tu paquete en vivo y gestionamos los pagos de forma segura."
            onNext={flow.next}
          />
        ) : null}

        {flow.step === 2 ? (
          <PermissionStep
            eyebrow="Ubicación"
            eyebrowIcon={MapPin}
            title="Seguí tu envío en tiempo real"
            illustration={<LocationIllustration />}
            infoIcon={ShieldCheck}
            infoTitle="Solo cuando hace falta"
            infoSubtitle="La usamos al usar la app. Si transportás, también en segundo plano mientras tengas un viaje en curso."
            primaryLabel="Activar ubicación"
            isPending={flow.pendingPermission === "location"}
            onPrimary={flow.requestLocation}
            required
            outcome={flow.permissions.location}
            blockedCopy="Sin ubicación no podemos confirmar ninguna entrega. Activala desde Ajustes y volvé a Movo."
            deniedCopy="Necesitamos tu ubicación para validar las entregas. Sin este permiso no podés usar Movo."
            onOpenSettings={flow.openSettings}
          />
        ) : null}

        {flow.step === 3 ? (
          <PermissionStep
            eyebrow="Notificaciones"
            eyebrowIcon={Bell}
            title="Enterate de cada paso del envío"
            illustration={<NotificationsIllustration />}
            infoIcon={Bell}
            infoTitle="Solo lo importante"
            infoSubtitle="Nada de promociones. Elegí qué avisos recibir en Ajustes."
            primaryLabel="Activar notificaciones"
            isPending={flow.pendingPermission === "notifications"}
            onPrimary={flow.requestNotifications}
            onSkip={() => flow.skipPermission("notifications")}
          />
        ) : null}

        {flow.step === 4 ? (
          <PermissionStep
            eyebrow="Cámara"
            eyebrowIcon={CameraIcon}
            title="Tu cámara, cuando la necesites"
            illustration={<CameraIllustration />}
            infoIcon={ShieldCheck}
            infoTitle="Tus fotos quedan en el envío"
            infoSubtitle="Solo las ven vos y la otra persona que participa del envío."
            primaryLabel="Permitir cámara"
            isPending={flow.pendingPermission === "camera"}
            onPrimary={flow.requestCamera}
            required
            outcome={flow.permissions.camera}
            blockedCopy="Sin cámara no podés escanear el código de un envío. Activala desde Ajustes y volvé a Movo."
            deniedCopy="Necesitamos la cámara para escanear el código del envío. Sin este permiso no podés usar Movo."
            onOpenSettings={flow.openSettings}
          />
        ) : null}

        {flow.step === 5 ? (
          <ReadyStep onFinish={flow.finish} />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function ConceptStep({
  illustration,
  title,
  subtitle,
  onNext,
}: {
  illustration: React.ReactNode;
  title: string;
  subtitle: string;
  onNext: () => void;
}) {
  return (
    <>
      {/* La ilustración tiene alto fijo (400) y el bloque de texto queda anclado
          abajo por el `justify-between` del contenedor: sin este `flex-1`, todo el
          espacio sobrante de una pantalla alta se acumula DEBAJO de la ilustración
          y la deja pegada al header. `flexShrink` es 0 por default en RN, así que
          en pantallas cortas se comporta igual que antes. */}
      <View className="flex-1 items-center justify-center">{illustration}</View>
      <View className="gap-6 px-6">
        <View className="gap-3.5">
          <Text className="font-sans-semibold text-[30px] leading-[33px] tracking-[-0.5px] text-ink-950">
            {title}
          </Text>
          <Text className="font-sans text-body text-ink-500">{subtitle}</Text>
        </View>
        <FixedButton testID="onboarding-next" label="Siguiente" bg="#0A0A0B" fg="#FFFFFF" onPress={onNext} />
      </View>
    </>
  );
}

/**
 * Un paso de permiso. Con `required` (ubicación y cámara) no se dibuja "Ahora no" —
 * el único camino es conceder — y el botón principal cambia según el resultado del
 * último intento: reintentar si el SO todavía puede preguntar, o abrir Ajustes si ya
 * quedó denegado de forma permanente (`blocked`). Sin `required` (notificaciones) el
 * paso se comporta como antes.
 */
function PermissionStep({
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  title,
  illustration,
  infoIcon,
  infoTitle,
  infoSubtitle,
  primaryLabel,
  isPending,
  onPrimary,
  onSkip,
  required = false,
  outcome,
  deniedCopy,
  blockedCopy,
  onOpenSettings,
}: {
  eyebrow: string;
  eyebrowIcon: LucideIcon;
  title: string;
  illustration: React.ReactNode;
  infoIcon: LucideIcon;
  infoTitle: string;
  infoSubtitle: string;
  primaryLabel: string;
  isPending: boolean;
  onPrimary: () => void;
  onSkip?: () => void;
  required?: boolean;
  outcome?: PermissionOutcome;
  deniedCopy?: string;
  blockedCopy?: string;
  onOpenSettings?: () => void;
}) {
  const isBlocked = required && outcome === "blocked";
  const isDenied = required && outcome === "denied";
  const warning = isBlocked ? blockedCopy : isDenied ? deniedCopy : null;

  return (
    <>
      <View className="gap-6">
        {/* Sin subtítulo: el título y la fila de info de abajo ya explican el
            permiso. `pt-6` separa el bloque de texto del header (barra de progreso). */}
        <View className="gap-2.5 px-6 pt-6">
          <View className="flex-row items-center gap-2">
            <EyebrowIcon size={14} color="#C6F24A" strokeWidth={2} />
            <Text className="font-sans-medium text-caption uppercase tracking-[1.3px] text-lime-500">
              {eyebrow}
            </Text>
          </View>
          <Text className="font-sans-semibold text-[32px] leading-[35px] tracking-[-0.5px] text-paper">
            {title}
          </Text>
        </View>
        {illustration}
      </View>

      <View className="gap-3 px-6">
        {warning ? (
          <View
            testID="onboarding-permission-warning"
            className="flex-row items-start gap-3 rounded-2xl border border-danger-500/30 bg-danger-500/10 p-3.5"
          >
            <TriangleAlert size={18} color="#E5484D" strokeWidth={2} />
            <Text className="flex-1 font-sans text-[13px] leading-[18px] text-paper">
              {warning}
            </Text>
          </View>
        ) : (
          <OnboardingInfoRow icon={infoIcon} title={infoTitle} subtitle={infoSubtitle} />
        )}
        <View className="gap-2">
          <FixedButton
            testID="onboarding-permission-primary"
            label={isBlocked ? "Abrir Ajustes" : primaryLabel}
            icon={isBlocked ? Settings : undefined}
            bg="#FFFFFF"
            fg="#0A0A0B"
            loading={isPending}
            onPress={isBlocked ? onOpenSettings ?? onPrimary : onPrimary}
          />
          {required ? null : (
            <Pressable
              testID="onboarding-permission-later"
              onPress={onSkip}
              disabled={isPending}
              className="h-12 items-center justify-center rounded-lg"
            >
              <Text className="font-sans-medium text-body text-ink-300">Ahora no</Text>
            </Pressable>
          )}
        </View>
      </View>
    </>
  );
}

function ReadyStep({ onFinish }: { onFinish: () => void }) {
  return (
    <>
      <View className="gap-8">
        <ReadyIllustration />
        {/* Alineado a la izquierda, igual que los pasos de concepto y de permisos —
            centrar solo esta pantalla la desalineaba del resto del carrusel. */}
        <View className="gap-3 px-6">
          <Text className="font-sans-semibold text-[28px] leading-[32px] tracking-[-0.5px] text-ink-950">
            ¿Listo para ser parte de Movo?
          </Text>
          <Text className="font-sans text-body text-ink-500">
            Creá tu cuenta o iniciá sesión cuando quieras.
          </Text>
        </View>
      </View>
      <View className="px-6">
        <FixedButton testID="onboarding-finish" label="Empezar" bg="#C6F24A" fg="#0A0A0B" onPress={onFinish} />
      </View>
    </>
  );
}

function FixedButton({
  testID,
  label,
  bg,
  fg,
  loading,
  icon: Icon,
  onPress,
}: {
  testID: string;
  label: string;
  bg: string;
  fg: string;
  loading?: boolean;
  icon?: LucideIcon;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={loading}
      style={{ backgroundColor: bg, opacity: loading ? 0.8 : 1 }}
      className="h-14 flex-row items-center justify-center gap-2 rounded-lg"
    >
      {loading ? <ActivityIndicator color={fg} /> : null}
      {Icon && !loading ? <Icon size={16} color={fg} strokeWidth={2} /> : null}
      <Text className="font-sans-semibold text-body" style={{ color: fg }}>
        {label}
      </Text>
    </Pressable>
  );
}
