import { KycStatus } from "@movo/shared/dist/types/user";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Lock, Package } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

export interface HomeSendCtaProps {
  kycStatus: KycStatus | undefined;
  testID?: string;
}

/**
 * CTA primaria de Inicio (MOVO-83 AC1): la acción central de la app se gana el color
 * de marca (lime, `bg-lime-500` sólido — mismo criterio que la variante `lime` de
 * `PrimaryButton`, sin gradiente), a diferencia del resto de la UI que es
 * deliberadamente neutra (`ink`/`paper`). Bloqueada con el mismo criterio que ya usa
 * el banner de KYC de `home.tsx` — sin identidad verificada no tiene sentido dejar
 * arrancar el wizard.
 *
 * Navega a `/send` (fuera de `(tabs)/`, sibling de `license-kyc.tsx`) — todavía un
 * placeholder: el wizard real de MOVO-83 depende del backend de creación de envío
 * (MOVO-80, ya Done) pero se implementa en un ticket aparte.
 */
export function HomeSendCta({ kycStatus, testID }: HomeSendCtaProps) {
  const colors = useThemeColors();
  const isLocked = kycStatus !== KycStatus.APPROVED;

  const handlePress = () => {
    if (isLocked) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/send");
  };

  return (
    <Pressable
      testID={testID}
      onPress={handlePress}
      disabled={isLocked}
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
            ? "Verificá tu identidad para empezar a enviar"
            : "Coordiná un envío con un transportista verificado"}
        </Text>
      </View>
    </Pressable>
  );
}
