import { router } from "expo-router";
import {
  CircleCheck,
  ClipboardCheck,
  Eye,
  EyeOff,
  Home,
  IdCard,
  Lock,
  type LucideIcon,
  MapPin,
  MessageSquare,
  Pencil,
  UserRound,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useColorScheme } from "nativewind";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../components/auth/primary-button";
import { WizardHeader } from "../../components/auth/wizard-header";
import { ErrorBanner } from "../../components/ui/error-banner";
import { PasswordStrengthMeter } from "../../components/ui/password-strength-meter";
import { SelectField } from "../../components/ui/select-field";
import { TextField } from "../../components/ui/text-field";
import { movoMapStyleDark, movoMapStyleLight } from "../../src/constants/map-style";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  type FieldName,
  formatDni,
  formatPhone,
  formatZip,
  getFieldError,
  isStepValid,
  PROVINCES,
  useRegistration,
} from "../../src/hooks/use-registration";

/**
 * Pasos 0, 1, 2, 5 y 6 (info básica, DNI, dirección, contraseña, revisión) +
 * el paso de OTP (4) del mockup "Flujo de Registro" viven todos en este
 * wizard, en el mismo orden que el mockup — la verificación de teléfono
 * ocurre ANTES de crear la cuenta. Esto es un cambio respecto a la primera
 * versión de esta pantalla (donde el OTP era una ruta separada post-alta,
 * `verify-phone.tsx`, ya eliminada): requirió partir el contrato de backend
 * de MOVO-70 en dos llamadas nuevas sin cuenta todavía (`send-otp`,
 * `verify-otp`) más un `phoneVerificationToken` que viaja en el `register`
 * final — ver el comentario en `src/api/auth-client.ts` y en los tickets
 * MOVO-70/MOVO-72/MOVO-73 de Linear.
 *
 * Paso de mapa (3, nuevo): geocodifica la dirección del paso anterior para
 * centrar un pin que el usuario puede arrastrar y ajustar antes de
 * confirmar — mismo patrón "clásico" de apps de delivery/logística. El
 * `lat`/`long` final viaja en el `address` de `POST /auth/register`
 * (`users.address` del DER, MOVO-73).
 */

const OTP_LENGTH = 6;

// Orden de foco esperado dentro de cada paso cuando iOS/Android autocompletan
// varios campos de un tirón (Contactos / Direcciones guardadas): se usa para
// saber a qué campo saltar y cuándo ya no queda ninguno por completar en el
// paso (momento en el que se esconde el teclado).
const STEP0_FIELD_ORDER: FieldName[] = ["firstName", "lastName", "email", "phone"];
const STEP2_FIELD_ORDER: FieldName[] = ["street", "number", "floor", "city", "zip"];

const STEP_LABELS = ["Paso 1", "Paso 2", "Paso 3", "Paso 4", "Paso 5", "Paso 6", "Paso 7"];

// Córdoba Capital, Argentina — fallback si `geocodeAddress` todavía no resolvió el
// pin cuando se arma el mapa (no debería pasar salvo por una carrera de renders).
const FALLBACK_REGION: Region = { latitude: -31.4201, longitude: -64.1888, latitudeDelta: 0.01, longitudeDelta: 0.01 };

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export default function RegisterScreen() {
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
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
    latitude,
    longitude,
    confirmLocation,
  } = registration;
  const [step, setStep] = useState<Step>(0);
  const [showPassword, setShowPassword] = useState(false);
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [otpSecondsLeft, setOtpSecondsLeft] = useState(0);
  const otpInputRefs = useRef<Array<TextInput | null>>([]);

  const fieldRefs = useRef<Partial<Record<FieldName, TextInput | null>>>({});
  const activeFieldRef = useRef<FieldName | null>(null);
  const autofillIndexRef = useRef(-1);
  const autofillDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (otpSecondsLeft <= 0) return;
    const timer = setInterval(() => setOtpSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [otpSecondsLeft]);

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
  function goToStep(next: Step) {
    clearErrorBanner();
    setStep(next);
  }

  function goBack() {
    if (step === 0) {
      router.back();
      return;
    }
    // Simétrico al salto hacia adelante en goNext (step 3): si el teléfono ya está
    // verificado, el paso de OTP (4) queda fuera de la navegación en ambos sentidos.
    if (step === 5 && registration.phoneVerificationToken) {
      goToStep(3);
      return;
    }
    goToStep((step - 1) as Step);
  }

  function onOtpDigitChange(index: number, value: string) {
    const digits = value.replace(/\D/g, "");

    // El autocompletado de SMS en iOS puede entregar el código completo
    // (no un solo dígito) al campo que tenía el foco antes de que
    // `maxLength` lo trunque — se distribuye entre las casillas restantes
    // en vez de asumir que `value` es siempre un único carácter.
    if (digits.length > 1) {
      setOtpDigits((prev) => {
        const next = [...prev];
        for (let i = 0; i < digits.length && index + i < OTP_LENGTH; i++) {
          next[index + i] = digits[i];
        }
        return next;
      });
      const lastFilled = Math.min(index + digits.length, OTP_LENGTH) - 1;
      otpInputRefs.current[lastFilled]?.focus();
      if (lastFilled === OTP_LENGTH - 1) Keyboard.dismiss();
      return;
    }

    const digit = digits.slice(-1);
    setOtpDigits((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (digit && index < OTP_LENGTH - 1) {
      otpInputRefs.current[index + 1]?.focus();
    } else if (digit && index === OTP_LENGTH - 1) {
      Keyboard.dismiss();
    }
  }

  function onOtpKeyPress(index: number, key: string) {
    if (key === "Backspace" && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  }

  async function handleResendOtp() {
    if (otpSecondsLeft > 0 || loading) return;
    const result = await registration.resendOtp();
    if (!result.ok) return;
    setOtpDigits(Array(OTP_LENGTH).fill(""));
    setOtpSecondsLeft(result.cooldownSeconds);
    otpInputRefs.current[0]?.focus();
  }

  async function goNext() {
    if (step === 0) {
      touchAll(["firstName", "lastName", "email", "phone"]);
      if (!isStepValid(0, fields)) return;
      goToStep(1);
    } else if (step === 1) {
      touchAll(["dni"]);
      if (!isStepValid(1, fields)) return;
      goToStep(2);
    } else if (step === 2) {
      touchAll(["street", "number", "city", "province", "zip"]);
      if (!isStepValid(2, fields)) return;
      const result = await registration.geocodeAddress();
      if (!result.ok) return;
      goToStep(3);
    } else if (step === 3) {
      if (latitude === null || longitude === null) return;
      // El teléfono ya está verificado para el número actual (no cambió desde la
      // última vez) — reenviar un OTP acá sería gastar un SMS de más y hacerle pisar
      // el paso al usuario de nuevo sin necesidad.
      if (registration.phoneVerificationToken) {
        goToStep(5);
        return;
      }
      const result = await registration.sendOtp();
      if (!result.ok) return;
      setOtpDigits(Array(OTP_LENGTH).fill(""));
      setOtpSecondsLeft(result.cooldownSeconds);
      goToStep(4);
    } else if (step === 4) {
      const code = otpDigits.join("");
      if (code.length < OTP_LENGTH) return;
      const result = await registration.verifyPhoneOtp(code);
      if (!result.ok) return;
      goToStep(5);
    } else if (step === 5) {
      touchAll(["password", "passwordConfirm"]);
      if (!isStepValid(3, fields)) return;
      goToStep(6);
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
        progress={(step + 1) / 7}
        stepLabel={STEP_LABELS[step]}
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
              Es rápido. Después vas a verificar tu identidad para poder enviar
              y llevar paquetes.
            </Text>

            <View className="flex-row gap-2.5">
              <TextField
                testID="register-first-name"
                ref={bindFieldRef("firstName")}
                containerClassName="mb-3.5 flex-1 gap-1.5"
                label="Nombre"
                placeholder="Julia"
                autoComplete="given-name"
                textContentType="givenName"
                autoCapitalize="words"
                returnKeyType="next"
                value={fields.firstName}
                onFocus={() => onFieldFocus("firstName")}
                onChangeText={(v) => {
                  setField("firstName", v);
                  onFieldAutofillCheck("firstName", STEP0_FIELD_ORDER);
                }}
                onBlur={() => touch("firstName")}
                error={err("firstName")}
              />
              <TextField
                testID="register-last-name"
                ref={bindFieldRef("lastName")}
                containerClassName="mb-3.5 flex-1 gap-1.5"
                label="Apellido"
                placeholder="Pérez"
                autoComplete="family-name"
                textContentType="familyName"
                autoCapitalize="words"
                returnKeyType="next"
                value={fields.lastName}
                onFocus={() => onFieldFocus("lastName")}
                onChangeText={(v) => {
                  setField("lastName", v);
                  onFieldAutofillCheck("lastName", STEP0_FIELD_ORDER);
                }}
                onBlur={() => touch("lastName")}
                error={err("lastName")}
              />
            </View>

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
          <View>
            <StepIcon icon={IdCard} />
            <Text className="mb-1.5 font-sans-semibold text-title text-fg">
              Tu DNI
            </Text>
            <Text className="mb-5 font-sans text-body text-fg-2">
              Documento Nacional de Identidad. Lo vamos a confirmar más adelante
              para asegurarnos de que sos vos. Esto ayuda a que Movo sea la red
              de logística mas segura de Argentina 🚀
            </Text>
            <TextField
              testID="register-dni"
              label="Número de DNI"
              placeholder="12.345.678"
              keyboardType="numeric"
              returnKeyType="done"
              maxLength={10}
              value={fields.dni}
              onChangeText={(v) => setField("dni", formatDni(v))}
              onBlur={() => touch("dni")}
              error={err("dni")}
            />
          </View>
        )}

        {step === 2 && (
          <View>
            <StepIcon icon={Home} />
            <Text className="mb-1.5 font-sans-semibold text-title text-fg">
              Dirección de tu casa
            </Text>
            <Text className="mb-5 font-sans text-body text-fg-2">
              Registrá la dirección de tu casa. Es el punto de partida de tus
              envíos.
            </Text>
            <TextField
              testID="register-street"
              ref={bindFieldRef("street")}
              label="Calle"
              placeholder="Av. Corrientes"
              autoComplete="street-address"
              textContentType="streetAddressLine1"
              autoCapitalize="words"
              returnKeyType="next"
              value={fields.street}
              onFocus={() => onFieldFocus("street")}
              onChangeText={(v) => {
                setField("street", v);
                onFieldAutofillCheck("street", STEP2_FIELD_ORDER);
              }}
              onBlur={() => touch("street")}
              error={err("street")}
            />
            <View className="flex-row gap-2.5">
              <TextField
                testID="register-number"
                ref={bindFieldRef("number")}
                containerClassName="mb-3.5 flex-1 gap-1.5"
                label="Número"
                placeholder="1234"
                keyboardType="numeric"
                returnKeyType="next"
                value={fields.number}
                onFocus={() => onFieldFocus("number")}
                onChangeText={(v) => {
                  setField("number", v);
                  onFieldAutofillCheck("number", STEP2_FIELD_ORDER);
                }}
                onBlur={() => touch("number")}
                error={err("number")}
              />
              <TextField
                testID="register-floor"
                ref={bindFieldRef("floor")}
                containerClassName="mb-3.5 flex-1 gap-1.5"
                label="Piso / Depto"
                placeholder="3B (opcional)"
                textContentType="streetAddressLine2"
                returnKeyType="next"
                value={fields.floor}
                onFocus={() => onFieldFocus("floor")}
                onChangeText={(v) => {
                  setField("floor", v);
                  onFieldAutofillCheck("floor", STEP2_FIELD_ORDER);
                }}
              />
            </View>
            <View className="flex-row gap-2.5">
              <TextField
                testID="register-city"
                ref={bindFieldRef("city")}
                containerClassName="mb-3.5 flex-1 gap-1.5"
                label="Ciudad"
                placeholder="CABA"
                autoComplete="address-line1"
                textContentType="addressCity"
                autoCapitalize="words"
                returnKeyType="next"
                value={fields.city}
                onFocus={() => onFieldFocus("city")}
                onChangeText={(v) => {
                  setField("city", v);
                  onFieldAutofillCheck("city", STEP2_FIELD_ORDER);
                }}
                onBlur={() => touch("city")}
                error={err("city")}
              />
              <TextField
                testID="register-zip"
                ref={bindFieldRef("zip")}
                containerClassName="mb-3.5 w-[110px] gap-1.5"
                label="CP"
                placeholder="1425"
                keyboardType="numeric"
                autoComplete="postal-code"
                textContentType="postalCode"
                returnKeyType="done"
                maxLength={12}
                value={fields.zip}
                onFocus={() => onFieldFocus("zip")}
                onChangeText={(v) => {
                  setField("zip", formatZip(v));
                  onFieldAutofillCheck("zip", STEP2_FIELD_ORDER);
                }}
                onBlur={() => touch("zip")}
                error={err("zip")}
              />
            </View>
            <SelectField
              testID="register-province"
              containerClassName="mb-3.5 gap-1.5"
              label="Provincia"
              placeholder="Seleccioná tu provincia"
              options={PROVINCES}
              value={fields.province}
              onChange={(p) => {
                setField("province", p);
                touch("province");
              }}
              error={touched.province ? err("province") : undefined}
            />
          </View>
        )}

        {step === 3 && (
          <View>
            <StepIcon icon={MapPin} />
            <Text className="mb-1.5 font-sans-semibold text-title text-fg">
              Confirmá tu ubicación
            </Text>
            <Text className="mb-5 font-sans text-body text-fg-2">
              Arrastrá el pin hasta el punto exacto de tu dirección.
            </Text>
            <View className="relative h-80 overflow-hidden rounded-[10px]">
              <MapView
                testID="register-map"
                provider={PROVIDER_GOOGLE}
                customMapStyle={colorScheme === "dark" ? movoMapStyleDark : movoMapStyleLight}
                style={{ flex: 1 }}
                initialRegion={
                  latitude !== null && longitude !== null
                    ? { latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }
                    : FALLBACK_REGION
                }
              >
                {latitude !== null && longitude !== null && (
                  <Marker
                    testID="register-map-marker"
                    coordinate={{ latitude, longitude }}
                    draggable
                    anchor={{ x: 0.5, y: 1 }}
                    onDragEnd={(e) => {
                      const { latitude: lat, longitude: long } = e.nativeEvent.coordinate;
                      confirmLocation(lat, long);
                    }}
                  >
                    <View
                      style={{
                        paddingTop: 12,
                        paddingHorizontal: 12,
                        shadowColor: "#000",
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.3,
                        shadowRadius: 3,
                        elevation: 4,
                      }}
                    >
                      <MapPin size={52} strokeWidth={1.5} color="#1A1A1D" fill="#C6F24A" />
                    </View>
                  </Marker>
                )}
              </MapView>
              <View
                pointerEvents="none"
                className="absolute inset-0 rounded-[10px] border border-border"
              />
            </View>
            <Text className="mt-2.5 font-sans text-[12px] text-fg-3">
              {latitude !== null && longitude !== null
                ? `Lat ${latitude.toFixed(5)}, Long ${longitude.toFixed(5)}`
                : "Ubicando tu dirección…"}
            </Text>
          </View>
        )}

        {step === 4 && (
          <View>
            <StepIcon icon={MessageSquare} />
            <Text className="mb-1.5 font-sans-semibold text-title text-fg">
              Verificá tu teléfono
            </Text>
            <Text className="mb-5 font-sans text-body text-fg-2">
              Te enviamos un código de 6 dígitos por SMS al{" "}
              <Text className="font-sans-semibold text-fg">+54 {fields.phone}</Text>.
            </Text>

            <Text className="mb-1.5 font-sans-medium text-[12px] text-fg-2">
              Código de verificación
            </Text>
            <View className="flex-row gap-2">
              {otpDigits.map((digit, index) => (
                <TextInput
                  key={index}
                  testID={`register-otp-input-${index}`}
                  ref={(el) => {
                    otpInputRefs.current[index] = el;
                  }}
                  value={digit}
                  onChangeText={(v) => onOtpDigitChange(index, v)}
                  onKeyPress={({ nativeEvent }) => onOtpKeyPress(index, nativeEvent.key)}
                  keyboardType="number-pad"
                  autoComplete={index === 0 ? "sms-otp" : "off"}
                  textContentType="oneTimeCode"
                  returnKeyType="done"
                  className="h-14 flex-1 rounded-lg border border-border-strong text-center font-sans-semibold text-[22px] text-fg"
                />
              ))}
            </View>

            <View className="mt-5 flex-row items-center justify-between">
              {otpSecondsLeft <= 0 ? (
                <Text
                  testID="register-otp-resend"
                  onPress={handleResendOtp}
                  className="font-sans-semibold text-[13px] text-fg underline"
                >
                  Reenviar código
                </Text>
              ) : (
                <Text testID="register-otp-resend-cooldown" className="font-sans text-[13px] text-fg-3">
                  Reenviar código en 00:{String(otpSecondsLeft).padStart(2, "0")}
                </Text>
              )}
            </View>
          </View>
        )}

        {step === 5 && (
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

        {step === 6 && (
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
                label="Nombre"
                value={`${fields.firstName} ${fields.lastName}`.trim()}
                onEdit={() => goToStep(0)}
              />
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
              />
              <ReviewRow
                label="DNI"
                value={fields.dni}
                onEdit={() => goToStep(1)}
              />
              <ReviewRow
                label="Dirección"
                value={[
                  `${fields.street} ${fields.number}`.trim(),
                  fields.floor,
                  fields.city,
                  fields.province,
                  fields.zip,
                ]
                  .filter(Boolean)
                  .join(", ")}
                onEdit={() => goToStep(2)}
                last
              />
            </View>
            <Text className="font-sans text-[11px] text-fg-3">
              Al crear tu cuenta en Movo aceptás los{" "}
              <Text
                testID="register-terms-link"
                onPress={() => Linking.openURL("https://movosend.app/tyc")}
                className="text-fg underline"
              >
                Términos
              </Text>{" "}
              y la{" "}
              <Text
                testID="register-privacy-link"
                onPress={() => Linking.openURL("https://movosend.app/privacy")}
                className="text-fg underline"
              >
                Política de Privacidad
              </Text>
              .
            </Text>
          </View>
        )}

        <View className="h-6" />
      </ScrollView>
      </KeyboardAvoidingView>

      <PrimaryButton
        testID="register-primary-action"
        label={
          step === 6
            ? loading
              ? "Creando cuenta…"
              : "Crear cuenta"
            : "Continuar"
        }
        onPress={goNext}
        loading={loading}
        disabled={
          loading ||
          (step === 3 && (latitude === null || longitude === null)) ||
          (step === 4 && otpDigits.some((d) => !d))
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
