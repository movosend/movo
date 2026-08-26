import { forwardRef, useImperativeHandle, useRef } from "react";
import { Keyboard, TextInput, View } from "react-native";

export const OTP_LENGTH = 6;

export interface OtpInputHandle {
  /** Limpia el valor y devuelve el foco a la primera casilla (usado tras un reenvío). */
  focusFirst: () => void;
}

export interface OtpInputProps {
  /** Código completo como string (`""` a `"123456"`). El componente no guarda estado propio. */
  value: string;
  onChange: (code: string) => void;
  /** Se dispara cuando se completan las `length` casillas. */
  onComplete?: (code: string) => void;
  length?: number;
  autoFocus?: boolean;
  editable?: boolean;
  /** Cada casilla queda como `${testIDPrefix}-${index}`. */
  testIDPrefix?: string;
  /**
   * `autoComplete` de la primera casilla (MOVO-141): el autofill de SMS de iOS/Android
   * solo tiene sentido cuando el código viajó por SMS. `"sms-otp"` por defecto —
   * ningún caller existente (registro, cambio de teléfono/email) manda un código por
   * otro canal.
   */
  firstBoxAutoComplete?: "sms-otp" | "off";
}

/**
 * Input de código OTP de N casillas — extraído del paso 5 del wizard de registro
 * (MOVO-73), donde vivía inline dentro de `app/(auth)/register.tsx`. MOVO-135 lo
 * necesita también en los sub-flujos de cambio de teléfono y email desde el perfil,
 * así que pasó a ser un componente compartido en vez de duplicarse.
 *
 * Presentacional puro: el valor lo maneja quien lo usa. Lo único imperativo que
 * expone es `focusFirst()` (`useImperativeHandle`), porque el reenvío de código
 * necesita limpiar y volver a la primera casilla desde afuera.
 */
export const OtpInput = forwardRef<OtpInputHandle, OtpInputProps>(function OtpInput(
  {
    value,
    onChange,
    onComplete,
    length = OTP_LENGTH,
    autoFocus = false,
    editable = true,
    testIDPrefix = "otp-input",
    firstBoxAutoComplete = "sms-otp",
  },
  ref,
) {
  const inputRefs = useRef<Array<TextInput | null>>([]);

  useImperativeHandle(ref, () => ({
    focusFirst: () => inputRefs.current[0]?.focus(),
  }));

  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  function emit(next: string[]) {
    const code = next.join("");
    onChange(code);
    if (code.length === length && !next.some((d) => !d)) onComplete?.(code);
  }

  function onDigitChange(index: number, raw: string) {
    const incoming = raw.replace(/\D/g, "");

    // El autocompletado de SMS en iOS puede entregar el código completo (no un solo
    // carácter) al campo que tenía el foco — por eso las casillas no llevan
    // `maxLength`. Se distribuye entre las casillas restantes en vez de asumir que
    // `raw` es siempre un dígito suelto.
    if (incoming.length > 1) {
      const next = [...digits];
      for (let i = 0; i < incoming.length && index + i < length; i++) {
        next[index + i] = incoming[i]!;
      }
      const lastFilled = Math.min(index + incoming.length, length) - 1;
      inputRefs.current[lastFilled]?.focus();
      if (lastFilled === length - 1) Keyboard.dismiss();
      emit(next);
      return;
    }

    const digit = incoming.slice(-1);
    const next = [...digits];
    next[index] = digit;
    if (digit && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    } else if (digit && index === length - 1) {
      Keyboard.dismiss();
    }
    emit(next);
  }

  function onKeyPress(index: number, key: string) {
    if (key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  return (
    <View className="flex-row gap-2">
      {digits.map((digit, index) => (
        <TextInput
          key={index}
          testID={`${testIDPrefix}-${index}`}
          ref={(el) => {
            inputRefs.current[index] = el;
          }}
          value={digit}
          editable={editable}
          autoFocus={autoFocus && index === 0}
          onChangeText={(v) => onDigitChange(index, v)}
          onKeyPress={({ nativeEvent }) => onKeyPress(index, nativeEvent.key)}
          keyboardType="number-pad"
          autoComplete={index === 0 ? firstBoxAutoComplete : "off"}
          textContentType="oneTimeCode"
          returnKeyType="done"
          className={`h-14 flex-1 rounded-lg border border-border-strong text-center font-sans-semibold text-[22px] ${
            editable ? "text-fg" : "bg-bg-mute text-fg-3"
          }`}
        />
      ))}
    </View>
  );
});
