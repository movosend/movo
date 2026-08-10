import { Truck } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors } from '../../../src/hooks/use-theme-colors';

/**
 * Placeholder del tab "Transportar" (MOVO-78) — sienta la navegación de 3 tabs de
 * punta a punta; la funcionalidad real de transporte es una épica futura, sin
 * tickets todavía.
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
      <Text className="text-center font-sans text-body text-fg-2">
        Estamos construyendo esta sección. Pronto vas a poder ofrecerte como
        transportista y aceptar envíos.
      </Text>
    </SafeAreaView>
  );
}
