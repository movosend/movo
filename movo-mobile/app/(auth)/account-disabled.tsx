import { useEffect } from "react";
import { router } from "expo-router";
import { ShieldAlert } from "lucide-react-native";
import { Linking, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../components/auth/primary-button";
import {
  SUPPORT_EMAIL,
  SUPPORT_UNAVAILABLE_NOTE,
} from "../../src/lib/account-restriction";
import { useAuthStore } from "../../src/store/auth-store";

/**
 * Pantalla completa de una cuenta **inhabilitada** (MOVO-300 AC4): el login responde
 * `ACCOUNT_DISABLED`, o el gateway lo responde con la sesión abierta y el store la cierra
 * (`signOutReason`). No es un error inline: bloquea por completo al usuario de operar en Movo, y
 * el único camino de salida es soporte (la apelación queda fuera de alcance de MOVO-36).
 *
 * Antes de MOVO-296 era la pantalla de `ACCOUNT_SUSPENDED` y cubría los dos casos. Ahora una
 * cuenta suspendida sí entra a la app y ve el aviso del inicio (`AccountSuspendedBanner`).
 */
export default function AccountDisabledScreen() {
  const clearSignOutReason = useAuthStore((s) => s.clearSignOutReason);

  useEffect(() => {
    clearSignOutReason();
  }, [clearSignOutReason]);

  function goHome() {
    router.replace("/");
  }

  return (
    <SafeAreaView className="flex-1 bg-bg px-8 pt-16" edges={["top", "bottom"]}>
      <View className="flex-1 items-center">
        <View className="mb-5 h-14 w-14 items-center justify-center rounded-[14px] bg-danger-100">
          <ShieldAlert size={26} color="#E5484D" strokeWidth={1.8} />
        </View>
        <Text
          testID="account-disabled-title"
          className="mb-2 text-center font-sans-semibold text-h2 text-fg"
        >
          Tu cuenta fue inhabilitada
        </Text>
        <Text className="mb-4 text-center font-sans text-body text-fg-2">
          Por un incumplimiento de nuestros{" "}
          <Text
            testID="account-disabled-terms-link"
            onPress={() => Linking.openURL("https://www.movosend.app/tyc")}
            className="text-fg underline"
          >
            Términos y Condiciones
          </Text>
          , inhabilitamos tu cuenta de forma permanente. Ya no vas a poder
          ingresar a Movo. Te enviamos un email con el motivo.
        </Text>
        <Text className="text-center font-sans text-[13px] text-fg-3">
          Si creés que es un error, escribinos a {SUPPORT_EMAIL}.
        </Text>
      </View>

      <PrimaryButton
        testID="account-disabled-contact"
        label="Contactar a soporte"
        disabled
        onPress={() => undefined}
      />
      <Text
        testID="account-disabled-contact-unavailable"
        className="mb-4 mt-2 text-center font-sans text-[12px] text-fg-3"
      >
        {SUPPORT_UNAVAILABLE_NOTE}
      </Text>
      <Text
        testID="account-disabled-home"
        onPress={goHome}
        className="mb-2 text-center font-sans text-[13px] text-fg-3"
      >
        Volver al inicio
      </Text>
    </SafeAreaView>
  );
}
