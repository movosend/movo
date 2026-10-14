import * as Haptics from "expo-haptics";
import { ArrowRight, type LucideIcon } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { BRAND_COLORS } from "../../src/constants/brand-colors";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

export interface CarrierRequirementGateProps {
  icon: LucideIcon;
  title: string;
  body: string;
  ctaLabel: string;
  onPressCta: () => void;
  testID?: string;
}

/**
 * Estado bloqueante "te falta un requisito para transportar" (MOVO-167): ícono en
 * círculo, título, explicación y un CTA directo al flujo que lo resuelve. No sabe qué
 * requisito es — el caller decide el copy y a dónde navega. Hoy lo usan los bloqueos
 * de identidad y de licencia del tab Transportar; MOVO-117 reemplaza el de licencia
 * por una checklist propia (licencia + Mercado Pago) y no reutiliza este componente.
 *
 * Ocupa el alto disponible y centra el mensaje; el `pb-24` compensa la tab bar
 * flotante, que tapa el pie de la pantalla. El CTA ocupa todo el ancho del contenido
 * (estándar de botones de Movo); no es `PrimaryButton` porque ese es una barra de pie
 * de pantalla con borde superior, no un botón para poner en medio del contenido.
 *
 * Es solo UX de entrada: la validación autoritativa sigue siendo del backend
 * (ADR-036, MOVO-116).
 */
export function CarrierRequirementGate({
  icon: Icon,
  title,
  body,
  ctaLabel,
  onPressCta,
  testID,
}: CarrierRequirementGateProps) {
  const colors = useThemeColors();
  return (
    <View testID={testID} className="flex-1 items-center justify-center px-8 pb-24">
      <View className="h-[64px] w-[64px] items-center justify-center rounded-full bg-bg-mute">
        <Icon size={26} strokeWidth={1.8} color={colors.fg1} />
      </View>
      <Text className="mt-5 text-center font-sans-semibold text-[19px] text-fg">{title}</Text>
      <Text className="mx-auto mt-2 max-w-[300px] text-center font-sans text-small text-fg-2">{body}</Text>
      <Pressable
        testID={testID ? `${testID}-cta` : undefined}
        accessibilityRole="button"
        onPress={() => {
          // Sin `.catch`, un dispositivo sin haptics deja un rechazo sin manejar.
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          onPressCta();
        }}
        className="mt-6 h-[50px] w-full flex-row items-center justify-center gap-2 rounded-lg bg-lime-500 px-6 active:opacity-80"
      >
        <Text className="font-sans-semibold text-body text-ink-950">{ctaLabel}</Text>
        <ArrowRight size={17} strokeWidth={1.8} color={BRAND_COLORS.ink950} />
      </Pressable>
    </View>
  );
}
