import { PACKAGE_WEIGHT_KG_MIN, PACKAGE_WEIGHT_KG_STEP, roundPackageWeightKg } from "@movo/shared/dist/config/package-dimensions";
import { Minus, Plus } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { OnFocusInput } from "../../src/hooks/use-keyboard-scroll";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

interface WeightStepperProps {
  value: string;
  onChange: (value: string) => void;
  onFocusInput?: OnFocusInput;
  testID?: string;
}

/** "1,5" y "1.5" son lo mismo; `NaN` si no es un número. */
export function parseWeightInput(text: string): number {
  const normalized = text.trim().replace(",", ".");
  return normalized === "" ? NaN : Number(normalized);
}

/** El store guarda el peso con punto; el campo lo muestra con coma, como se escribe en español. */
function toFieldText(value: string): string {
  return value.replace(".", ",");
}

/**
 * Peso en kg, de a 0,5 (MOVO-317). Los botones suman/restan un paso; el campo también se puede
 * escribir (coma o punto) y al salir se redondea al múltiplo de 0,5 más cercano. Vacío, 0 o
 * negativo dejan el valor del wizard en `""` (el paso no deja avanzar). Sin máximo: el tamaño lo
 * decide cada transportista.
 */
export function WeightStepper({ value, onChange, onFocusInput, testID }: WeightStepperProps) {
  const colors = useThemeColors();
  const inputRef = useRef<TextInput>(null);
  const [text, setText] = useState(toFieldText(value));
  const [invalid, setInvalid] = useState(false);

  // Los botones y el reset del wizard cambian `value` desde afuera: el campo lo sigue.
  useEffect(() => {
    setText(toFieldText(value));
  }, [value]);

  const step = (delta: number) => {
    const current = parseWeightInput(value);
    const base = Number.isFinite(current) && current > 0 ? current : 0;
    const next = Math.max(PACKAGE_WEIGHT_KG_MIN, roundPackageWeightKg(base + delta));
    setInvalid(false);
    onChange(String(next));
  };

  const commit = () => {
    const typed = parseWeightInput(text);
    if (!Number.isFinite(typed) || typed <= 0) {
      setInvalid(true);
      onChange("");
      return;
    }
    setInvalid(false);
    const rounded = roundPackageWeightKg(typed);
    onChange(String(rounded));
    setText(toFieldText(String(rounded)));
  };

  return (
    <View testID={testID}>
      <View
        className={`flex-row items-center gap-3 rounded-lg border px-4 py-3 ${
          invalid ? "border-danger-500" : "border-border-strong"
        }`}
      >
        <Pressable
          testID={testID ? `${testID}-minus` : undefined}
          onPress={() => step(-PACKAGE_WEIGHT_KG_STEP)}
          className="h-8 w-8 items-center justify-center rounded-full border border-border-strong"
        >
          <Minus size={14} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <View className="flex-1 flex-row items-center justify-center gap-1.5">
          <TextInput
            ref={inputRef}
            testID={testID ? `${testID}-input` : undefined}
            value={text}
            onChangeText={setText}
            onFocus={() => onFocusInput?.(inputRef)}
            onBlur={commit}
            keyboardType="decimal-pad"
            placeholder="0,5"
            placeholderTextColor={colors.fg3}
            selectTextOnFocus
            textAlign="center"
            textAlignVertical="center"
            // `text-[22px]` sin lineHeight propio — ver el comentario de `text-field.tsx`.
            className="min-w-[64px] font-sans text-[22px] font-light text-fg"
            style={{ includeFontPadding: false }}
          />
          <Text className="font-sans text-[22px] font-light text-fg-2">kg</Text>
        </View>
        <Pressable
          testID={testID ? `${testID}-plus` : undefined}
          onPress={() => step(PACKAGE_WEIGHT_KG_STEP)}
          className="h-8 w-8 items-center justify-center rounded-full border border-border-strong"
        >
          <Plus size={14} color={colors.fg1} strokeWidth={2} />
        </Pressable>
      </View>
      {invalid ? (
        <Text
          testID={testID ? `${testID}-error` : undefined}
          className="mt-1.5 font-sans text-[11px] text-danger-500"
        >
          Ingresá un peso mayor a 0.
        </Text>
      ) : null}
    </View>
  );
}
