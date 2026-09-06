import { forwardRef } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

interface TextareaFieldProps extends TextInputProps {
  label: string;
  error?: string;
  testID?: string;
  containerClassName?: string;
  disabled?: boolean;
  /** A diferencia de `TextField`, requerido acá: el contador (`showCounter`) lo
   * necesita para renderizarse. */
  maxLength: number;
  /** Default `true` -- ocultarlo si el caller ya muestra su propio contador afuera. */
  showCounter?: boolean;
}

/**
 * Variante multilínea de `TextField` (MOVO-171), standalone y no un wrapper suyo --
 * para no arriesgar las instancias single-line ya existentes en todo el repo.
 * Mismo lenguaje visual que el único precedente de multilínea+contador del repo
 * (`components/shipments/rating-sheet.tsx`).
 */
export const TextareaField = forwardRef<TextInput, TextareaFieldProps>(
  function TextareaField(
    {
      label,
      error,
      testID,
      containerClassName,
      disabled = false,
      maxLength,
      showCounter = true,
      value,
      ...inputProps
    },
    ref,
  ) {
    const colors = useThemeColors();
    const length = typeof value === "string" ? value.length : 0;

    return (
      <View className={containerClassName ?? "mb-3.5 gap-1.5"}>
        <Text className="font-sans-medium text-[12px] text-fg-2">{label}</Text>
        <TextInput
          ref={ref}
          testID={testID ? `${testID}-input` : undefined}
          value={value}
          placeholderTextColor={colors.fg3}
          multiline
          numberOfLines={4}
          maxLength={maxLength}
          editable={!disabled}
          className={`w-full rounded-xl border px-3.5 py-3 font-sans text-small leading-5 ${
            disabled ? "border-border bg-bg-mute text-fg-3" : "border-border bg-bg-mute text-fg"
          } ${error ? "border-danger-500" : ""}`}
          style={[{ minHeight: 84, textAlignVertical: "top" }, inputProps.style]}
          {...inputProps}
        />
        {showCounter ? (
          <Text className="self-end font-sans text-[11px] text-fg-3">
            {length}/{maxLength}
          </Text>
        ) : null}
        {error ? (
          <Text
            testID={testID ? `${testID}-error` : undefined}
            className="font-sans text-[12px] text-danger-500"
          >
            {error}
          </Text>
        ) : null}
      </View>
    );
  },
);
