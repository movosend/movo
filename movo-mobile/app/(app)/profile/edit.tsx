import { KycStatus } from "@movo/shared/dist/types/user";
import { router } from "expo-router";
import { ChevronLeft, ChevronRight, IdCard, Lock, Mail, Phone, WifiOff } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { PhotoPicker } from "../../../components/profile/photo-picker";
import { ProfileSkeleton } from "../../../components/profile/profile-skeleton";
import { ErrorBanner } from "../../../components/ui/error-banner";
import { SuccessBanner } from "../../../components/ui/success-banner";
import { TextField } from "../../../components/ui/text-field";
import { TextareaField } from "../../../components/ui/textarea-field";
import { useKeyboardScroll } from "../../../src/hooks/use-keyboard-scroll";
import {
  MY_PROFILE_QUERY_KEY,
  useMyProfile,
  useUpdateProfile,
} from "../../../src/hooks/use-profile";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../src/lib/error-messages";
import { formatDni } from "../../../src/hooks/use-registration";
import { capitalizeName, formatPhoneDisplay } from "../../../src/lib/profile-format";

/** Mismo largo y forma que `patchProfileBody` en `movo-svc-users` (MOVO-133): 1-80
 * caracteres, sin espacios en los bordes. Se valida acá para que el usuario vea el
 * error en el campo y no como un 400 genérico. */
const NAME_MAX_LENGTH = 80;

/** Mismo largo que `bio` en `patchProfileBody` de `movo-svc-users` (MOVO-171). */
const BIO_MAX_LENGTH = 280;

function nameError(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) return `Ingresá tu ${label}`;
  if (trimmed.length > NAME_MAX_LENGTH) return `Máximo ${NAME_MAX_LENGTH} caracteres`;
  return "";
}

/**
 * "Editar perfil" (MOVO-135, frontend de MOVO-31 sobre los endpoints de MOVO-133).
 * Vive en `app/(app)/profile/`, hermana de las pantallas de "Cuenta y seguridad"
 * (MOVO-136) — hereda el guard de sesión de `app/(app)/_layout.tsx`.
 *
 * Tres tipos de dato con tres tratamientos distintos, a propósito:
 * - **Foto**: `PhotoPicker` (MOVO-98) reusado tal cual, se guarda al instante.
 * - **Nombre/apellido**: campos del formulario, se mandan con el botón Guardar.
 * - **Teléfono/email**: NO son inputs. Son filas navegables hacia su propio
 *   sub-flujo de verificación por OTP, porque cambiarlos exige probar posesión. Un
 *   input que parece editable y después no guarda sería mentirle al usuario.
 */
export default function EditProfileScreen() {
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const { scrollRef, onScroll } = useKeyboardScroll();
  const { data: profile, isLoading, isError, error, refetch } = useMyProfile();
  const updateProfile = useUpdateProfile();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [bio, setBio] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ firstName: string; lastName: string; bio: string }>({
    firstName: "",
    lastName: "",
    bio: "",
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // El perfil llega por query: los campos se siembran cuando resuelve, y se
  // re-siembran si cambia por afuera (p. ej. al volver de un sub-flujo de OTP, que
  // deja el `PrivateProfile` nuevo en la cache).
  useEffect(() => {
    if (!profile) return;
    setFirstName(profile.firstName);
    setLastName(profile.lastName);
    setBio(profile.bio ?? "");
  }, [profile?.firstName, profile?.lastName, profile?.bio]); // eslint-disable-line react-hooks/exhaustive-deps

  const isNameLockedByKyc = profile?.kycStatus === KycStatus.APPROVED;

  function handleBack() {
    // Sin botón Guardar no existen "cambios sin guardar": cada campo ya se persistió
    // al salir de él, así que volver nunca pierde nada y no hay nada que confirmar.
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)/profile");
  }

  /**
   * Guardado automático al salir del campo (no por tecla, que dispararía un PATCH por
   * carácter). Es el mismo criterio que ya usaba la foto, que se guarda apenas se
   * elige: el botón Guardar solo gobernaba estos dos campos y, con KYC aprobado,
   * quedaba deshabilitado para siempre.
   *
   * Solo sale la request si el valor cambió de verdad contra el perfil cargado —
   * entrar y salir de un campo sin tocarlo no genera tráfico, y evita el 409
   * `PROFILE_NAME_LOCKED_BY_KYC` que el backend devuelve solo ante un cambio real.
   */
  async function saveField(field: "firstName" | "lastName", rawValue: string) {
    if (!profile || isNameLockedByKyc) return;

    const value = rawValue.trim();
    const label = field === "firstName" ? "nombre" : "apellido";
    const validationError = nameError(value, label);

    if (validationError) {
      setFieldErrors((prev) => ({ ...prev, [field]: validationError }));
      return;
    }
    setFieldErrors((prev) => ({ ...prev, [field]: "" }));

    if (value === profile[field].trim()) return;

    setErrorMessage(null);
    try {
      await updateProfile.mutateAsync({ [field]: value });
      setSuccessMessage("Guardamos tus cambios.");
    } catch (err) {
      // Se revierte al valor persistido: dejar en pantalla un texto que el backend
      // rechazó haría creer que quedó guardado.
      if (field === "firstName") setFirstName(profile.firstName);
      else setLastName(profile.lastName);
      setErrorMessage(
        friendlyErrorMessage(err, "No pudimos guardar tus cambios. Intentá de nuevo."),
      );
    }
  }

  /**
   * Espejo simplificado de `saveField()`: sin lock de KYC (bio queda siempre
   * editable). Trim client-side antes de comparar/validar, evita requests
   * innecesarios por espacios -- el servidor vuelve a trimear y convierte `""` a
   * `null` de forma independiente, así que acá no hace falta replicar esa conversión.
   */
  async function saveBio(rawValue: string) {
    if (!profile) return;

    const value = rawValue.trim();
    if (value.length > BIO_MAX_LENGTH) {
      setFieldErrors((prev) => ({ ...prev, bio: `Máximo ${BIO_MAX_LENGTH} caracteres.` }));
      return;
    }
    setFieldErrors((prev) => ({ ...prev, bio: "" }));

    const persisted = (profile.bio ?? "").trim();
    if (value === persisted) return;

    setErrorMessage(null);
    try {
      await updateProfile.mutateAsync({ bio: value });
      setSuccessMessage("Guardamos tus cambios.");
    } catch (err) {
      setBio(profile.bio ?? "");
      setErrorMessage(
        friendlyErrorMessage(err, "No pudimos guardar tus cambios. Intentá de nuevo."),
      );
    }
  }

  if (isLoading) return <ProfileSkeleton testID="edit-profile-skeleton" />;

  if (isError || !profile) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
        <Header onBack={handleBack} colorFg={colors.fg1} />
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <WifiOff size={22} strokeWidth={1.8} color={colors.fg3} />
          <Text className="text-center font-sans text-body text-fg-2">
            {friendlyErrorMessage(error, "No pudimos cargar tu perfil.")}
          </Text>
          <Text
            testID="edit-profile-retry"
            onPress={() => refetch()}
            className="font-sans-medium text-small text-fg"
          >
            Reintentar
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <Header onBack={handleBack} colorFg={colors.fg1} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 16 : 0}
      >
        <ScrollView
          ref={scrollRef}
          testID="edit-profile-content"
          className="flex-1 px-5"
          contentContainerClassName="pb-8"
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
          <SuccessBanner
            testID="edit-profile-success"
            message={successMessage}
            onDismiss={() => setSuccessMessage(null)}
          />
          <ErrorBanner testID="edit-profile-error" message={errorMessage} />

          <View className="mb-6 items-center">
            <PhotoPicker
              testID="edit-profile-photo-picker"
              fullName={capitalizeName(profile.fullName)}
              currentPhotoUrl={profile.photoUrl}
              size={96}
              onPhotoUpdated={() => {
                // `PhotoPicker` ya persistió la foto en el backend; acá solo se
                // refresca el perfil cacheado para que el avatar nuevo se vea al
                // instante, igual que hace la tab de perfil (MOVO-98).
                void queryClient.invalidateQueries({ queryKey: MY_PROFILE_QUERY_KEY });
                setSuccessMessage("Actualizamos tu foto de perfil.");
              }}
            />
            <Text className="mt-2 font-sans text-[12px] text-fg-3">
              Tu foto se guarda apenas la elegís
            </Text>
          </View>

          <TextField
            testID="edit-profile-first-name"
            label="Nombre"
            value={firstName}
            onChangeText={setFirstName}
            onBlur={() => void saveField("firstName", firstName)}
            error={fieldErrors.firstName}
            disabled={isNameLockedByKyc}
            autoCapitalize="words"
            maxLength={NAME_MAX_LENGTH}
          />
          <TextField
            testID="edit-profile-last-name"
            label="Apellido"
            value={lastName}
            onChangeText={setLastName}
            onBlur={() => void saveField("lastName", lastName)}
            error={fieldErrors.lastName}
            disabled={isNameLockedByKyc}
            autoCapitalize="words"
            maxLength={NAME_MAX_LENGTH}
          />

          <TextareaField
            testID="edit-profile-bio"
            label="Bio"
            value={bio}
            onChangeText={setBio}
            onBlur={() => void saveBio(bio)}
            error={fieldErrors.bio}
            maxLength={BIO_MAX_LENGTH}
            placeholder="Contá algo sobre vos..."
          />

          <View
            testID="edit-profile-dni"
            className="mb-3.5 gap-1.5"
          >
            <Text className="font-sans-medium text-[12px] text-fg-2">DNI</Text>
            <View className="w-full flex-row items-center gap-2.5 rounded-md border border-border bg-bg-mute px-3.5 py-3">
              <IdCard size={16} strokeWidth={1.8} color={colors.fg3} />
              <Text className="flex-1 font-sans text-[15px] text-fg-3">
                {profile.dni ? formatDni(profile.dni) : "No registrado"}
              </Text>
              <Lock size={13} strokeWidth={2} color={colors.fg3} />
            </View>
          </View>

          {isNameLockedByKyc ? (
            <View
              testID="edit-profile-kyc-lock-note"
              className="mb-5 flex-row items-start gap-2 rounded-[10px] border border-border bg-bg-sub px-3.5 py-3"
            >
              <Lock size={14} strokeWidth={2} color={colors.fg3} />
              <Text className="flex-1 font-sans text-[12px] text-fg-2">
                Tu nombre, apellido y DNI quedaron verificados con tu documento, así que
                no se pueden editar. Si hay un error, escribinos desde Ayuda.
              </Text>
            </View>
          ) : (
            <Text className="mb-5 font-sans text-[12px] text-fg-3">
              Tu DNI no se puede editar: es el documento con el que se verifica tu
              identidad.
            </Text>
          )}

          <Text className="mb-2.5 mt-1 font-sans-semibold text-caption uppercase text-fg-3">
            Datos de contacto
          </Text>
          <View className="mb-3 overflow-hidden rounded-[10px] border border-border bg-bg-sub">
            <ContactRow
              testID="edit-profile-phone-row"
              Icon={Phone}
              label="Teléfono"
              value={formatPhoneDisplay(profile.phone)}
              onPress={() => router.push("/profile/change-phone")}
              iconColor={colors.fg3}
              chevronColor={colors.fg3}
              isLast={false}
              verified={profile.phoneVerified}
            />
            <ContactRow
              testID="edit-profile-email-row"
              Icon={Mail}
              label="Email"
              value={profile.email}
              onPress={() => router.push("/profile/change-email")}
              iconColor={colors.fg3}
              chevronColor={colors.fg3}
              isLast
              verified={profile.emailVerified}
              onVerifyPress={
                profile.emailVerified ? undefined : () => router.push("/profile/verify-email")
              }
            />
          </View>
          <Text className="font-sans text-[12px] text-fg-3">
            Cambiar tu teléfono o tu email necesita verificación por código.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Header({ onBack, colorFg }: { onBack: () => void; colorFg: string }) {
  return (
    <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
      <Pressable
        testID="edit-profile-back"
        onPress={onBack}
        className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
      >
        <ChevronLeft size={18} color={colorFg} strokeWidth={2} />
      </Pressable>
      <Text className="font-sans-semibold text-h3 text-fg">Editar perfil</Text>
    </View>
  );
}

/**
 * Fila de dato de contacto: muestra el valor actual y navega al sub-flujo de
 * verificación. Mismo lenguaje visual que `ProfilePrivateSection` (MOVO-78), con el
 * chevron y el hint que dejan claro que es un destino, no un campo editable.
 */
function ContactRow({
  testID,
  Icon,
  label,
  value,
  onPress,
  iconColor,
  chevronColor,
  isLast,
  verified = false,
  onVerifyPress,
}: {
  testID: string;
  Icon: typeof Phone;
  label: string;
  value: string;
  onPress: () => void;
  iconColor: string;
  chevronColor: string;
  isLast: boolean;
  /** Teléfono (`phoneVerified`) y email (`emailVerified`, MOVO-139) tienen
   * verificación real. */
  verified?: boolean;
  /** Solo el email la ofrece hoy: tocarlo navega al CTA de verificación (MOVO-139)
   * en vez de al cambio, sin competir con `onPress` de la fila. `undefined` cuando
   * ya está verificado, así no se muestra nada. */
  onVerifyPress?: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      className={`flex-row items-center gap-3 px-4 py-4 ${isLast ? "" : "border-b border-border"}`}
    >
      <Icon size={18} strokeWidth={1.8} color={iconColor} />
      <View className="flex-1">
        <Text className="font-sans text-[11px] uppercase tracking-wide text-fg-3">
          {label}
        </Text>
        <Text className="mt-0.5 font-sans text-[15px] text-fg">{value}</Text>
      </View>
      {verified ? (
        <View className="rounded-full bg-lime-500 px-2.5 py-1">
          <Text className="font-sans-semibold text-[10px] uppercase tracking-wide text-ink-950">
            Verificado
          </Text>
        </View>
      ) : onVerifyPress ? (
        <Pressable
          testID={`${testID}-verify`}
          onPress={onVerifyPress}
          className="rounded-full border border-border px-2.5 py-1"
        >
          <Text className="font-sans-semibold text-[10px] uppercase tracking-wide text-fg-2">
            Verificar
          </Text>
        </Pressable>
      ) : null}
      <ChevronRight size={18} strokeWidth={1.8} color={chevronColor} />
    </Pressable>
  );
}
