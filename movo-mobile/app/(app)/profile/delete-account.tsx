import { ApiError } from "@movo/shared/dist/errors/api-error";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { AlertTriangle, Check, ChevronLeft, Eye, EyeOff } from "lucide-react-native";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ErrorBanner } from "../../../components/ui/error-banner";
import { TextField } from "../../../components/ui/text-field";
import { useDeleteAccount } from "../../../src/hooks/use-account-security";
import { useKeyboardScroll } from "../../../src/hooks/use-keyboard-scroll";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../src/lib/error-messages";

const CONSEQUENCES = [
  "Es definitivo: no vamos a poder recuperar tu cuenta ni tus datos después.",
  "Borramos tus datos personales, tu foto, tus direcciones guardadas y tu verificación de identidad.",
  "El historial de los envíos en los que participaste se conserva de forma anónima, sin tu nombre ni tus datos de contacto.",
  "Vas a poder volver a registrarte más adelante con el mismo teléfono y email, pero como una cuenta nueva y desde cero.",
];

/**
 * Baja de cuenta (MOVO-136 AC5/AC6, backend MOVO-134 — absorbe la parte mobile de
 * MOVO-39, derecho de supresión). Ruta propia, hermana de `change-password.tsx`, a la
 * que se llega desde el hub `profile/security.tsx`.
 *
 * Decisiones que no se leen en el JSX:
 *
 * - **Tres barreras antes de que se borre algo** (AC5: "no se puede disparar de un
 *   solo tap"): entrar a esta ruta desde el hub, marcar el reconocimiento explícito +
 *   escribir la contraseña, y confirmar en un `Alert` nativo con el botón destructivo.
 *   El `Alert` es el último paso y no el único a propósito: es el patrón que la
 *   plataforma ya enseñó a leer como "esto no tiene vuelta atrás", pero un diálogo
 *   solo no alcanza para una acción irreversible con consecuencias que hay que
 *   explicar antes.
 * - **Las consecuencias se enumeran antes de pedir la contraseña**, no en el `Alert`:
 *   un diálogo nativo no es lugar para cuatro párrafos, y enterarte de lo que perdés
 *   después de haber escrito la contraseña no es consentimiento informado.
 * - **Los dos 409 del backend no son "error, reintentá"**: el backend no cancela en
 *   cascada a propósito, así que son estados que el usuario tiene que resolver. El de
 *   envíos activos ofrece "Ver mis envíos" accionable — el usuario no tiene por qué
 *   adivinar dónde cancelarlos; el de disputas no, porque no hay nada que pueda hacer
 *   ahí más que esperar a un administrador.
 * - **El 401 se ancla bajo el campo de contraseña** (mismo criterio que
 *   `change-password.tsx`): es un error de campo, no de pantalla, y el foco vuelve
 *   ahí. El interceptor de `http-client.ts` solo refresca ante `AUTH_TOKEN_EXPIRED`,
 *   así que este 401 no puede ser una sesión vencida.
 * - **No hay pantalla de éxito.** Al resolver, `deleteAccountAndClearSession()` limpia
 *   la caché y la sesión, y el guard de `app/(app)/_layout.tsx` redirige solo a
 *   `/login`. Renderizar una confirmación acá sería pintar un frame de una pantalla
 *   autenticada de una cuenta que ya no existe.
 */
export default function DeleteAccountScreen() {
  const colors = useThemeColors();
  const { scrollRef, onScroll, onFocusInput } = useKeyboardScroll();
  const deleteAccount = useDeleteAccount();

  const passwordRef = useRef<TextInput>(null);

  const [acknowledged, setAcknowledged] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordServerError, setPasswordServerError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  /** Se muestra junto al banner cuando el bloqueo es "tenés envíos activos": el
   * usuario necesita llegar a la lista para cancelarlos, no un "intentá de nuevo". */
  const [showShipmentsLink, setShowShipmentsLink] = useState(false);

  const canSubmit = acknowledged && password.length > 0 && !deleteAccount.isPending;

  const submit = () => {
    setBanner(null);
    setPasswordServerError(null);
    setShowShipmentsLink(false);
    deleteAccount.mutate(password, {
      onError: (error) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        if (error instanceof ApiError && error.code === "AUTH_INVALID_CREDENTIALS") {
          setPasswordServerError("La contraseña no es correcta.");
          passwordRef.current?.focus();
          return;
        }
        if (error instanceof ApiError && error.code === "ACCOUNT_HAS_ACTIVE_SHIPMENTS") {
          setShowShipmentsLink(true);
        }
        setBanner(
          friendlyErrorMessage(error, "No pudimos dar de baja tu cuenta. Intentá de nuevo.", {
            RATE_LIMIT_EXCEEDED:
              "Hiciste demasiados intentos. Esperá unos minutos y volvé a probar.",
          }),
        );
      },
      // Sin `onSuccess`: la sesión ya quedó limpia dentro de la mutación y el guard de
      // `app/(app)/_layout.tsx` redirige a `/login` solo.
    });
  };

  const handlePress = () => {
    Alert.alert(
      "¿Dar de baja tu cuenta?",
      "Esta acción es definitiva. No vamos a poder recuperar tu cuenta ni tus datos.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Dar de baja", style: "destructive", onPress: submit },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="delete-account-back"
          onPress={() => router.back()}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">Dar de baja la cuenta</Text>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 16 : 0}
      >
        <ScrollView
          ref={scrollRef}
          testID="delete-account-content"
          contentContainerClassName="px-5 pb-8"
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
          <ErrorBanner testID="delete-account-error" message={banner} />
          {showShipmentsLink ? (
            <Pressable
              testID="delete-account-view-shipments"
              onPress={() => router.push("/shipments")}
              className="mb-4 -mt-2 self-start"
            >
              <Text className="font-sans-semibold text-[13px] text-fg underline">
                Ver mis envíos
              </Text>
            </Pressable>
          ) : null}

          <View className="mb-5 flex-row gap-3 rounded-[10px] border border-danger-300 bg-danger-100 px-3.5 py-3">
            <AlertTriangle size={18} strokeWidth={1.8} color="#972327" />
            <Text className="flex-1 font-sans-semibold text-[13px] text-ink-950">
              Esto es irreversible. Leé qué implica antes de continuar.
            </Text>
          </View>

          <View className="mb-5 gap-3">
            {CONSEQUENCES.map((line) => (
              <View key={line} className="flex-row gap-2.5">
                <Text className="font-sans text-[13px] text-fg-3">•</Text>
                <Text className="flex-1 font-sans text-[13px] leading-5 text-fg-2">{line}</Text>
              </View>
            ))}
          </View>

          <Pressable
            testID="delete-account-acknowledge"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: acknowledged }}
            onPress={() => setAcknowledged((v) => !v)}
            className="mb-5 flex-row items-center gap-3 rounded-[10px] border border-border bg-bg-sub px-3.5 py-3"
          >
            <View
              className={`h-5 w-5 items-center justify-center rounded border ${
                acknowledged ? "border-danger-500 bg-danger-500" : "border-border bg-bg"
              }`}
            >
              {acknowledged ? <Check size={13} color="#FFFFFF" strokeWidth={3} /> : null}
            </View>
            <Text className="flex-1 font-sans text-[13px] text-fg">
              Entiendo que voy a perder mi cuenta y mis datos, y que no se pueden recuperar.
            </Text>
          </Pressable>

          <TextField
            ref={passwordRef}
            testID="delete-account-password"
            label="Confirmá con tu contraseña"
            placeholder="Tu contraseña"
            secureTextEntry={!showPassword}
            autoComplete="current-password"
            textContentType="password"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setPasswordServerError(null);
            }}
            onFocus={() => onFocusInput(passwordRef)}
            onSubmitEditing={() => canSubmit && handlePress()}
            error={passwordServerError ?? undefined}
            rightElement={
              <Pressable
                testID="delete-account-password-toggle"
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
        </ScrollView>

        {/* Botón destructivo propio en vez de `PrimaryButton`: el CTA de esta pantalla
            no puede compartir el tratamiento visual del "seguir adelante" del resto de
            la app. Mismo contenedor sticky (borde superior + padding) para no romper
            el ritmo del layout. */}
        <View className="border-t border-border px-5 pb-6 pt-3.5">
          <Pressable
            testID="delete-account-submit"
            onPress={handlePress}
            disabled={!canSubmit}
            className={`w-full flex-row items-center justify-center gap-2 rounded-lg py-3.5 ${
              canSubmit ? "bg-danger-500" : "bg-bg-mute"
            }`}
          >
            {deleteAccount.isPending ? (
              <ActivityIndicator color={canSubmit ? "#FFFFFF" : colors.fg3} />
            ) : null}
            <Text
              className={`font-sans-semibold text-body ${canSubmit ? "text-white" : "text-fg-3"}`}
            >
              Dar de baja mi cuenta
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
