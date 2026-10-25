import { router } from "expo-router";
import {
  Check,
  ChevronLeft,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../components/auth/primary-button";
import { useActiveSuspension } from "../../src/hooks/use-account-restriction";
import { useMyProfile } from "../../src/hooks/use-profile";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  SUPPORT_EMAIL,
  SUSPENDED_ALLOWED_ACTIONS,
  SUSPENDED_BLOCKED_ACTIONS,
  suspensionPeriodText,
} from "../../src/lib/account-restriction";
import { KYC_TONE_ICON_HEX } from "../../src/lib/kyc-status-ui";

/**
 * Detalle de la suspensión de la cuenta (MOVO-300 AC1): el motivo, qué puede y qué no puede
 * hacer, y el contacto. Llega desde el aviso del inicio (`AccountSuspendedBanner`) y desde el
 * push de la sanción (AC6). Si la suspensión ya se levantó o venció (por ejemplo, el push se
 * abre tarde), muestra que la cuenta está activa en vez de un detalle viejo.
 */
export default function AccountStatusScreen() {
  const colors = useThemeColors();
  const { isLoading } = useMyProfile();
  const suspension = useActiveSuspension();

  function goBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/home");
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="account-status-back"
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Volver"
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">
          Estado de tu cuenta
        </Text>
      </View>

      {isLoading ? null : suspension ? (
        <ScrollView
          contentContainerClassName="px-5 pb-10 pt-2"
          showsVerticalScrollIndicator={false}
        >
          <View className="mb-5 h-14 w-14 items-center justify-center rounded-[14px] bg-warning-100">
            <ShieldAlert
              size={26}
              color={KYC_TONE_ICON_HEX.warning}
              strokeWidth={1.8}
            />
          </View>
          <Text
            testID="account-status-title"
            className="mb-1 font-sans-semibold text-h2 text-fg"
          >
            Tu cuenta está suspendida {suspensionPeriodText(suspension)}
          </Text>
          <Text className="mb-6 font-sans text-body text-fg-2">
            Mientras dure la suspensión podés terminar todo lo que tenés en
            curso, pero no iniciar nada nuevo.
          </Text>

          <Text className="mb-2.5 font-sans-semibold text-caption uppercase text-fg-3">
            Motivo
          </Text>
          <View className="mb-7 rounded-[10px] border border-border bg-bg-sub px-4 py-3.5">
            <Text
              testID="account-status-reason"
              className="font-sans text-[15px] text-fg"
            >
              {suspension.reason}
            </Text>
          </View>

          <Text className="mb-2.5 font-sans-semibold text-caption uppercase text-fg-3">
            Podés
          </Text>
          <View testID="account-status-allowed" className="mb-7 gap-2.5">
            {SUSPENDED_ALLOWED_ACTIONS.map((item) => (
              <View key={item} className="flex-row items-start gap-2.5">
                <Check size={16} color={colors.fg2} strokeWidth={2} />
                <Text className="flex-1 font-sans text-[14px] text-fg">
                  {item}
                </Text>
              </View>
            ))}
          </View>

          <Text className="mb-2.5 font-sans-semibold text-caption uppercase text-fg-3">
            No podés
          </Text>
          <View testID="account-status-blocked" className="mb-7 gap-2.5">
            {SUSPENDED_BLOCKED_ACTIONS.map((item) => (
              <View key={item} className="flex-row items-start gap-2.5">
                <X size={16} color={KYC_TONE_ICON_HEX.danger} strokeWidth={2} />
                <Text className="flex-1 font-sans text-[14px] text-fg">
                  {item}
                </Text>
              </View>
            ))}
          </View>

          <Text className="mb-4 font-sans text-[13px] text-fg-3">
            Si tenés dudas o creés que es un error, escribinos a {SUPPORT_EMAIL}
            .
          </Text>
          {/* MOVO-324: una cuenta suspendida puede escribirle a soporte (el gateway no bloquea `/support`). */}
          <PrimaryButton
            testID="account-status-contact"
            label="Contactar a soporte"
            onPress={() => router.push("/support/new" as never)}
          />
        </ScrollView>
      ) : (
        <View
          testID="account-status-active"
          className="flex-1 items-center px-8 pt-16"
        >
          <View className="mb-5 h-14 w-14 items-center justify-center rounded-[14px] bg-bg-mute">
            <ShieldCheck size={26} color={colors.fg2} strokeWidth={1.8} />
          </View>
          <Text className="mb-2 text-center font-sans-semibold text-h2 text-fg">
            Tu cuenta está activa
          </Text>
          <Text className="mb-8 text-center font-sans text-body text-fg-2">
            No tenés ninguna restricción. Podés usar Movo con normalidad.
          </Text>
          <PrimaryButton
            testID="account-status-home"
            label="Ir al inicio"
            onPress={() => router.replace("/home")}
          />
        </View>
      )}
    </SafeAreaView>
  );
}
