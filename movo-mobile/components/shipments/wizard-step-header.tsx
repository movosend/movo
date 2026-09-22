import { ChevronLeft } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

interface WizardStepHeaderProps {
  title: string;
  step: number;
  totalSteps: number;
  onBack: () => void;
  testIDPrefix: string;
}

/**
 * Header compartido por los pasos accionables de los wizards de retiro y entrega del
 * transportista (MOVO-198/199, rediseño sobre el prototipo "Retiro de paquete -
 * flujo"): back circular + eyebrow "Paso N de M" + título + fila de segmentos —
 * mismo patrón exacto que ya usa `app/(app)/transport/[id]/offer.tsx` para su
 * indicador de 2 pasos, generalizado a N. No se monta en `success.tsx` (pantalla
 * terminal sin progreso). Renombrado desde `PickupWizardStepHeader` en MOVO-199: no
 * tenía nada específico de pickup, solo el nombre lo sugería.
 */
export function WizardStepHeader({ title, step, totalSteps, onBack, testIDPrefix }: WizardStepHeaderProps) {
  const colors = useThemeColors();

  return (
    <View className="gap-2.5 px-5 pb-3.5 pt-1.5">
      <View className="flex-row items-center gap-3">
        <Pressable
          testID={`${testIDPrefix}-back`}
          onPress={onBack}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute active:opacity-75"
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <View className="flex-1">
          <Text className="font-sans-medium text-caption uppercase text-fg-3">
            Paso {step} de {totalSteps}
          </Text>
          <Text className="font-sans-semibold text-h3 text-fg">{title}</Text>
        </View>
      </View>
      <View className="flex-row gap-1.5">
        {Array.from({ length: totalSteps }).map((_, index) => (
          <View
            key={index}
            className={`h-1 flex-1 rounded-full ${index < step ? "bg-fg" : "bg-bg-mute"}`}
          />
        ))}
      </View>
    </View>
  );
}
