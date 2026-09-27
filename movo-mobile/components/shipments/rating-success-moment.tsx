import { useEffect } from "react";
import { Text, View } from "react-native";
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

/** Largo aproximado del trazo del tilde (viewBox 24x24), para animar `strokeDashoffset`. */
const CHECK_DASH_LENGTH = 24;
const EASE_OUT = Easing.out(Easing.cubic);

export interface RatingSuccessMomentProps {
  title: string;
  subtitle: string;
  testID?: string;
}

/**
 * Confirmación breve dentro de `RatingSheet` (MOVO-173): el círculo lime entra con un leve
 * rebote, el tilde se dibuja y el texto sube. Mismo patrón de tilde dibujado con
 * `strokeDashoffset` que `handshake-confirmation-result.tsx`; el sheet decide cuánto se
 * muestra antes de cerrar.
 */
export function RatingSuccessMoment({ title, subtitle, testID }: RatingSuccessMomentProps) {
  const circle = useSharedValue(0);
  const check = useSharedValue(0);
  const text = useSharedValue(0);

  useEffect(() => {
    circle.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.back(1.6)) });
    check.value = withDelay(180, withTiming(1, { duration: 320, easing: EASE_OUT }));
    text.value = withDelay(300, withTiming(1, { duration: 300, easing: EASE_OUT }));
    // Los shared values son referencias estables en runtime real (mismo criterio que
    // `use-sheet-animation.ts`); el efecto corre una vez, al montarse el momento de éxito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const circleStyle = useAnimatedStyle(() => ({
    opacity: circle.value,
    transform: [{ scale: 0.6 + 0.4 * circle.value }],
  }));
  const checkProps = useAnimatedProps(() => ({
    strokeDashoffset: CHECK_DASH_LENGTH * (1 - check.value),
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: text.value,
    transform: [{ translateY: (1 - text.value) * 8 }],
  }));

  return (
    <View testID={testID} className="items-center gap-5 px-4 pb-6 pt-8">
      <Animated.View
        style={circleStyle}
        className="h-20 w-20 items-center justify-center rounded-full bg-lime-500"
      >
        <Svg width={40} height={40} viewBox="0 0 24 24" fill="none">
          <AnimatedPath
            d="M20 6L9 17l-5-5"
            stroke="#0A0A0B"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={CHECK_DASH_LENGTH}
            animatedProps={checkProps}
          />
        </Svg>
      </Animated.View>

      <Animated.View style={textStyle} className="items-center gap-1.5">
        <Text className="text-center font-sans-semibold text-h3 text-fg">{title}</Text>
        <Text className="text-center font-sans text-small text-fg-2">{subtitle}</Text>
      </Animated.View>
    </View>
  );
}
