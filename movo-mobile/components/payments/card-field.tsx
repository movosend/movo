import { forwardRef, useState } from "react";
import { Text, TextInput, type TextInputProps, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

interface CardFieldProps extends Omit<TextInputProps, "style"> {
  label: string;
  /** Texto a la derecha del label (contador del nombre de referencia). */
  labelRight?: string;
  /** Sufijo gris del label, ej. "(opcional)". */
  labelHint?: string;
  mono?: boolean;
  /** Borde rojo y, si es texto, mensaje debajo. `true` solo pinta el borde. */
  error?: string | boolean | null;
  onFocusChange?: (focused: boolean) => void;
  testID: string;
}

/**
 * Campo de los formularios de tarjeta (MOVO-101), con el estilo del prototipo: 52px de alto,
 * radio 6, borde negro de 1,5 y halo lima al enfocar. El halo es un borde de 4px por fuera
 * porque RN no tiene `box-shadow` con spread.
 */
export const CardField = forwardRef<TextInput, CardFieldProps>(function CardField(
  { label, labelRight, labelHint, mono, error, onFocusChange, testID, ...inputProps },
  ref,
) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const hasError = !!error;
  const borderColor = focused ? colors.fg1 : hasError ? "#E5484D" : colors.borderStrong;

  return (
    <View className="gap-1.5">
      <View className="flex-row items-baseline justify-between gap-2">
        <Text className="font-sans-medium text-[12px] text-fg-2">
          {label}
          {labelHint ? <Text className="font-sans text-fg-3"> {labelHint}</Text> : null}
        </Text>
        {labelRight ? (
          <Text testID={`${testID}-counter`} className="font-mono text-[11px] text-fg-3">
            {labelRight}
          </Text>
        ) : null}
      </View>
      <View
        style={{
          margin: -4,
          padding: 4,
          borderRadius: 10,
          backgroundColor: focused ? "rgba(198,242,74,0.35)" : "transparent",
        }}
      >
        <TextInput
          ref={ref}
          testID={testID}
          accessibilityLabel={label}
          placeholderTextColor="#8A8A93"
          {...inputProps}
          onFocus={(e) => {
            setFocused(true);
            onFocusChange?.(true);
            inputProps.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onFocusChange?.(false);
            inputProps.onBlur?.(e);
          }}
          style={{
            height: 52,
            borderRadius: 6,
            borderWidth: focused ? 1.5 : 1,
            borderColor,
            paddingHorizontal: focused ? 13.5 : 14,
            fontFamily: mono ? "JetBrainsMono_400Regular" : "Inter_400Regular",
            fontSize: mono ? 16 : 15,
            letterSpacing: mono ? 0.64 : 0,
            color: colors.fg1,
            backgroundColor: colors.bg,
          }}
        />
      </View>
      {typeof error === "string" ? (
        <Text testID={`${testID}-error`} className="font-sans text-[12px] text-danger-600">
          {error}
        </Text>
      ) : null}
    </View>
  );
});
