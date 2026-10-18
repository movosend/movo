import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const CHECK_DASH_LENGTH = 24;
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

/**
 * Sello de "Fondos reservados" (MOVO-269), el de los prototipos v2/v3: círculo lima de 88px que
 * aparece con un fundido, un anillo que se expande y se desvanece, y el tilde que se dibuja con
 * un leve rebote. Colores fijos de marca (lima + tinta), igual en claro y oscuro.
 */
export function ReserveStamp({ testID }: { testID?: string }) {
  const fade = useSharedValue(0);
  const ring = useSharedValue(0);
  const pop = useSharedValue(0);
  const draw = useSharedValue(0);

  useEffect(() => {
    fade.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) });
    ring.value = withDelay(200, withTiming(1, { duration: 900, easing: EASE_OUT }));
    pop.value = withDelay(120, withTiming(1, { duration: 500, easing: Easing.out(Easing.back(1.6)) }));
    draw.value = withDelay(160, withTiming(1, { duration: 380, easing: EASE_OUT }));
    // Los shared values son referencias estables en runtime real (criterio de `SuccessMoment`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disc = useAnimatedStyle(() => ({ opacity: fade.value }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.7 * (1 - ring.value),
    transform: [{ scale: 1 + 0.9 * ring.value }],
  }));
  const check = useAnimatedStyle(() => ({ transform: [{ scale: 0.6 + 0.4 * pop.value }] }));
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: CHECK_DASH_LENGTH * (1 - draw.value) }));

  return (
    <View testID={testID} className="h-[88px] w-[88px] items-center justify-center">
      <Animated.View style={disc} className="absolute inset-0 rounded-full bg-lime-500" />
      <Animated.View
        style={ringStyle}
        className="absolute inset-0 rounded-full border-2 border-lime-500"
      />
      <Animated.View style={check}>
        <Svg width={40} height={40} viewBox="0 0 24 24" fill="none">
          <AnimatedPath
            d="M20 6L9 17l-5-5"
            stroke="#0A0A0B"
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={CHECK_DASH_LENGTH}
            animatedProps={checkProps}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}
