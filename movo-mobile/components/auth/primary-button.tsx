import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  variant?: 'dark' | 'lime';
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  testID,
  variant = 'dark',
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading;
  const bgClass = isDisabled ? 'bg-ink-200' : variant === 'lime' ? 'bg-lime-500' : 'bg-ink-950';
  const textClass = isDisabled ? 'text-ink-400' : variant === 'lime' ? 'text-ink-950' : 'text-paper';

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <View className="border-t border-border px-5 pb-6 pt-3.5">
      <Pressable
        onPress={handlePress}
        disabled={isDisabled}
        testID={testID}
        className={`w-full flex-row items-center justify-center gap-2 rounded-lg py-3.5 ${bgClass}`}
      >
        {loading ? <ActivityIndicator color={variant === 'lime' ? '#0A0A0B' : '#FFFFFF'} /> : null}
        <Text className={`font-sans-semibold text-body ${textClass}`}>{label}</Text>
      </Pressable>
    </View>
  );
}
