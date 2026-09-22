import { Linking, Platform, Pressable, Text, View } from "react-native";

/**
 * "Push bloqueado" (MOVO-246 AC4) — el permiso de push del SO está denegado, así que
 * ningún toggle de acá abajo va a tener efecto real hasta que el usuario lo habilite
 * desde Ajustes. `Linking.openSettings()`, mismo idiom que `evidence-capture-step.tsx`/
 * `photo-picker.tsx`/`photos-step.tsx` (nunca `Linking.openURL("app-settings:")` a
 * mano, Expo ya resuelve el esquema por plataforma).
 */
export function NotificationPermissionBanner({ testID }: { testID?: string }) {
  return (
    <View testID={testID} className="mb-6 rounded-[10px] border border-border-strong bg-ink-950 p-4">
      <Text className="font-sans-semibold text-caption uppercase text-lime-500">Push bloqueado</Text>
      <Text className="mt-1.5 font-sans text-[13px] leading-[18px] text-ink-200">
        {Platform.OS === "ios" ? "iOS" : "Android"} está bloqueando las notificaciones de Movo. Activalas
        en los ajustes del teléfono para volver a recibirlas.
      </Text>
      <Pressable
        testID={testID ? `${testID}-open-settings` : undefined}
        onPress={() => void Linking.openSettings()}
        className="mt-3.5 self-start rounded-lg bg-lime-500 px-3.5 py-2.5"
      >
        <Text className="font-sans-semibold text-[13px] text-ink-950">
          Abrir ajustes de {Platform.OS === "ios" ? "iOS" : "Android"}
        </Text>
      </Pressable>
    </View>
  );
}
