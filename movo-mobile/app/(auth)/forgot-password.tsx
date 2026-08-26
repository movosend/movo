import { router } from "expo-router";
import { Eye, EyeOff, KeyRound, Lock } from "lucide-react-native";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WizardHeader } from "../../components/auth/wizard-header";
import { PrimaryButton } from "../../components/auth/primary-button";
import { ErrorBanner } from "../../components/ui/error-banner";
import { OTP_LENGTH, type OtpInputHandle } from "../../components/ui/otp-input";
import { OtpStep } from "../../components/ui/otp-step";
import { PasswordStrengthMeter } from "../../components/ui/password-strength-meter";
import { TextField } from "../../components/ui/text-field";
import { useOtpCooldown } from "../../src/hooks/use-otp-cooldown";
import { usePasswordReset } from "../../src/hooks/use-password-reset";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { isPasswordValid } from "../../src/lib/password-policy";

type Step = 0 | 1 | 2;

const STEP_LABELS = ["Identificate", "Verificá el código", "Nueva contraseña"];

/**
 * Wizard de recuperación de contraseña (MOVO-141, backend MOVO-140). 3 pasos en un
 * solo archivo, mismo esqueleto que `register.tsx`/`change-phone.tsx`: sin selector
 * de canal (AC2 de MOVO-140 del lado backend — mostrarlo filtraría si la cuenta
 * existe), copy que nunca afirma que el identificador está registrado (AC5).
 */
export default function ForgotPasswordScreen() {
  const colors = useThemeColors();
  const passwordReset = usePasswordReset();
  const { secondsLeft, start: startCooldown } = useOtpCooldown();
  const otpRef = useRef<OtpInputHandle | null>(null);

  const [step, setStep] = useState<Step>(0);
  const [identifier, setIdentifier] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [touchedConfirm, setTouchedConfirm] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [tokenInvalid, setTokenInvalid] = useState(false);

  const passwordsMatch = confirmPassword === newPassword;
  const confirmError = touchedConfirm && !passwordsMatch ? "Las contraseñas no coinciden" : "";

  function restart() {
    passwordReset.reset();
    setIdentifier("");
    setOtpCode("");
    setNewPassword("");
    setConfirmPassword("");
    setTouchedConfirm(false);
    setTokenInvalid(false);
    setStep(0);
  }

  function handleBack() {
    if (step === 0) {
      if (router.canGoBack()) router.back();
      else router.replace("/login");
      return;
    }
    passwordReset.clearError();
    setStep((s) => (s - 1) as Step);
  }

  async function handleRequestReset() {
    if (!identifier.trim() || passwordReset.loading) return;
    const result = await passwordReset.requestReset(identifier.trim());
    if (!result.ok) return;
    setOtpCode("");
    startCooldown(result.cooldownSeconds ?? 0);
    setStep(1);
  }

  async function handleVerifyOtp() {
    if (otpCode.length < OTP_LENGTH || passwordReset.loading) return;
    const result = await passwordReset.verifyOtp(otpCode);
    if (result.ok) {
      setStep(2);
      return;
    }
    if (result.expired) {
      // Un código vencido no se arregla reintentando -- mismo criterio que
      // change-phone.tsx/change-email.tsx (MOVO-135): vuelve a pedir uno nuevo.
      setStep(0);
      return;
    }
    // Código incorrecto: se reintenta en el mismo paso.
    setOtpCode("");
    otpRef.current?.focusFirst();
  }

  async function handleResendOtp() {
    if (secondsLeft > 0 || passwordReset.loading) return;
    const result = await passwordReset.resend();
    if (!result.ok) return;
    setOtpCode("");
    startCooldown(result.cooldownSeconds ?? 0);
    otpRef.current?.focusFirst();
  }

  async function handleCompleteReset() {
    if (!isPasswordValid(newPassword) || !passwordsMatch || passwordReset.loading) return;
    const result = await passwordReset.completeReset(newPassword);
    if (result.ok) {
      router.replace({ pathname: "/login", params: { passwordReset: "1" } });
      return;
    }
    if (result.tokenInvalid) setTokenInvalid(true);
  }

  const canSubmitStep0 = identifier.trim().length > 0;
  const canSubmitStep1 = otpCode.length === OTP_LENGTH;
  const canSubmitStep2 = isPasswordValid(newPassword) && passwordsMatch;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <WizardHeader
        progress={(step + 1) / 3}
        stepLabel={STEP_LABELS[step]}
        onBack={handleBack}
        testID="forgot-password-back"
      />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 16 : 0}
      >
        <ScrollView
          className="flex-1 px-6"
          contentContainerClassName="pb-8"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ErrorBanner testID="forgot-password-error" message={passwordReset.errorBanner} />

          {step === 0 && (
            <View>
              <View className="mt-2 mb-4 h-14 w-14 items-center justify-center rounded-[14px] bg-lime-200">
                <KeyRound size={26} color="#0A0A0B" strokeWidth={1.8} />
              </View>
              <Text className="mb-1.5 font-sans-semibold text-title text-fg">
                ¿Olvidaste tu contraseña?
              </Text>
              <Text className="mb-5 font-sans text-body text-fg-2">
                Ingresá tu teléfono o email y, si el dato corresponde a una cuenta de
                Movo, te vamos a mandar un código para recuperar el acceso.
              </Text>
              <TextField
                testID="forgot-password-identifier"
                label="Teléfono o email"
                placeholder="Tu teléfono o email"
                keyboardType="default"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                returnKeyType="done"
                value={identifier}
                onChangeText={setIdentifier}
                onSubmitEditing={() => void handleRequestReset()}
              />
            </View>
          )}

          {step === 1 && (
            <OtpStep
              ref={otpRef}
              testIDPrefix="forgot-password-otp"
              title="Verificá el código"
              description={
                passwordReset.channel === "email" ? (
                  <>
                    Te enviamos un código a tu email. Si el dato corresponde a una
                    cuenta de Movo, vas a recibir un código.
                  </>
                ) : (
                  <>
                    Te enviamos un código por SMS. Si el dato corresponde a una cuenta
                    de Movo, vas a recibir un código.
                  </>
                )
              }
              code={otpCode}
              onChangeCode={setOtpCode}
              onResend={() => void handleResendOtp()}
              secondsLeft={secondsLeft}
              firstBoxAutoComplete={passwordReset.channel === "email" ? "off" : "sms-otp"}
              autoFocus
            />
          )}

          {step === 2 && (
            <View>
              <View className="mt-2 mb-4 h-14 w-14 items-center justify-center rounded-[14px] bg-lime-200">
                <Lock size={26} color="#0A0A0B" strokeWidth={1.8} />
              </View>
              <Text className="mb-1.5 font-sans-semibold text-title text-fg">
                Creá tu contraseña nueva
              </Text>
              <Text className="mb-5 font-sans text-body text-fg-2">
                Vas a usarla para volver a iniciar sesión en Movo.
              </Text>
              <TextField
                testID="forgot-password-new-password"
                label="Contraseña nueva"
                placeholder="Mínimo 8 caracteres"
                secureTextEntry={!showNewPassword}
                autoComplete="new-password"
                textContentType="newPassword"
                passwordRules="minlength: 8; required: lower; required: digit;"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                value={newPassword}
                onChangeText={setNewPassword}
                rightElement={
                  <Pressable
                    testID="forgot-password-new-password-toggle"
                    onPress={() => setShowNewPassword((s) => !s)}
                    hitSlop={8}
                    className="h-7 w-7 items-center justify-center"
                  >
                    {showNewPassword ? (
                      <EyeOff size={18} color={colors.fg2} strokeWidth={1.8} />
                    ) : (
                      <Eye size={18} color={colors.fg2} strokeWidth={1.8} />
                    )}
                  </Pressable>
                }
              />
              <PasswordStrengthMeter
                testID="forgot-password-password-strength"
                password={newPassword}
              />
              <TextField
                testID="forgot-password-confirm-password"
                label="Repetir contraseña"
                placeholder="Volvé a escribirla"
                secureTextEntry={!showNewPassword}
                autoComplete="new-password"
                textContentType="newPassword"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                onBlur={() => setTouchedConfirm(true)}
                error={confirmError}
                onSubmitEditing={() => void handleCompleteReset()}
              />

              {tokenInvalid && (
                <Text testID="forgot-password-token-invalid" className="mt-1 font-sans text-[13px] text-fg-2">
                  El código para cambiar tu contraseña venció o ya se usó. Volvé a
                  empezar para pedir uno nuevo.
                </Text>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {step === 0 && (
        <PrimaryButton
          testID="forgot-password-request"
          label="Enviar código"
          onPress={() => void handleRequestReset()}
          disabled={!canSubmitStep0}
          loading={passwordReset.loading}
        />
      )}
      {step === 1 && (
        <PrimaryButton
          testID="forgot-password-verify"
          label="Verificar código"
          onPress={() => void handleVerifyOtp()}
          disabled={!canSubmitStep1}
          loading={passwordReset.loading}
        />
      )}
      {step === 2 &&
        (tokenInvalid ? (
          <PrimaryButton
            testID="forgot-password-restart"
            label="Volver a empezar"
            onPress={restart}
          />
        ) : (
          <PrimaryButton
            testID="forgot-password-submit"
            label="Cambiar contraseña"
            onPress={() => void handleCompleteReset()}
            disabled={!canSubmitStep2}
            loading={passwordReset.loading}
          />
        ))}
    </SafeAreaView>
  );
}
