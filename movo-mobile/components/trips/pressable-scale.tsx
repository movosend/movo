import type { Ref } from "react";
import { Pressable, type PressableProps, type StyleProp, type View, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * `transition: transform 120ms` + `:active { scale(.98) }` del mockup de "Mis viajes".
 * `style` es un estilo estático: una función `({ pressed }) => …` no se soporta (antes se
 * ignoraba sin avisar), así que el tipo la excluye. `ref` llega al `Pressable` (MOVO-169: las
 * cards de Transportar son anclas del tutorial).
 */
export function PressableScale({
  style,
  onPressIn,
  onPressOut,
  ...props
}: Omit<PressableProps, "style"> & { style?: StyleProp<ViewStyle>; ref?: Ref<View> }) {
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
      style={[animatedStyle, style]}
    />
  );
}
