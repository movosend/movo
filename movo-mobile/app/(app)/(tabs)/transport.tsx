import { router } from 'expo-router';
import { Truck } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors } from '../../../src/hooks/use-theme-colors';

/**
 * Tab "Transportar" (MOVO-78 sentó la navegación de 3 tabs; MOVO-162 agrega el primer
 * punto de entrada real). Mismo criterio de alcance acotado que MOVO-83 con "Enviar"
 * (`app/(app)/send.tsx`): solo el CTA hacia "Mis viajes", sin rediseñar el tab entero —
 * eso queda para cuando existan más features de transportista (ver CLAUDE.md).
 */
export default function TransportScreen() {
  const colors = useThemeColors();

  return (
    <SafeAreaView className="flex-1 items-center justify-center bg-bg px-8" edges={['top', 'bottom']}>
      <View className="mb-5 h-14 w-14 items-center justify-center rounded-full bg-bg-mute">
        <Truck size={26} strokeWidth={1.8} color={colors.fg2} />
      </View>
      <Text testID="transport-title" className="mb-2 text-center font-sans-semibold text-h2 text-fg">
        Transportar
      </Text>
      <Text className="mb-6 text-center font-sans text-body text-fg-2">
        Declará tus viajes planeados para que otros usuarios encuentren paquetes
        compatibles con tu ruta.
      </Text>
      <Pressable
        testID="transport-my-trips-cta"
        // `as any`: ruta nueva de MOVO-162 todavía no reflejada en
        // `.expo/types/router.d.ts` (gitignoreado, se regenera al levantar el dev
        // server) — mismo criterio ya usado en `profile-settings-section.tsx`.
        onPress={() => router.push('/carrier/trips' as any)}
        className="flex-row items-center gap-2 rounded-full bg-fg px-5 py-3.5"
      >
        <Text className="font-sans-semibold text-body text-bg">Mis viajes</Text>
      </Pressable>
    </SafeAreaView>
  );
}
