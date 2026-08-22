import { router } from "expo-router";
import { ChevronLeft, ChevronRight, KeyRound } from "lucide-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";

/**
 * "Cuenta y seguridad" (MOVO-136), sibling de `addresses.tsx` dentro de `app/(app)/`
 * — hereda el guard de sesión de `app/(app)/_layout.tsx`. Reemplaza el placeholder
 * "Cuenta y seguridad" de Perfil → Configuración (`profile-settings-section.tsx`,
 * MOVO-78), igual que hizo MOVO-121 con "Direcciones guardadas".
 *
 * Es un hub, no un formulario: cada acción vive en su propia ruta. El motivo no es
 * estético — la baja de cuenta (irreversible) no comparte contenedor de scroll con el
 * formulario de contraseña, así que ningún mistap durante el scroll puede acercarse a
 * ella. Además es el idiom de Settings en iOS/Android (hub → detalle) y deja un lugar
 * natural al que "volver" después de un cambio exitoso.
 *
 * No expone "última vez que cambiaste la contraseña" ni "sesiones activas": el
 * backend (MOVO-134) no publica `passwordUpdatedAt` ni un listado de sesiones, y no
 * se inventa dato en la UI.
 */
export default function AccountSecurityScreen() {
  const colors = useThemeColors();

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="security-back"
          onPress={() => router.back()}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">Cuenta y seguridad</Text>
      </View>
      <Text className="px-5 pb-6 font-sans text-[13px] text-fg-3">
        Administrá cómo entrás a Movo y qué pasa con tus datos.
      </Text>

      <ScrollView
        testID="security-screen-content"
        contentContainerClassName="px-5 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <Text className="mb-2.5 font-sans-semibold text-caption uppercase text-fg-3">
          Acceso
        </Text>
        <View className="overflow-hidden rounded-[10px] border border-border bg-bg-sub">
          <Pressable
            testID="security-change-password"
            onPress={() => router.push("/profile/change-password")}
            className="flex-row items-center gap-3 px-4 py-4"
          >
            <KeyRound size={18} strokeWidth={1.8} color={colors.fg3} />
            <View className="flex-1">
              <Text className="font-sans text-[15px] text-fg">Contraseña</Text>
              <Text className="mt-0.5 font-sans text-[12px] text-fg-3">
                Cambiala cuando quieras
              </Text>
            </View>
            <ChevronRight size={18} strokeWidth={1.8} color={colors.fg3} />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
