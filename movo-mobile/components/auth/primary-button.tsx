import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useThemeColors } from '../../src/hooks/use-theme-colors';

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
  const colors = useThemeColors();
  const isDisabled = disabled || loading;
  // Variante "dark": no es literalmente negro — invierte con el tema (negro
  // sobre blanco en claro, blanco sobre negro en oscuro), usando `fg`/`bg`
  // porque en global.css ya son opuestos exactos entre los dos temas.
  const bgClass = isDisabled ? 'bg-bg-mute' : variant === 'lime' ? 'bg-lime-500' : 'bg-fg';
  const textClass = isDisabled ? 'text-fg-3' : variant === 'lime' ? 'text-ink-950' : 'text-bg';
  const spinnerColor = isDisabled ? colors.fg3 : variant === 'lime' ? '#0A0A0B' : colors.bg;

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
        {loading ? <ActivityIndicator color={spinnerColor} /> : null}
        <Text className={`font-sans-semibold text-body ${textClass}`}>{label}</Text>
      </Pressable>
    </View>
  );
}
