import { Pressable, type PressableProps } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** `transition: transform 120ms` + `:active { scale(.98) }` del mockup de "Mis viajes". */
export function PressableScale({ style, onPressIn, onPressOut, ...props }: PressableProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...props}
      onPressIn={(e) => {
        scale.value = withTiming(0.98, { duration: 120, easing: Easing.out(Easing.cubic) });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withTiming(1, { duration: 120, easing: Easing.out(Easing.cubic) });
        onPressOut?.(e);
      }}
      style={[animatedStyle, style as object]}
    />
  );
}
