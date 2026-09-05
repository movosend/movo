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
  /**
   * Campo bloqueado: además de `editable={false}` (que por sí solo no cambia nada
   * visualmente), lo pinta como inerte. Nace en MOVO-135 para el nombre/apellido
   * bloqueados por KYC aprobado (`PROFILE_NAME_LOCKED_BY_KYC`): el usuario tiene que
   * ver que no se puede editar antes de intentarlo, no chocarse con un 409.
   */
  disabled?: boolean;
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
      disabled = false,
      ...inputProps
    },
    ref,
  ) {
    const colors = useThemeColors();
    // `multiline` (bio de MOVO-171) no puede compartir el centrado vertical de una
    // sola línea: `textAlignVertical="center"` en Android empuja todo el texto al
    // medio del box en vez de arrancar arriba, y el `includeFontPadding:false` de
    // abajo existe solo para el descentrado de una línea en iOS, no aplica acá.
    const isMultiline = !!inputProps.multiline;

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
            className={`w-full rounded-md border font-sans text-[15px] ${
              isMultiline ? "min-h-[92px] py-3" : "py-3"
            } ${
              disabled
                ? "border-border bg-bg-mute text-fg-3"
                : "border-border-strong text-fg"
            } ${rightElement ? "pr-11" : "pr-3.5"} ${
              leftElement ? "pl-[78px]" : "pl-3.5"
            }`}
            textAlignVertical={isMultiline ? "top" : "center"}
            editable={!disabled}
            {...inputProps}
            style={[isMultiline ? null : { includeFontPadding: false }, inputProps.style]}
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
