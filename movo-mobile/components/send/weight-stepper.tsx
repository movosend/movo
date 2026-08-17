import { Minus, Plus } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

const STEP_KG = 0.1;
const MIN_KG = 0.1;
const MAX_KG = 30;

interface WeightStepperProps {
  value: string;
  onChange: (value: string) => void;
  testID?: string;
}

/** Peso en kg, mismos límites que `weightKg` en `createShipmentBody`
 * (`shipments.schema.ts`, MOVO-80: min 0.1, max 30). */
export function WeightStepper({ value, onChange, testID }: WeightStepperProps) {
  const colors = useThemeColors();
  const numeric = Number(value) || MIN_KG;

  const step = (delta: number) => {
    const next = Math.min(
      MAX_KG,
      Math.max(MIN_KG, Math.round((numeric + delta) * 10) / 10),
    );
    onChange(String(next));
  };

  return (
    <View
      testID={testID}
      className="flex-row items-center gap-3 rounded-lg border border-border-strong px-4 py-3"
    >
      <Pressable
        testID={testID ? `${testID}-minus` : undefined}
        onPress={() => step(-STEP_KG)}
        className="h-8 w-8 items-center justify-center rounded-full border border-border-strong"
      >
        <Minus size={14} color={colors.fg1} strokeWidth={2} />
      </Pressable>
      <Text className="flex-1 text-center font-sans text-[22px] font-light text-fg">
        {numeric} kg
      </Text>
      <Pressable
        testID={testID ? `${testID}-plus` : undefined}
        onPress={() => step(STEP_KG)}
        className="h-8 w-8 items-center justify-center rounded-full border border-border-strong"
      >
        <Plus size={14} color={colors.fg1} strokeWidth={2} />
      </Pressable>
    </View>
  );
}
