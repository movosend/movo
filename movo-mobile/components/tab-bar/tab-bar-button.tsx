import * as Haptics from "expo-haptics";
import { type LucideIcon } from "lucide-react-native";
import { useEffect } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

const TAB_HEIGHT = 44;
const ICON_SIZE = 20;

interface TabBarButtonProps {
  label: string;
  Icon: LucideIcon;
  isFocused: boolean;
  isHighlighted: boolean;
  onPress: () => void;
  onPressIn: () => void;
  onPressOut: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
  testID?: string;
}

/**
 * Botón del tab bar flotante (MOVO-78). No pinta fondo propio: la pill de selección
 * es una sola, compartida, y la anima `FloatingTabBar`. `isHighlighted` (color) se
 * separa de `isFocused` (accesibilidad) porque mientras se arrastra la selección el
 * tab resaltado es el que está bajo el dedo, no todavía el de la ruta activa.
 */
export function TabBarButton({
  label,
  Icon,
  isFocused,
  isHighlighted,
  onPress,
  onPressIn,
  onPressOut,
  onLayout,
  testID,
}: TabBarButtonProps) {
  const colors = useThemeColors();
  const progress = useSharedValue(isHighlighted ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(isHighlighted ? 1 : 0, {
      duration: 250,
      easing: Easing.out(Easing.cubic),
    });
  }, [isHighlighted, progress]);

  const activeIconStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const inactiveIconStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));

  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [colors.fg3, colors.fg1]),
  }));

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onLayout={onLayout}
      testID={testID}
      accessibilityRole="tab"
      accessibilityState={{ selected: isFocused }}
      accessibilityLabel={label}
      style={{
        height: TAB_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 12,
      }}
    >
      <View style={{ width: ICON_SIZE, height: ICON_SIZE }}>
        <Animated.View style={[iconLayer, inactiveIconStyle]}>
          <Icon size={ICON_SIZE} strokeWidth={2} color={colors.fg3} />
        </Animated.View>
        <Animated.View style={[iconLayer, activeIconStyle]}>
          <Icon size={ICON_SIZE} strokeWidth={2.25} color={colors.fg1} />
        </Animated.View>
      </View>
      <Animated.Text
        numberOfLines={1}
        style={[{ fontSize: 14, letterSpacing: -0.1 }, labelStyle]}
        className="font-sans-semibold"
      >
        {label}
      </Animated.Text>
    </Pressable>
  );
}

const iconLayer = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  alignItems: "center",
  justifyContent: "center",
} as const;
