import { router } from "expo-router";
import {
  Check,
  CircleCheck,
  ClipboardCheck,
  Eye,
  EyeOff,
  Lock,
  type LucideIcon,
  Pencil,
  UserRound,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../components/auth/primary-button";
import { WizardHeader } from "../../components/auth/wizard-header";
import { ErrorBanner } from "../../components/ui/error-banner";
import { OTP_LENGTH, type OtpInputHandle } from "../../components/ui/otp-input";
import { OtpStep } from "../../components/ui/otp-step";
import { PasswordStrengthMeter } from "../../components/ui/password-strength-meter";
import { TextField } from "../../components/ui/text-field";
import { useOtpCooldown } from "../../src/hooks/use-otp-cooldown";
import { type RegisterStep, registerStepProgress } from "../../src/lib/register-steps";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  type FieldName,
  formatPhone,
  getFieldError,
  isStepValid,
  useRegistration,
} from "../../src/hooks/use-registration";

/**
 * Asistente de registro de 4 pasos: 0 email y teléfono, 1 código SMS, 2 contraseña, 3 revisión.
 *
 * La verificación del teléfono ocurre ANTES de crear la cuenta: `send-otp` y `verify-otp` no
 * necesitan cuenta, y el `phoneVerificationToken` que devuelven viaja en el `register` final.
 *
 * No se pide nombre, DNI ni dirección. El nombre legal y el DNI los completa Didit al aprobar la
 * verificación de identidad (`/kyc`), y la dirección se carga después desde la libreta.
 */

// Orden de foco esperado dentro del paso 0 cuando iOS/Android autocompletan varios campos de un
// tirón (Contactos): se usa para saber a qué campo saltar y cuándo ya no queda ninguno por
// completar en el paso (momento en el que se esconde el teclado).
const STEP0_FIELD_ORDER: FieldName[] = ["email", "phone"];

type Step = RegisterStep;

export default function RegisterScreen() {
  const colors = useThemeColors();
  const registration = useRegistration();
  const {
    fields,
    touched,
    setField,
    touch,
    touchAll,
    errorBanner,
    clearErrorBanner,
    loading,
    acceptedLegal,
    setAcceptedLegal,
  } = registration;
  const [step, setStep] = useState<Step>(0);
  // true cuando el paso del código se salteó porque el teléfono ya estaba verificado. Solo vale
  // mientras el token siga vigente: si el usuario cambia el teléfono, el código vuelve a contar.
  const [otpSkippedFlag, setOtpSkipped] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const { secondsLeft: otpSecondsLeft, start: startOtpCooldown } = useOtpCooldown();
  const otpInputRef = useRef<OtpInputHandle | null>(null);

  const fieldRefs = useRef<Partial<Record<FieldName, TextInput | null>>>({});
  const activeFieldRef = useRef<FieldName | null>(null);
  const autofillIndexRef = useRef(-1);
  const autofillDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Cada paso arranca su propio seguimiento de autocompletado.
    autofillIndexRef.current = -1;
    if (autofillDismissTimer.current) clearTimeout(autofillDismissTimer.current);
  }, [step]);

  function bindFieldRef(name: FieldName) {
    return (el: TextInput | null) => {
      fieldRefs.current[name] = el;
    };
  }

  function onFieldFocus(name: FieldName) {
    activeFieldRef.current = name;
  }

  /**
   * Se llama en cada `onChangeText`. Si el campo que cambió no es el que
   * tiene el foco (el usuario no lo está tipeando), asumimos que lo acaba
   * de llenar el autocompletado del sistema — le movemos el foco para
   * seguir el orden del formulario, y si era el último campo del paso,
   * escondemos el teclado. `autofillIndexRef` evita retroceder si los
   * eventos de autocompletado llegan fuera de orden.
   */
  function onFieldAutofillCheck(name: FieldName, group: readonly FieldName[]) {
    if (activeFieldRef.current === name) return;
    const idx = group.indexOf(name);
    if (idx < 0 || idx <= autofillIndexRef.current) return;
    autofillIndexRef.current = idx;
    activeFieldRef.current = name;
    fieldRefs.current[name]?.focus();
    if (autofillDismissTimer.current) clearTimeout(autofillDismissTimer.current);
    autofillDismissTimer.current = setTimeout(() => {
      if (idx === group.length - 1) Keyboard.dismiss();
    }, 80);
  }

  // Todo cambio de paso pasa por acá: un error de un paso anterior no debe
  // seguir mostrándose una vez que el usuario avanzó o volvió a otro paso.
  const otpSkipped = otpSkippedFlag && Boolean(registration.phoneVerificationToken);
  const progress = registerStepProgress(step, otpSkipped);

  function goToStep(next: Step) {
    clearErrorBanner();
    setStep(next);
  }

  function goBack() {
    if (step === 0) {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/");
      }
      return;
    }
    // Simétrico al salto hacia adelante en goNext (paso 0): si el teléfono ya está verificado,
    // el paso del código (1) queda fuera de la navegación en ambos sentidos.
    if (step === 2 && registration.phoneVerificationToken) {
      setOtpSkipped(true);
      goToStep(0);
      return;
    }
    goToStep((step - 1) as Step);
  }

  async function handleResendOtp() {
    if (otpSecondsLeft > 0 || loading) return;
    const result = await registration.resendOtp();
    if (!result.ok) return;
    setOtpCode("");
    startOtpCooldown(result.cooldownSeconds);
    otpInputRef.current?.focusFirst();
  }

  async function goNext() {
    if (step === 0) {
      touchAll(["email", "phone"]);
      if (!isStepValid(0, fields)) return;
      // El teléfono ya está verificado para el número actual (no cambió desde la última vez):
      // reenviar un código sería gastar un SMS de más y hacerle pisar el paso al usuario de nuevo.
      if (registration.phoneVerificationToken) {
        setOtpSkipped(true);
        goToStep(2);
        return;
      }
      const result = await registration.sendOtp();
      if (!result.ok) return;
      setOtpCode("");
      startOtpCooldown(result.cooldownSeconds);
      setOtpSkipped(false);
      goToStep(1);
    } else if (step === 1) {
      if (otpCode.length < OTP_LENGTH) return;
      const result = await registration.verifyPhoneOtp(otpCode);
      if (!result.ok) return;
      goToStep(2);
    } else if (step === 2) {
      touchAll(["password", "passwordConfirm"]);
      if (!isStepValid(1, fields)) return;
      goToStep(3);
    } else {
      const result = await registration.submitRegistration();
      if (result.ok) {
        router.replace("/kyc");
      }
    }
  }

  const err = (name: Parameters<typeof getFieldError>[0]) =>
    touched[name] ? getFieldError(name, fields) : "";

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <WizardHeader
        progress={progress.fraction}
        stepLabel={progress.label}
        onBack={goBack}
        testID="register-back"
      />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 16 : 0}
      >
      <ScrollView
        className="flex-1 px-6"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <ErrorBanner testID="register-error-banner" message={errorBanner} />

        {step === 0 && (
          <View>
            <StepIcon icon={UserRound} />
            <Text className="mb-1.5 font-sans-semibold text-title text-fg">
              Creá tu cuenta
            </Text>
            <Text className="mb-5 font-sans text-body text-fg-2">
              Es rápido. Después vas a verificar tu identidad con tu DNI para
              poder enviar y llevar paquetes: de ahí tomamos tu nombre.
            </Text>

            <TextField
              testID="register-email"
              ref={bindFieldRef("email")}
              label="Email"
              placeholder="julia@mail.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              value={fields.email}
              onFocus={() => onFieldFocus("email")}
              onChangeText={(v) => {
                setField("email", v);
                onFieldAutofillCheck("email", STEP0_FIELD_ORDER);
              }}
              onBlur={() => touch("email")}
              error={err("email")}
            />

            <TextField
              testID="register-phone"
              ref={bindFieldRef("phone")}
              label="Teléfono"
              placeholder="351 234 5678"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              returnKeyType="done"
              maxLength={24}
              value={fields.phone}
              onFocus={() => onFieldFocus("phone")}
              onChangeText={(v) => {
                setField("phone", formatPhone(v));
                onFieldAutofillCheck("phone", STEP0_FIELD_ORDER);
              }}
              onBlur={() => touch("phone")}
              error={err("phone")}
              leftElement={
                <View className="flex-row items-center gap-1.5">
                  <Text className="text-[16px]">🇦🇷</Text>
                  <Text className="font-sans text-body text-fg">+54</Text>
                </View>
              }
            />
          </View>
        )}

        {step === 1 && (
          <OtpStep
            ref={otpInputRef}
            testIDPrefix="register-otp"
            title="Verificá tu teléfono"
            description={
              <>
                Te enviamos un código de 6 dígitos por SMS al{" "}
                <Text className="font-sans-semibold text-fg">+54 {fields.phone}</Text>.
              </>
            }
            code={otpCode}
            onChangeCode={setOtpCode}
            onResend={handleResendOtp}
            secondsLeft={otpSecondsLeft}
          />
        )}

        {step === 2 && (
          <View>
            <StepIcon icon={Lock} />
            <Text className="mb-1.5 font-sans-semibold text-title text-fg">
              Creá tu contraseña
            </Text>
            <Text className="mb-5 font-sans text-body text-fg-2">
              Vas a usarla para volver a iniciar sesión en Movo.
            </Text>
            <TextField
              testID="register-password"
              label="Contraseña"
              placeholder="Mínimo 8 caracteres"
              secureTextEntry={!showPassword}
              autoComplete="new-password"
              textContentType="newPassword"
              passwordRules="minlength: 8; required: lower; required: digit;"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              value={fields.password}
              onChangeText={(v) => setField("password", v)}
              onBlur={() => touch("password")}
              error={err("password")}
              rightElement={
                <Pressable
                  testID="register-password-toggle"
                  onPress={() => setShowPassword((s) => !s)}
                  hitSlop={8}
                  className="h-7 w-7 items-center justify-center"
                >
                  {showPassword ? (
                    <EyeOff size={18} color={colors.fg2} strokeWidth={1.8} />
                  ) : (
                    <Eye size={18} color={colors.fg2} strokeWidth={1.8} />
                  )}
                </Pressable>
              }
            />
            <PasswordStrengthMeter
              testID="register-password-strength"
              password={fields.password}
            />
            <TextField
              testID="register-password-confirm"
              label="Repetir contraseña"
              placeholder="Volvé a escribirla"
              secureTextEntry={!showPassword}
              autoComplete="new-password"
              textContentType="newPassword"
              passwordRules="minlength: 8; required: lower; required: digit;"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              value={fields.passwordConfirm}
              onChangeText={(v) => setField("passwordConfirm", v)}
              onBlur={() => touch("passwordConfirm")}
              error={err("passwordConfirm")}
            />
          </View>
        )}

        {step === 3 && (
          <View>
            <StepIcon icon={ClipboardCheck} />
            <Text className="mb-1.5 font-sans-semibold text-title text-fg">
              Revisá y confirmá
            </Text>
            <Text className="mb-5 font-sans text-body text-fg-2">
              Fijate que esté todo bien antes de crear tu cuenta.
            </Text>
            <View className="mb-5 overflow-hidden rounded-[10px] border border-border">
              <ReviewRow
                label="Email"
                value={fields.email}
                onEdit={() => goToStep(0)}
              />
              <ReviewRow
                label="Teléfono"
                value={`+54 ${fields.phone}`}
                badge={registration.phoneVerifiedAt ? "Verificado" : undefined}
                onEdit={() => goToStep(0)}
                last
              />
            </View>
            <Pressable
              testID="register-accept-legal"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acceptedLegal }}
              onPress={() => setAcceptedLegal(!acceptedLegal)}
              className="flex-row items-start gap-3 rounded-[10px] border border-border bg-bg-sub px-3.5 py-3"
            >
              <View
                className={`mt-0.5 h-5 w-5 items-center justify-center rounded border ${
                  acceptedLegal ? "border-lime-500 bg-lime-500" : "border-border bg-bg"
                }`}
              >
                {acceptedLegal ? <Check size={13} color="#0A0A0B" strokeWidth={3} /> : null}
              </View>
              <Text className="flex-1 font-sans text-[12px] leading-4 text-fg-3">
                Leí y acepto los{" "}
                <Text
                  testID="register-terms-link"
                  onPress={() => router.push("/legal-terms" as any)}
                  className="text-fg underline"
                >
                  Términos y Condiciones
                </Text>{" "}
                y la{" "}
                <Text
                  testID="register-privacy-link"
                  onPress={() => router.push("/legal-privacy" as any)}
                  className="text-fg underline"
                >
                  Política de Privacidad
                </Text>{" "}
                de Movo.
              </Text>
            </Pressable>
          </View>
        )}

        <View className="h-6" />
      </ScrollView>
      </KeyboardAvoidingView>

      <PrimaryButton
        testID="register-primary-action"
        label={
          step === 3
            ? loading
              ? "Creando cuenta…"
              : "Crear cuenta"
            : "Continuar"
        }
        onPress={goNext}
        loading={loading}
        disabled={
          loading ||
          (step === 1 && otpCode.length < OTP_LENGTH) ||
          (step === 3 && !acceptedLegal)
        }
      />
    </SafeAreaView>
  );
}

function ReviewRow({
  label,
  value,
  badge,
  onEdit,
  last,
}: {
  label: string;
  value: string;
  badge?: string;
  onEdit: () => void;
  last?: boolean;
}) {
  const colors = useThemeColors();

  return (
    <View
      className={`flex-row items-center justify-between gap-2.5 px-4 py-3.5 ${
        last ? "" : "border-b border-border"
      }`}
    >
      <View className="flex-1">
        <Text className="mb-0.5 font-sans text-[11px] text-fg-3">{label}</Text>
        <View className="flex-row items-center gap-1.5">
          <Text className="font-sans-medium text-[14px] text-fg">{value || "—"}</Text>
          {badge ? (
            <View className="flex-row items-center gap-1">
              <CircleCheck size={14} color="#2BB673" strokeWidth={2} fill="none" />
              <Text className="font-sans-semibold text-[12px] text-success-500">{badge}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <Pressable
        testID={`review-edit-${label}`}
        onPress={onEdit}
        hitSlop={8}
        className="h-7 w-7 items-center justify-center"
      >
        <Pencil size={16} color={colors.fg2} strokeWidth={1.8} />
      </Pressable>
    </View>
  );
}

function StepIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <View className="mt-2 mb-4 h-14 w-14 items-center justify-center rounded-[14px] bg-lime-200">
      <Icon size={26} color="#0A0A0B" strokeWidth={1.8} />
    </View>
  );
}
