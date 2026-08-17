import { forwardRef, type ReactNode } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string;
  testID?: string;
  containerClassName?: string;
  rightElement?: ReactNode;
  leftElement?: ReactNode;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(
  function TextField(
    {
      label,
      error,
      testID,
      containerClassName,
      rightElement,
      leftElement,
      ...inputProps
    },
    ref,
  ) {
    const colors = useThemeColors();

    return (
      <View className={containerClassName ?? "mb-3.5 gap-1.5"}>
        <Text className="font-sans-medium text-[12px] text-fg-2">{label}</Text>
        <View className="relative justify-center">
          <TextInput
            ref={ref}
            testID={testID}
            placeholderTextColor={colors.fg3}
            // `text-body` (22px lineHeight vs 15px fontSize) descentra el texto en iOS: un
            // `TextInput` de una sola línea no reparte ese espacio extra arriba/abajo del
            // glifo como sí lo hace `Text`, lo agrega entero arriba. `text-[15px]` sin
            // lineHeight propio deja que la altura de línea nativa centre bien el texto.
            className={`w-full rounded-md border border-border-strong py-3 font-sans text-[15px] text-fg ${
              rightElement ? "pr-11" : "pr-3.5"
            } ${leftElement ? "pl-[78px]" : "pl-3.5"}`}
            textAlignVertical="center"
            {...inputProps}
            style={[{ includeFontPadding: false }, inputProps.style]}
          />
          {leftElement ? (
            <View className="pointer-events-none absolute left-3.5">
              {leftElement}
            </View>
          ) : null}
          {rightElement ? (
            <View className="absolute right-2">{rightElement}</View>
          ) : null}
        </View>
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
