import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function LoginScreen() {
  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top', 'bottom']}>
      <View className="flex-row items-center px-5 pb-3.5 pt-1.5">
        <Pressable
          onPress={() => router.back()}
          className="h-8 w-8 items-center justify-center rounded-full bg-ink-100"
          testID="login-back"
        >
          <ChevronLeft size={18} color="#0A0A0B" strokeWidth={2} />
        </Pressable>
      </View>
      <View className="flex-1 px-6">
        <Text className="mb-1.5 font-sans-semibold text-title text-ink-950">
          Bienvenido de nuevo
        </Text>
        <Text className="font-sans text-body text-fg-2">Próximamente.</Text>
      </View>
    </SafeAreaView>
  );
}
