import { MessageSquare } from "lucide-react-native";
import { type ReactNode, forwardRef } from "react";
import { Text, View } from "react-native";
import { OtpInput, type OtpInputHandle } from "./otp-input";
import { formatCooldown } from "../../src/hooks/use-otp-cooldown";

export interface OtpStepProps {
  title: string;
  /** Copy que explica a dónde se mandó el código. `ReactNode` para poder resaltar
   * el destino en semibold dentro de la frase. */
  description: ReactNode;
  code: string;
  onChangeCode: (code: string) => void;
  onComplete?: (code: string) => void;
  onResend: () => void;
  /** Segundos restantes del cooldown; `<= 0` habilita el reenvío. */
  secondsLeft: number;
  editable?: boolean;
  autoFocus?: boolean;
  /** Prefijo de los `testID`: casillas `${testIDPrefix}-input-${i}`, reenvío
   * `${testIDPrefix}-resend`, contador `${testIDPrefix}-resend-cooldown`. */
  testIDPrefix: string;
}

/**
 * Sección visual completa de verificación por OTP: ícono + título + copy + casillas
 * + reenviar/contador. Extraída del paso 5 del wizard de registro (MOVO-73) para que
 * los sub-flujos de cambio de teléfono y email del perfil (MOVO-135) no la dupliquen.
 *
 * A propósito **no** incluye el botón primario: en el registro el botón es el del
 * wizard, fijo al pie y compartido por los 7 pasos, mientras que en las pantallas de
 * cambio desde el perfil es propio de la pantalla. Tampoco sabe nada de pasos ni de
 * navegación — quien la usa decide qué hacer con el código.
 */
export const OtpStep = forwardRef<OtpInputHandle, OtpStepProps>(function OtpStep(
  {
    title,
    description,
    code,
    onChangeCode,
    onComplete,
    onResend,
    secondsLeft,
    editable = true,
    autoFocus = false,
    testIDPrefix,
  },
  ref,
) {
  return (
    <View>
      <View className="mb-4 mt-2 h-14 w-14 items-center justify-center rounded-[14px] bg-lime-200">
        <MessageSquare size={26} color="#0A0A0B" strokeWidth={1.8} />
      </View>
      <Text className="mb-1.5 font-sans-semibold text-title text-fg">{title}</Text>
      <Text className="mb-5 font-sans text-body text-fg-2">{description}</Text>

      <Text className="mb-1.5 font-sans-medium text-[12px] text-fg-2">
        Código de verificación
      </Text>
      <OtpInput
        ref={ref}
        value={code}
        onChange={onChangeCode}
        onComplete={onComplete}
        editable={editable}
        autoFocus={autoFocus}
        testIDPrefix={`${testIDPrefix}-input`}
      />

      <View className="mt-5 flex-row items-center justify-between">
        {secondsLeft <= 0 ? (
          <Text
            testID={`${testIDPrefix}-resend`}
            onPress={onResend}
            className="font-sans-semibold text-[13px] text-fg underline"
          >
            Reenviar código
          </Text>
        ) : (
          <Text
            testID={`${testIDPrefix}-resend-cooldown`}
            className="font-sans text-[13px] text-fg-3"
          >
            Reenviar código en {formatCooldown(secondsLeft)}
          </Text>
        )}
      </View>
    </View>
  );
});
