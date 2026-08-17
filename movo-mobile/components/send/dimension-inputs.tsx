import { useRef } from "react";
import { Text, TextInput, View } from "react-native";
import type { OnFocusInput } from "../../src/hooks/use-keyboard-scroll";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

interface DimensionInputsProps {
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  onChangeLength: (value: string) => void;
  onChangeWidth: (value: string) => void;
  onChangeHeight: (value: string) => void;
  onFocusInput: OnFocusInput;
  testID?: string;
}

const FIELDS = [
  { key: "length", label: "Largo" },
  { key: "width", label: "Ancho" },
  { key: "height", label: "Alto" },
] as const;

/** Dimensiones en cm, mismos límites que `lengthCm`/`widthCm`/`heightCm` en
 * `createShipmentBody` (`shipments.schema.ts`, MOVO-80: min 1, max 150). */
export function DimensionInputs({
  lengthCm,
  widthCm,
  heightCm,
  onChangeLength,
  onChangeWidth,
  onChangeHeight,
  onFocusInput,
  testID,
}: DimensionInputsProps) {
  const colors = useThemeColors();
  const lengthRef = useRef<TextInput>(null);
  const widthRef = useRef<TextInput>(null);
  const heightRef = useRef<TextInput>(null);
  const valuesByKey = { length: lengthCm, width: widthCm, height: heightCm };
  const onChangeByKey = {
    length: onChangeLength,
    width: onChangeWidth,
    height: onChangeHeight,
  };
  const refByKey = { length: lengthRef, width: widthRef, height: heightRef };

  return (
    <View testID={testID} className="flex-row gap-2.5">
      {FIELDS.map(({ key, label }) => (
        <View key={key} className="flex-1">
          <Text className="mb-1.5 font-sans text-[11px] text-fg-3">
            {label}
          </Text>
          <TextInput
            ref={refByKey[key]}
            testID={testID ? `${testID}-${key}` : undefined}
            value={valuesByKey[key]}
            onChangeText={onChangeByKey[key]}
            onFocus={() => onFocusInput(refByKey[key])}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={colors.fg3}
            textAlignVertical="center"
            // `text-[15px]` sin lineHeight propio — ver el comentario de `text-field.tsx`.
            className="rounded-md border border-border-strong py-2.5 text-center font-sans text-[15px] text-fg"
            style={{ includeFontPadding: false }}
          />
        </View>
      ))}
    </View>
  );
}
