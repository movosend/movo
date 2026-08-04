import { router } from "expo-router";
import { ShieldAlert } from "lucide-react-native";
import { Linking, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../components/auth/primary-button";

/**
 * Pantalla completa para `ACCOUNT_SUSPENDED` (login con `account_status`
 * `suspended` o `disabled`, ver criterio 7 de MOVO-74) — a propósito no es un
 * simple mensaje de error inline: es una situación que bloquea por completo
 * al usuario de operar en Movo, amerita una explicación y un camino de
 * salida (soporte), no un banner que se lee de pasada.
 *
 * El backend devuelve el mismo código para "suspended" y "disabled" (no
 * distingue el motivo en la respuesta), así que la copy es genérica a
 * propósito — cubre ambos casos sin asumir cuál aplica.
 */
export default function AccountSuspendedScreen() {
  function contactSupport() {
    Linking.openURL("mailto:soporte@movosend.app?subject=Cuenta%20suspendida");
  }

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
          testID="account-suspended-title"
          className="mb-2 text-center font-sans-semibold text-h2 text-fg"
        >
          Tu cuenta está suspendida
        </Text>
        <Text className="mb-4 text-center font-sans text-body text-fg-2">
          Por motivos de seguridad o por un incumplimiento de nuestros{" "}
          <Text
            testID="account-suspended-terms-link"
            onPress={() => Linking.openURL("https://www.movosend.app/tyc")}
            className="text-fg underline"
          >
            Términos y Condiciones
          </Text>
          , restringimos temporalmente el acceso a tu cuenta. Mientras esté
          así, no vas a poder enviar ni llevar paquetes en Movo.
        </Text>
      </View>

      <PrimaryButton
        testID="account-suspended-contact"
        label="Contactar a soporte"
        onPress={contactSupport}
      />
      <Text
        testID="account-suspended-home"
        onPress={goHome}
        className="mb-2 text-center font-sans text-[13px] text-fg-3"
      >
        Volver al inicio
      </Text>
    </SafeAreaView>
  );
}
