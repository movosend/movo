import { KycStatus } from "@movo/shared/dist/types/user";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Lock, Package } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { useTourAnchor } from "../../src/hooks/use-tour-anchor";

export interface HomeSendCtaProps {
  kycStatus: KycStatus | undefined;
  /** MOVO-300: cuenta suspendida, bloquea publicar (y cotizar) un envío. Gana sobre el KYC. */
  isSuspended?: boolean;
  testID?: string;
  /** MOVO-169: lleva la CTA a la vista para el paso "Publicá un envío" del tutorial. */
  scrollIntoView?: (layoutY: number) => void;
}

/**
 * CTA primaria de Inicio (MOVO-83 AC1): la acción central de la app se gana el color
 * de marca (lime, `bg-lime-500` sólido — mismo criterio que la variante `lime` de
 * `PrimaryButton`, sin gradiente), a diferencia del resto de la UI que es
 * deliberadamente neutra (`ink`/`paper`). Bloqueada con el mismo criterio que ya usa
 * el banner de KYC de `home.tsx` — sin identidad verificada no tiene sentido dejar
 * arrancar el wizard.
 *
 * MOVO-300: también bloqueada con la cuenta suspendida (el gateway rechaza crear y cotizar un
 * envío, MOVO-298). Ese motivo gana sobre el de KYC: es el que el usuario no puede resolver solo.
 *
 * Navega a `/send` (fuera de `(tabs)/`, sibling de `license-kyc.tsx`) — todavía un
 * placeholder: el wizard real de MOVO-83 depende del backend de creación de envío
 * (MOVO-80, ya Done) pero se implementa en un ticket aparte.
 */
export function HomeSendCta({ kycStatus, isSuspended = false, testID, scrollIntoView }: HomeSendCtaProps) {
  const colors = useThemeColors();
  const tourAnchor = useTourAnchor("home-send-cta", { radius: 20, scrollIntoView });
  const isLocked = isSuspended || kycStatus !== KycStatus.APPROVED;
  const lockedSubtitle = isSuspended
    ? "Tu cuenta está suspendida: no podés publicar envíos nuevos"
    : "Verificá tu identidad para empezar a enviar";

  const handlePress = () => {
    if (isLocked) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/send");
  };

  return (
    <Pressable
      ref={tourAnchor.ref}
      onLayout={tourAnchor.onLayout}
      testID={testID}
      onPress={handlePress}
      disabled={isLocked}
      accessibilityRole="button"
      accessibilityState={{ disabled: isLocked }}
      style={
        isLocked
          ? undefined
          : {
              shadowColor: colors.chromeShadow,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 1,
              shadowRadius: 12,
              elevation: 4,
            }
      }
      className={`mb-6 flex-row items-center gap-4 rounded-[20px] p-[18px] ${
        isLocked ? "bg-bg-mute" : "bg-lime-500"
      }`}
    >
      <View className={`h-12 w-12 items-center justify-center rounded-full ${isLocked ? "bg-fg/10" : "bg-ink-950/10"}`}>
        {isLocked ? (
          <Lock size={22} strokeWidth={1.8} color={colors.fg3} />
        ) : (
          <Package size={22} strokeWidth={1.8} color="#0A0A0B" />
        )}
      </View>
      <View className="flex-1">
        <Text className={`font-sans-semibold text-h3 ${isLocked ? "text-fg" : "text-ink-950"}`}>
          Enviar un paquete
        </Text>
        <Text className={`mt-0.5 font-sans text-small ${isLocked ? "text-fg-2" : "text-ink-950/70"}`}>
          {isLocked
            ? lockedSubtitle
            : "Coordiná un envío con un transportista verificado"}
        </Text>
      </View>
    </Pressable>
  );
}
