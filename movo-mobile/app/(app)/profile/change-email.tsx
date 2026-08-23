import { ApiError } from "@movo/shared/dist/errors/api-error";
import { router } from "expo-router";
import { ChevronLeft, Info } from "lucide-react-native";
import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../../components/auth/primary-button";
import { ErrorBanner } from "../../../components/ui/error-banner";
import { OTP_LENGTH, type OtpInputHandle } from "../../../components/ui/otp-input";
import { OtpStep } from "../../../components/ui/otp-step";
import { TextField } from "../../../components/ui/text-field";
import { authClient } from "../../../src/api/auth-client";
import { useOtpCooldown } from "../../../src/hooks/use-otp-cooldown";
import {
  useMyProfile,
  useRequestEmailChange,
  useVerifyEmailChange,
} from "../../../src/hooks/use-profile";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { isEmailValid } from "../../../src/hooks/use-registration";
import { friendlyErrorMessage } from "../../../src/lib/error-messages";
import { formatPhoneDisplay } from "../../../src/lib/profile-format";

/**
 * Cambio verificado de email (MOVO-135 AC5/AC6/AC7, backend MOVO-133).
 *
 * **El código llega por SMS al teléfono ACTUAL, no al email nuevo.** El proyecto no
 * tiene ningún `EmailProvider` (decisión de refinamiento de MOVO-133: construirlo era
 * un ADR nuevo + credenciales nuevas), así que se verifica la identidad del dueño de
 * la cuenta por el canal que ya está verificado. La pantalla lo dice explícitamente
 * en los dos pasos — sin eso, recibir un SMS al cambiar el email es desconcertante.
 */
export default function ChangeEmailScreen() {
  const colors = useThemeColors();
  const { data: profile } = useMyProfile();
  const requestChange = useRequestEmailChange();
  const verifyChange = useVerifyEmailChange();
  const { secondsLeft, start: startCooldown } = useOtpCooldown();
  const otpRef = useRef<OtpInputHandle | null>(null);

  const [stage, setStage] = useState<"input" | "otp">("input");
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [otpId, setOtpId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reusedActiveOtp, setReusedActiveOtp] = useState(false);

  const emailError = touched && !isEmailValid(email) ? "Ingresá un email válido" : "";
  const phoneLabel = profile ? formatPhoneDisplay(profile.phone) : "tu teléfono";

  function handleBack() {
    if (stage === "otp") {
      setStage("input");
      setCode("");
      setErrorMessage(null);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/profile/edit");
  }

  async function handleRequest() {
    setTouched(true);
    if (!isEmailValid(email)) return;
    setErrorMessage(null);
    try {
      const result = await requestChange.mutateAsync(email.trim());
      setOtpId(result.otpId);
      setReusedActiveOtp(!result.sent);
      setCode("");
      startCooldown(result.cooldownSeconds);
      setStage("otp");
    } catch (err) {
      setErrorMessage(
        friendlyErrorMessage(err, "No pudimos enviar el código. Intentá de nuevo."),
      );
    }
  }

  async function handleVerify() {
    if (!otpId || code.length < OTP_LENGTH) return;
    setErrorMessage(null);
    try {
      await verifyChange.mutateAsync({ otpId, code });
      if (router.canGoBack()) router.back();
      else router.replace("/profile/edit");
    } catch (err) {
      setCode("");
      otpRef.current?.focusFirst();
      setErrorMessage(
        friendlyErrorMessage(err, "No pudimos verificar el código. Intentá de nuevo."),
      );
      if (err instanceof ApiError && err.code === "AUTH_OTP_EXPIRED") setStage("input");
    }
  }

  async function handleResend() {
    if (secondsLeft > 0 || !otpId) return;
    setErrorMessage(null);
    try {
      const result = await authClient.resendOtp(otpId);
      setCode("");
      setReusedActiveOtp(false);
      startCooldown(result.cooldownSeconds);
      otpRef.current?.focusFirst();
    } catch (err) {
      setErrorMessage(
        friendlyErrorMessage(err, "No pudimos reenviar el código. Intentá de nuevo."),
      );
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="change-email-back"
          onPress={handleBack}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">Cambiar email</Text>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 16 : 0}
      >
        <ScrollView
          className="flex-1 px-5"
          contentContainerClassName="pb-8"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ErrorBanner testID="change-email-error" message={errorMessage} />

          {stage === "input" ? (
            <View>
              <Text className="mb-1.5 mt-2 font-sans-semibold text-title text-fg">
                Ingresá tu email nuevo
              </Text>
              <Text className="mb-4 font-sans text-body text-fg-2">
                Tu email actual es{" "}
                <Text className="font-sans-semibold text-fg">{profile?.email ?? "—"}</Text>.
              </Text>

              <View
                testID="change-email-sms-notice"
                className="mb-5 flex-row items-start gap-2 rounded-[10px] border border-info-200 bg-info-100 px-3.5 py-3"
              >
                <Info size={15} strokeWidth={2} color="#1F52D6" />
                <Text className="flex-1 font-sans text-[12px] text-ink-950">
                  Para confirmar el cambio te vamos a enviar un código por SMS a tu
                  teléfono <Text className="font-sans-semibold">{phoneLabel}</Text>, no al
                  email nuevo.
                </Text>
              </View>

              <TextField
                testID="change-email-input"
                label="Nuevo email"
                value={email}
                onChangeText={setEmail}
                onBlur={() => setTouched(true)}
                error={emailError}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
              />
            </View>
          ) : (
            <OtpStep
              ref={otpRef}
              testIDPrefix="change-email-otp"
              title="Confirmá que sos vos"
              description={
                reusedActiveOtp ? (
                  <>
                    Ya te habíamos enviado un código por SMS a tu teléfono actual,{" "}
                    <Text className="font-sans-semibold text-fg">{phoneLabel}</Text>, y
                    sigue siendo válido. Ingresalo para cambiar tu email a{" "}
                    <Text className="font-sans-semibold text-fg">{email.trim()}</Text>.
                  </>
                ) : (
                  <>
                    Te enviamos un código de 6 dígitos por SMS a tu teléfono actual,{" "}
                    <Text className="font-sans-semibold text-fg">{phoneLabel}</Text>.
                    Ingresalo para cambiar tu email a{" "}
                    <Text className="font-sans-semibold text-fg">{email.trim()}</Text>.
                  </>
                )
              }
              code={code}
              onChangeCode={setCode}
              onResend={() => void handleResend()}
              secondsLeft={secondsLeft}
              autoFocus
            />
          )}
        </ScrollView>

        {stage === "input" ? (
          <PrimaryButton
            testID="change-email-request"
            label="Enviar código"
            onPress={() => void handleRequest()}
            disabled={!isEmailValid(email)}
            loading={requestChange.isPending}
          />
        ) : (
          <PrimaryButton
            testID="change-email-verify"
            label="Confirmar cambio"
            onPress={() => void handleVerify()}
            disabled={code.length < OTP_LENGTH}
            loading={verifyChange.isPending}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
