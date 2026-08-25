import { router } from "expo-router";
import { ChevronLeft, ChevronRight, KeyRound, UserX } from "lucide-react-native";
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
 *
 * La baja de cuenta va en un bloque aparte al final, separada del resto por el
 * título "Zona de riesgo" y con el rojo de `danger` reservado para ella: es la única
 * acción irreversible de la app, y no comparte tarjeta con "Contraseña" para que
 * ningún mistap al presionar una caiga en la otra.
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
            onPress={() => router.push("/profile/change-password" as any)}
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

        <Text className="mb-2.5 mt-7 font-sans-semibold text-caption uppercase text-danger-600">
          Zona de riesgo
        </Text>
        <View className="overflow-hidden rounded-[10px] border border-danger-300 bg-bg-sub">
          <Pressable
            testID="security-delete-account"
            onPress={() => router.push("/profile/delete-account" as any)}
            className="flex-row items-center gap-3 px-4 py-4"
          >
            {/* `danger-500` de tailwind.config.js: la paleta de estado es fija, no
                cambia con el tema, así que va como literal (mismo criterio que el
                resto de la app con los hex de estado). */}
            <UserX size={18} strokeWidth={1.8} color="#E5484D" />
            <View className="flex-1">
              <Text className="font-sans text-[15px] text-danger-600">Dar de baja la cuenta</Text>
              <Text className="mt-0.5 font-sans text-[12px] text-fg-3">
                Borra tus datos personales, sin vuelta atrás
              </Text>
            </View>
            <ChevronRight size={18} strokeWidth={1.8} color={colors.fg3} />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
