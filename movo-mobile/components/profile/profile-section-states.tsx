import { WifiOff } from "lucide-react-native";
import { Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { SkeletonBlock as Block } from "../ui/skeleton-block";

/**
 * MOVO-168: estados de carga y falla de las secciones del perfil que dependen de
 * `GET /users/me`. Antes `isLoading`/`isError` reemplazaban la pantalla entera
 * (`ProfileSkeleton`/`ProfileErrorState`), tapando también Configuración y "Cerrar sesión",
 * que no necesitan el perfil: con el backend caído el usuario no podía ni salir de la cuenta.
 */

/** Silueta de la cabecera: avatar de 88, nombre y fila de insignias, con el mismo `mb-6`. */
export function ProfileHeaderSkeleton({ testID }: { testID?: string }) {
  return (
    <View testID={testID} className="mb-6 flex-row items-center gap-4">
      <Block className="h-[88px] w-[88px] rounded-full" />
      <View className="flex-1 gap-2">
        <Block className="h-7 w-44 rounded-md" />
        <Block className="h-6 w-28 rounded-full" />
      </View>
      <Block className="h-9 w-9 rounded-full" />
    </View>
  );
}

/** Silueta de `ProfileActivityCard`: padding 14, label, y tres métricas de 92 de alto. */
export function ProfileActivitySkeleton({ testID }: { testID?: string }) {
  return (
    <View
      testID={testID}
      style={{ padding: 14, marginBottom: 20 }}
      className="rounded-[20px] border border-border"
    >
      <Block className="mb-3 h-4 w-24 rounded" />
      <View className="flex-row gap-2.5">
        <Block style={{ minHeight: 92 }} className="flex-1 rounded-[14px]" />
        <Block style={{ minHeight: 92 }} className="flex-1 rounded-[14px]" />
        <Block style={{ minHeight: 92 }} className="flex-1 rounded-[14px]" />
      </View>
    </View>
  );
}

/**
 * Falla del perfil contenida en su lugar (cabecera + actividad), con "Reintentar" local.
 * Configuración y cierre de sesión quedan debajo, usables.
 */
export function ProfileSectionError({
  message,
  onRetry,
  testID,
}: {
  message: string;
  onRetry: () => void;
  testID?: string;
}) {
  const colors = useThemeColors();
  return (
    <View testID={testID} className="mb-5 items-center gap-2 rounded-[20px] border border-border px-5 py-6">
      <WifiOff size={24} strokeWidth={1.8} color={colors.fg3} />
      <Text className="text-center font-sans-semibold text-h3 text-fg">No pudimos cargar tu perfil</Text>
      <Text className="text-center font-sans text-small text-fg-2">{message}</Text>
      <Text
        testID="profile-error-retry"
        accessibilityRole="button"
        onPress={onRetry}
        className="mt-1 font-sans-medium text-small text-fg"
      >
        Reintentar
      </Text>
    </View>
  );
}
