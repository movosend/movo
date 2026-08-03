import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

interface WizardHeaderProps {
  /** 0-1, se muestra como % de la barra de progreso. */
  progress: number;
  stepLabel: string;
  onBack?: () => void;
  testID?: string;
}

export function WizardHeader({ progress, stepLabel, onBack, testID }: WizardHeaderProps) {
  return (
    <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
      <Pressable
        onPress={onBack ?? (() => router.back())}
        className="h-8 w-8 items-center justify-center rounded-full bg-ink-100"
        testID={testID ?? 'wizard-back'}
      >
        <ChevronLeft size={18} color="#0A0A0B" strokeWidth={2} />
      </Pressable>
      <View className="h-1 flex-1 overflow-hidden rounded-full bg-ink-150">
        <View
          className="h-full rounded-full bg-lime-500"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </View>
      <Text className="font-sans-medium text-[11px] text-fg-2">{stepLabel}</Text>
    </View>
  );
}
