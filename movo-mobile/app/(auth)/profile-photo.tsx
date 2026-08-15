import { KycStatus, UserRole } from "@movo/shared/dist/types/user";
import { router } from "expo-router";
import { ShieldCheck, UserCheck } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../components/auth/primary-button";
import { PhotoPicker } from "../../components/profile/photo-picker";
import { ErrorBanner } from "../../components/ui/error-banner";
import { authClient } from "../../src/api/auth-client";
import { useMyProfile } from "../../src/hooks/use-profile";
import { useRegistration } from "../../src/hooks/use-registration";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { getJwtExpiresInSeconds } from "../../src/lib/jwt";
import { SECURE_STORE_KEYS, secureStore } from "../../src/lib/secure-store";
import { useAuthStore } from "../../src/store/auth-store";

export default function ProfilePhotoScreen() {
  const colors = useThemeColors();
  const registration = useRegistration();
  const { fields, resetRegistration, kycStatus } = registration;
  const authStatus = useAuthStore((state) => state.status);
  // Recién habilitado cuando la sesión está activada (ver `activateSession` abajo) —
  // antes de eso el interceptor de `http-client.ts` no tiene token que adjuntar, y
  // disparar el fetch igual solo lo manda sin `Authorization` a reintentar en vano.
  const { data: profile } = useMyProfile({ enabled: authStatus === "authenticated" });
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [sessionError, setSessionError] = useState(false);

  const displayPhotoUrl = photoUrl ?? profile?.photoUrl ?? null;
  const fullName =
    `${fields.firstName} ${fields.lastName}`.trim() ||
    profile?.fullName ||
    "Usuario";

  // Dedupea llamados concurrentes/repetidos a la misma activación — `null` habilita un
  // reintento (se limpia en `handleFinish` si la activación no logró autenticar).
  const activationPromiseRef = useRef<Promise<void> | null>(null);

  // Al entrar al paso de foto, activamos la sesión persistida en authStore si aún no lo está,
  // para que las llamadas de PhotoPicker (upload-url, confirmPhoto, etc.) lleven el Bearer token (AC9).
  const activateSession = useCallback((): Promise<void> => {
    if (activationPromiseRef.current) return activationPromiseRef.current;

    const promise = (async () => {
      const authState = useAuthStore.getState();
      if (authState.status === "authenticated") return;

      const [savedRefreshToken, savedAccessToken, savedUserId] =
        await Promise.all([
          secureStore.getItem(
            SECURE_STORE_KEYS.pendingRegistrationRefreshToken,
          ),
          secureStore.getItem(
            SECURE_STORE_KEYS.pendingRegistrationAccessToken,
          ),
          secureStore.getItem(SECURE_STORE_KEYS.pendingRegistrationUserId),
        ]);

      if (!savedRefreshToken) return;

      try {
        const refreshed = await authClient.refresh({
          refreshToken: savedRefreshToken,
        });
        await authState.setSession(refreshed);
      } catch {
        if (savedAccessToken && savedUserId) {
          // El access token pendiente ya fue emitido antes (en el registro) — se
          // decodifica su `exp` real en vez de asumir 3600s de vida completos, que
          // trataría un token casi vencido como recién emitido.
          const expiresIn = getJwtExpiresInSeconds(savedAccessToken);
          if (expiresIn !== null && expiresIn > 0) {
            await authState.setSession({
              accessToken: savedAccessToken,
              refreshToken: savedRefreshToken,
              userId: savedUserId,
              fullName,
              roles: [UserRole.SENDER, UserRole.CARRIER],
              kycStatus: kycStatus ?? KycStatus.APPROVED,
              expiresIn,
            });
          }
        }
      }
    })();

    activationPromiseRef.current = promise;
    return promise;
  }, [fullName, kycStatus]);

  useEffect(() => {
    void activateSession();
  }, [activateSession]);

  async function handleFinish() {
    if (finishing) return;
    setFinishing(true);
    try {
      // Espera a que la sesión termine de activarse antes de navegar — si el usuario
      // toca "Continuar"/"Más tarde" antes de que resuelva (o si tanto el refresh como
      // el fallback fallan), navegar igual a /home dejaría al guard de
      // (app)/_layout.tsx mandarlo de vuelta a /login justo después de completar todo
      // el onboarding.
      await activateSession();
      const authState = useAuthStore.getState();
      if (authState.status !== "authenticated") {
        activationPromiseRef.current = null; // permite reintentar en el próximo tap
        setSessionError(true);
        return;
      }
      setSessionError(false);

      // Aseguramos que el estado local de KYC quede en APPROVED
      if (authState.user && authState.user.kycStatus !== KycStatus.APPROVED) {
        await authState.updateKycStatus(KycStatus.APPROVED);
      }

      // Limpia el estado de registro pendiente de secure-store (AC9)
      await resetRegistration();

      // Navega al área autenticada
      router.replace("/home");
    } finally {
      setFinishing(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <ScrollView
        testID="profile-photo-screen"
        className="flex-1 px-6 pt-10"
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-2 h-14 w-14 items-center justify-center rounded-[14px] bg-lime-200">
          <UserCheck size={28} color="#0A0A0B" strokeWidth={2} />
        </View>

        <Text className="mb-2 font-sans-semibold text-title text-fg">
          Tu foto de perfil
        </Text>

        <Text className="mb-6 font-sans text-body text-fg-2">
          En una red de logística entre personas, tu foto permite que la
          contraparte te reconozca en el punto de encuentro y fortalece la
          confianza del intercambio.
        </Text>

        <ErrorBanner
          testID="profile-photo-session-error-banner"
          message={
            sessionError
              ? "No pudimos confirmar tu sesión. Probá de nuevo."
              : null
          }
        />

        <View className="my-auto items-center py-4">
          <PhotoPicker
            testID="onboarding-photo-picker"
            currentPhotoUrl={displayPhotoUrl}
            fullName={fullName}
            onPhotoUpdated={(newUrl) => setPhotoUrl(newUrl)}
            size={120}
            showDirectButtons
            disabled={finishing}
          />
        </View>

        <View className="mb-6 flex-row items-center gap-2.5 rounded-xl border border-border bg-bg-surface p-3.5">
          <ShieldCheck size={18} color={colors.fg2} />
          <Text className="flex-1 font-sans text-[12px] leading-4 text-fg-2">
            La foto será visible para otros usuarios al coordinar entregas o
            envíos. Podés cambiarla o quitarla cuando quieras desde tu perfil.
          </Text>
        </View>

        <View className="mt-auto gap-3 pb-4">
          <PrimaryButton
            testID="profile-photo-continue-btn"
            label={finishing ? "Finalizando…" : photoUrl ? "Continuar" : "Guardar y continuar"}
            onPress={handleFinish}
            loading={finishing}
            disabled={finishing}
          />

          <Pressable
            testID="profile-photo-skip-btn"
            onPress={handleFinish}
            disabled={finishing}
            className="py-2 active:opacity-70"
          >
            <Text className="text-center font-sans-medium text-[14px] text-fg-3">
              Más tarde
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
