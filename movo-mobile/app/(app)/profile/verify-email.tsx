import { ApiError } from "@movo/shared/dist/errors/api-error";
import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../../components/auth/primary-button";
import { ErrorBanner } from "../../../components/ui/error-banner";
import { OTP_LENGTH, type OtpInputHandle } from "../../../components/ui/otp-input";
import { OtpStep } from "../../../components/ui/otp-step";
import { authClient } from "../../../src/api/auth-client";
import { useOtpCooldown } from "../../../src/hooks/use-otp-cooldown";
import {
  useMyProfile,
  useRequestEmailVerification,
  useVerifyEmailVerification,
} from "../../../src/hooks/use-profile";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../src/lib/error-messages";

/**
 * Verificar el email ACTUAL de la cuenta (MOVO-139), CTA que aparece junto a la fila
 * de email en "Editar perfil" (MOVO-135) cuando `emailVerified` es `false`. A
 * diferencia de `change-email.tsx`, acá no hay ningún dato que ingresar: el target
 * del OTP es el email que la cuenta ya tiene, así que el paso 1 es directamente pedir
 * el código.
 */
export default function VerifyEmailScreen() {
  const colors = useThemeColors();
  const { data: profile } = useMyProfile();
  const requestVerification = useRequestEmailVerification();
  const verifyVerification = useVerifyEmailVerification();
  const { secondsLeft, start: startCooldown } = useOtpCooldown();
  const otpRef = useRef<OtpInputHandle | null>(null);

  const [stage, setStage] = useState<"intro" | "otp">("intro");
  const [otpId, setOtpId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reusedActiveOtp, setReusedActiveOtp] = useState(false);

  function handleDone() {
    if (router.canGoBack()) router.back();
    else router.replace("/profile/edit");
  }

  function handleBack() {
    if (stage === "otp") {
      setStage("intro");
      setCode("");
      setErrorMessage(null);
      return;
    }
    handleDone();
  }

  async function handleRequest() {
    setErrorMessage(null);
    try {
      const result = await requestVerification.mutateAsync();
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
      await verifyVerification.mutateAsync({ otpId, code });
      handleDone();
    } catch (err) {
      setCode("");
      otpRef.current?.focusFirst();
      setErrorMessage(
        friendlyErrorMessage(err, "No pudimos verificar el código. Intentá de nuevo."),
      );
      if (err instanceof ApiError && err.code === "AUTH_OTP_EXPIRED") setStage("intro");
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
          testID="verify-email-back"
          onPress={handleBack}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">Verificar email</Text>
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
          <ErrorBanner testID="verify-email-error" message={errorMessage} />

          {stage === "intro" ? (
            <View>
              <Text className="mb-1.5 mt-2 font-sans-semibold text-title text-fg">
                Confirmá que tu email es tuyo
              </Text>
              <Text className="mb-5 font-sans text-body text-fg-2">
                Te vamos a mandar un código a{" "}
                <Text className="font-sans-semibold text-fg">{profile?.email ?? "—"}</Text>.
                No hace falta que cambies nada, solo confirmar que podés recibirlo ahí.
              </Text>
            </View>
          ) : (
            <OtpStep
              ref={otpRef}
              testIDPrefix="verify-email-otp"
              title="Ingresá el código"
              description={
                reusedActiveOtp ? (
                  <>
                    Ya te habíamos enviado un código a{" "}
                    <Text className="font-sans-semibold text-fg">
                      {profile?.email ?? "tu email"}
                    </Text>{" "}
                    y sigue siendo válido. Ingresalo para verificarlo.
                  </>
                ) : (
                  <>
                    Te enviamos un código de 6 dígitos a{" "}
                    <Text className="font-sans-semibold text-fg">
                      {profile?.email ?? "tu email"}
                    </Text>
                    .
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

        {stage === "intro" ? (
          <PrimaryButton
            testID="verify-email-request"
            label="Enviar código"
            onPress={() => void handleRequest()}
            loading={requestVerification.isPending}
          />
        ) : (
          <PrimaryButton
            testID="verify-email-verify"
            label="Confirmar"
            onPress={() => void handleVerify()}
            disabled={code.length < OTP_LENGTH}
            loading={verifyVerification.isPending}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
