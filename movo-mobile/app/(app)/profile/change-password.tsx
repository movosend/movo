import { ApiError } from "@movo/shared/dist/errors/api-error";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  Eye,
  EyeOff,
  MonitorSmartphone,
} from "lucide-react-native";
import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../../components/auth/primary-button";
import { ErrorBanner } from "../../../components/ui/error-banner";
import { PasswordStrengthMeter } from "../../../components/ui/password-strength-meter";
import { TextField } from "../../../components/ui/text-field";
import { SessionPersistError, useChangePassword } from "../../../src/hooks/use-account-security";
import { useKeyboardScroll } from "../../../src/hooks/use-keyboard-scroll";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../src/lib/error-messages";
import { isPasswordValid } from "../../../src/lib/password-policy";

const POLICY_HINT = "Mínimo 8 caracteres, con al menos una letra y un número.";

/**
 * Cambio de contraseña (MOVO-136, backend MOVO-134). Se llega desde el hub
 * `profile/security.tsx`.
 *
 * Decisiones de UI que no son obvias leyendo el JSX:
 *
 * - **Un toggle de ojo por campo, no uno global** (el registro de MOVO-73 comparte un
 *   solo `showPassword` entre sus dos campos). Acá no alcanza: querés poder revelar la
 *   contraseña nueva para chequear que la escribiste bien sin dejar expuesta la actual.
 * - **Validación en `onBlur`, nunca por tecla** (mismo patrón `touched` del registro).
 *   La única excepción es `PasswordStrengthMeter`, que es feedback positivo en vivo y
 *   no un error. "Repetir" muestra un check cuando coincide y error solo al salir del
 *   campo — marcar "no coinciden" mientras todavía estás escribiendo es ruido.
 * - **El aviso de cierre de sesión en otros dispositivos va ANTES de enviar**, no
 *   después: enterarte de un efecto secundario una vez que ya lo aceptaste no es
 *   consentimiento.
 * - **El éxito es un estado de pantalla, no un `Alert`** (mismo criterio que las
 *   pantallas de resultado de `kyc.tsx`) — el repo evitó a propósito traer una
 *   librería de toast, y así hay lugar para repetir qué pasó con las otras sesiones.
 * - **Contraseña actual incorrecta se muestra bajo ESE campo**, no en el banner: es un
 *   error de campo y el foco vuelve ahí. El banner queda para lo que no pertenece a
 *   ningún campo (red, rate limit del backend).
 */
export default function ChangePasswordScreen() {
  const colors = useThemeColors();
  const { scrollRef, onScroll, onFocusInput } = useKeyboardScroll();
  const changePassword = useChangePassword();

  const currentRef = useRef<TextInput>(null);
  const newRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const [done, setDone] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [touched, setTouched] = useState({ current: false, next: false, confirm: false });
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  /** Error del backend anclado al campo "contraseña actual" (401). Se limpia apenas
   * el usuario vuelve a escribir ahí — si no, el mensaje sobrevive a la corrección. */
  const [currentPasswordServerError, setCurrentPasswordServerError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const matches = confirmPassword === newPassword;
  const isSameAsCurrent = newPassword.length > 0 && newPassword === currentPassword;
  const canSubmit =
    currentPassword.length > 0 && isPasswordValid(newPassword) && !isSameAsCurrent && matches;

  const currentError =
    currentPasswordServerError ??
    (touched.current && currentPassword.length === 0 ? "Ingresá tu contraseña actual." : undefined);
  const newError = touched.next
    ? isSameAsCurrent
      ? "Elegí una contraseña distinta de la actual."
      : newPassword.length > 0 && !isPasswordValid(newPassword)
        ? POLICY_HINT
        : undefined
    : undefined;
  const confirmError =
    touched.confirm && confirmPassword.length > 0 && !matches
      ? "Las contraseñas no coinciden."
      : undefined;

  const handleSubmit = () => {
    setBanner(null);
    setCurrentPasswordServerError(null);
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setDone(true);
        },
        onError: (error) => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          // El backend ya cambió la contraseña y revocó las sesiones viejas; lo único
          // que falló fue guardarla localmente. Nunca es "contraseña actual mal" —
          // reintentar con la vieja acá sería literalmente engañoso.
          if (error instanceof SessionPersistError) {
            setBanner(
              "Tu contraseña se cambió, pero no pudimos guardar la sesión en este dispositivo. Cerrá la app y volvé a iniciar sesión con tu contraseña nueva.",
            );
            return;
          }
          // Un 401 acá nunca es "la sesión venció" — el interceptor de `http-client.ts`
          // solo refresca ante `AUTH_TOKEN_EXPIRED` y deja pasar el resto de los 401
          // sin tocar la sesión, así que este código significa exactamente una cosa:
          // la contraseña actual está mal (AC3).
          if (error instanceof ApiError && error.code === "AUTH_INVALID_CREDENTIALS") {
            setCurrentPasswordServerError("La contraseña actual no es correcta.");
            currentRef.current?.focus();
            return;
          }
          setBanner(
            friendlyErrorMessage(error, "No pudimos cambiar tu contraseña. Intentá de nuevo.", {
              RATE_LIMIT_EXCEEDED:
                "Hiciste demasiados intentos de cambio de contraseña. Esperá unos minutos y volvé a probar.",
              VALIDATION_FAILED: POLICY_HINT,
            }),
          );
        },
      },
    );
  };

  if (done) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
        <View testID="change-password-success" className="flex-1 items-center justify-center px-8">
          <View className="mb-5 h-16 w-16 items-center justify-center rounded-full bg-success-500">
            <CheckCircle2 size={32} color="#FFFFFF" strokeWidth={2} />
          </View>
          <Text className="mb-2 text-center font-sans-semibold text-title text-fg">
            Contraseña actualizada
          </Text>
          <Text className="text-center font-sans text-body text-fg-2">
            Cerramos la sesión en tus otros dispositivos. En este seguís conectado, no
            hace falta que vuelvas a iniciar sesión.
          </Text>
        </View>
        <PrimaryButton testID="change-password-done" label="Volver" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="change-password-back"
          onPress={() => router.back()}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">Cambiar contraseña</Text>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 16 : 0}
      >
        <ScrollView
          ref={scrollRef}
          testID="change-password-content"
          contentContainerClassName="px-5 pb-8"
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
          <ErrorBanner testID="change-password-error" message={banner} />

          <TextField
            ref={currentRef}
            testID="change-password-current"
            label="Contraseña actual"
            placeholder="Tu contraseña de hoy"
            secureTextEntry={!showCurrent}
            autoComplete="current-password"
            textContentType="password"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            value={currentPassword}
            onChangeText={(v) => {
              setCurrentPassword(v);
              setCurrentPasswordServerError(null);
            }}
            onFocus={() => onFocusInput(currentRef)}
            onBlur={() => setTouched((t) => ({ ...t, current: true }))}
            onSubmitEditing={() => newRef.current?.focus()}
            error={currentError}
            rightElement={
              <Pressable
                testID="change-password-current-toggle"
                onPress={() => setShowCurrent((s) => !s)}
                hitSlop={8}
                className="h-7 w-7 items-center justify-center"
              >
                {showCurrent ? (
                  <EyeOff size={18} color={colors.fg2} strokeWidth={1.8} />
                ) : (
                  <Eye size={18} color={colors.fg2} strokeWidth={1.8} />
                )}
              </Pressable>
            }
          />

          <View className="mb-1 mt-3 h-px bg-border" />

          <TextField
            ref={newRef}
            testID="change-password-new"
            label="Contraseña nueva"
            placeholder="Mínimo 8 caracteres"
            secureTextEntry={!showNew}
            autoComplete="new-password"
            textContentType="newPassword"
            passwordRules="minlength: 8; required: lower; required: digit;"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            value={newPassword}
            onChangeText={setNewPassword}
            onFocus={() => onFocusInput(newRef)}
            onBlur={() => setTouched((t) => ({ ...t, next: true }))}
            onSubmitEditing={() => confirmRef.current?.focus()}
            error={newError}
            rightElement={
              <Pressable
                testID="change-password-new-toggle"
                onPress={() => setShowNew((s) => !s)}
                hitSlop={8}
                className="h-7 w-7 items-center justify-center"
              >
                {showNew ? (
                  <EyeOff size={18} color={colors.fg2} strokeWidth={1.8} />
                ) : (
                  <Eye size={18} color={colors.fg2} strokeWidth={1.8} />
                )}
              </Pressable>
            }
          />
          <PasswordStrengthMeter testID="change-password-strength" password={newPassword} />

          <TextField
            ref={confirmRef}
            testID="change-password-confirm"
            label="Repetir contraseña nueva"
            placeholder="Volvé a escribirla"
            secureTextEntry={!showNew}
            autoComplete="new-password"
            textContentType="newPassword"
            passwordRules="minlength: 8; required: lower; required: digit;"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            onFocus={() => onFocusInput(confirmRef)}
            onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
            onSubmitEditing={() => canSubmit && handleSubmit()}
            error={confirmError}
            rightElement={
              confirmPassword.length > 0 && matches ? (
                <View
                  testID="change-password-match"
                  className="h-5 w-5 items-center justify-center rounded-full bg-success-500"
                >
                  <Check size={12} color="#FFFFFF" strokeWidth={3} />
                </View>
              ) : undefined
            }
          />

          <View className="mt-2 flex-row gap-3 rounded-[10px] bg-bg-mute px-3.5 py-3">
            <MonitorSmartphone size={18} strokeWidth={1.8} color={colors.fg3} />
            <Text className="flex-1 font-sans text-[12px] text-fg-2">
              Al cambiarla vamos a cerrar la sesión en tus otros dispositivos. En este
              seguís conectado.
            </Text>
          </View>
        </ScrollView>

        <PrimaryButton
          testID="change-password-submit"
          label="Cambiar contraseña"
          onPress={handleSubmit}
          disabled={!canSubmit}
          loading={changePassword.isPending}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
