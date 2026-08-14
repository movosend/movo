import { KycStatus, UserRole } from "@movo/shared/dist/types/user";
import { router } from "expo-router";
import { ShieldCheck, UserCheck } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../components/auth/primary-button";
import { PhotoPicker } from "../../components/profile/photo-picker";
import { authClient } from "../../src/api/auth-client";
import { useMyProfile } from "../../src/hooks/use-profile";
import { useRegistration } from "../../src/hooks/use-registration";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { SECURE_STORE_KEYS, secureStore } from "../../src/lib/secure-store";
import { useAuthStore } from "../../src/store/auth-store";

export default function ProfilePhotoScreen() {
  const colors = useThemeColors();
  const registration = useRegistration();
  const { fields, resetRegistration, kycStatus } = registration;
  const { data: profile } = useMyProfile();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const displayPhotoUrl = photoUrl ?? profile?.photoUrl ?? null;
  const fullName =
    `${fields.firstName} ${fields.lastName}`.trim() ||
    profile?.fullName ||
    "Usuario";

  // Al entrar al paso de foto, activamos la sesión persistida en authStore si aún no lo está,
  // para que las llamadas de PhotoPicker (upload-url, confirmPhoto, etc.) lleven el Bearer token (AC9).
  useEffect(() => {
    async function activatePendingSession() {
      const authState = useAuthStore.getState();
      if (authState.status !== "authenticated") {
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

        if (savedRefreshToken) {
          try {
            const refreshed = await authClient.refresh({
              refreshToken: savedRefreshToken,
            });
            await authState.setSession(refreshed);
          } catch {
            if (savedAccessToken && savedUserId) {
              await authState.setSession({
                accessToken: savedAccessToken,
                refreshToken: savedRefreshToken,
                userId: savedUserId,
                fullName,
                roles: [UserRole.SENDER, UserRole.CARRIER],
                kycStatus: kycStatus ?? KycStatus.APPROVED,
                expiresIn: 3600,
              });
            }
          }
        }
      }
    }
    void activatePendingSession();
  }, [fullName, kycStatus]);

  async function handleFinish() {
    if (finishing) return;
    setFinishing(true);
    try {
      // Aseguramos que el estado local de KYC quede en APPROVED
      const authState = useAuthStore.getState();
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
