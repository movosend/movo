import { useEffect } from "react";
import { View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

/** `mvPulse` del mockup: punto lima de 8px con un halo que se expande 7px y se desvanece (2s, en loop). */
export function PulseDot({ testID }: { testID?: string }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.out(Easing.ease) }), -1, false);
  }, [progress]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.7 * (1 - progress.value),
    transform: [{ scale: 1 + progress.value * 1.75 }],
  }));

  return (
    <View testID={testID} className="h-2 w-2 items-center justify-center">
      <Animated.View style={ringStyle} className="absolute h-2 w-2 rounded-full bg-lime-500" />
      <View className="h-2 w-2 rounded-full bg-lime-500" />
    </View>
  );
}
