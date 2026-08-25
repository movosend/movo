import { ApiError } from "@movo/shared/dist/errors/api-error";
import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
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
  useRequestPhoneChange,
  useVerifyPhoneChange,
} from "../../../src/hooks/use-profile";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { formatPhone, isPhoneValid, toE164Phone } from "../../../src/hooks/use-registration";
import { friendlyErrorMessage } from "../../../src/lib/error-messages";

/**
 * Cambio verificado de teléfono (MOVO-135 AC4/AC6/AC7, backend MOVO-133).
 *
 * Dos pasos en una sola ruta: ingresar el número nuevo y verificar el código. El OTP
 * viaja al número **nuevo** — verificarlo es la prueba de posesión, y por eso el
 * backend persiste el teléfono recién en el paso 2. Sin completarlo, nada cambia.
 *
 * El reenvío reusa `POST /auth/resend-otp` (`authClient.resendOtp`), que es la misma
 * ruta pública que usa el registro: el `otpId` alcanza para identificar el flujo.
 */
export default function ChangePhoneScreen() {
  const colors = useThemeColors();
  const { data: profile } = useMyProfile();
  const requestChange = useRequestPhoneChange();
  const verifyChange = useVerifyPhoneChange();
  const { secondsLeft, start: startCooldown } = useOtpCooldown();
  const otpRef = useRef<OtpInputHandle | null>(null);

  const [stage, setStage] = useState<"input" | "otp">("input");
  const [phone, setPhone] = useState("");
  const [touched, setTouched] = useState(false);
  const [otpId, setOtpId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reusedActiveOtp, setReusedActiveOtp] = useState(false);

  const phoneError = touched && !isPhoneValid(phone) ? "Ingresá un celular válido de 10 dígitos" : "";

  function handleBack() {
    if (stage === "otp") {
      // Volver al paso 1 en vez de salir: el usuario puede haberse equivocado de
      // número y no tiene por qué perder la pantalla entera para corregirlo.
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
    if (!isPhoneValid(phone)) return;
    setErrorMessage(null);
    try {
      const result = await requestChange.mutateAsync(toE164Phone(phone));
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
      handleDone();
    } catch (err) {
      // Un código vencido (422) obliga a pedir uno nuevo; uno incorrecto (401) se
      // puede reintentar tipeando de nuevo. `friendlyErrorMessage` ya distingue los
      // dos textos, acá solo se limpia el input para que se note que hay que
      // reescribirlo.
      setCode("");
      otpRef.current?.focusFirst();
      setErrorMessage(
        friendlyErrorMessage(err, "No pudimos verificar el código. Intentá de nuevo."),
      );
      if (err instanceof ApiError && err.code === "AUTH_OTP_EXPIRED") setStage("input");
    }
  }

  function handleDone() {
    if (router.canGoBack()) router.back();
    else router.replace("/profile/edit");
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
          testID="change-phone-back"
          onPress={handleBack}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">Cambiar teléfono</Text>
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
          <ErrorBanner testID="change-phone-error" message={errorMessage} />

          {stage === "input" ? (
            <View>
              <Text className="mb-1.5 mt-2 font-sans-semibold text-title text-fg">
                Ingresá tu teléfono nuevo
              </Text>
              <Text className="mb-5 font-sans text-body text-fg-2">
                Te vamos a mandar un código por SMS a ese número para confirmar que es
                tuyo. Tu teléfono actual es{" "}
                <Text className="font-sans-semibold text-fg">
                  {profile ? formatPhone(profile.phone.replace(/^\+549/, "")) : "—"}
                </Text>
                .
              </Text>
              <TextField
                testID="change-phone-input"
                label="Nuevo teléfono"
                value={phone}
                onChangeText={(v) => setPhone(formatPhone(v))}
                onBlur={() => setTouched(true)}
                error={phoneError}
                keyboardType="phone-pad"
                autoComplete="tel"
                leftElement={
                  <Text className="font-sans text-[15px] text-fg-2">🇦🇷 +54</Text>
                }
              />
            </View>
          ) : (
            <OtpStep
              ref={otpRef}
              testIDPrefix="change-phone-otp"
              title="Verificá tu teléfono nuevo"
              description={
                reusedActiveOtp ? (
                  <>
                    Ya te habíamos enviado un código al{" "}
                    <Text className="font-sans-semibold text-fg">+54 {phone}</Text> y
                    sigue siendo válido. Ingresalo para confirmar el cambio.
                  </>
                ) : (
                  <>
                    Te enviamos un código de 6 dígitos por SMS al{" "}
                    <Text className="font-sans-semibold text-fg">+54 {phone}</Text>.
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
            testID="change-phone-request"
            label="Enviar código"
            onPress={() => void handleRequest()}
            disabled={!isPhoneValid(phone)}
            loading={requestChange.isPending}
          />
        ) : (
          <PrimaryButton
            testID="change-phone-verify"
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
