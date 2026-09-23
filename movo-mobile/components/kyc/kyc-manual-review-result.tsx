import { Hourglass } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../auth/primary-button";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

export interface KycManualReviewResultProps {
  title: string;
  body: string;
  onRefresh: () => void;
  refreshing: boolean;
  /**
   * Enlace secundario "Ir al inicio". Opcional a propósito: `license-kyc.tsx` lo pasa
   * (un transportista sin licencia aprobada todavía puede usar el resto de la app como
   * emisor), `kyc.tsx` (identidad) no lo pasa — decisión explícita del equipo, un
   * usuario sin identidad verificada no debe tener ninguna salida hacia el resto de la
   * app (MOVO-244, PR #184, ver `kyc.test.tsx`).
   */
  onGoHome?: () => void;
  testIDPrefix: string;
}

/**
 * Pantalla de resultado "en revisión manual" (reloj de arena + estimación 24-48hs),
 * extraída acá porque `kyc.tsx` (identidad) y `license-kyc.tsx` (licencia) la
 * duplicaban casi 1:1 (MOVO-244 review, PR #184) — ya habían divergido en el enlace
 * de "Ir al inicio" sin que nada más forzara mantenerlas en sincronía.
 */
export function KycManualReviewResult({
  title,
  body,
  onRefresh,
  refreshing,
  onGoHome,
  testIDPrefix,
}: KycManualReviewResultProps) {
  const colors = useThemeColors();

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-1 items-center justify-center px-7">
        {/* Isotipo central: reloj de arena en tarjeta circular con halo */}
        <View
          testID={`${testIDPrefix}-result-badge`}
          className="relative mb-8 h-32 w-32 items-center justify-center"
        >
          <View className="absolute inset-0 rounded-full border border-border/80" />
          <View className="h-24 w-24 items-center justify-center rounded-full border border-border bg-bg-sub shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
            <Hourglass size={38} strokeWidth={1.75} color={colors.fg1} />
          </View>
        </View>

        {/* Título y subtítulo */}
        <Text
          testID={`${testIDPrefix}-result-title`}
          className="mb-3 text-center font-sans-semibold text-[23px] tracking-tight text-fg leading-snug"
        >
          {title}
        </Text>
        <Text className="max-w-[315px] text-center font-sans text-[15px] text-fg-2 leading-relaxed tracking-tight">
          {body}
        </Text>
      </View>

      {/* Botón primario: Actualizar estado consistente con toda la app */}
      <PrimaryButton
        testID={`${testIDPrefix}-primary-action`}
        label="Actualizar estado"
        onPress={onRefresh}
        loading={refreshing}
        disabled={refreshing}
        variant="dark"
      />
      {onGoHome ? (
        <Pressable testID={`${testIDPrefix}-go-home`} onPress={onGoHome} className="pb-6 pt-2 items-center">
          <Text className="font-sans text-[14px] text-fg-3">Ir al inicio</Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}
