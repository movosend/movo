import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { Pressable } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

const TRACK_WIDTH = 46;
const TRACK_HEIGHT = 28;
const TRACK_PADDING = 3;
const KNOB_SIZE = 22;
const KNOB_TRAVEL = TRACK_WIDTH - TRACK_PADDING * 2 - KNOB_SIZE; // 18px, mismo valor que el prototipo
const DURATION_MS = 180;

const ON_TRACK_COLOR = "#C6F24A"; // lime-500, acento fijo (no invierte con el tema)

interface ToggleSwitchProps {
  value: boolean;
  onChange: (next: boolean) => void;
  /** No dispara `onChange` — categorías "Pronto" (MOVO-246 AC3) o bloqueadas por el
   * permiso del SO (AC4): un toggle ahí no puede prometer un efecto real. */
  disabled?: boolean;
  /** Solo atenúa (opacidad), sigue siendo tocable — toggle maestro apagado (AC1):
   * las categorías individuales quedan "atenuadas" pero preconfigurables, no
   * bloqueadas (se respetan apenas se vuelve a prender el maestro). */
  dimmed?: boolean;
  testID?: string;
}

/**
 * Primer toggle/switch del repo (MOVO-246) — ni el `Switch` nativo de RN se usaba en
 * ningún lado todavía. Pill 46×28 + knob animado, fiel al prototipo de Claude Design
 * (`Notificaciones.dc.html`, función `sw()`: mismas dimensiones y el mismo recorrido
 * de 18px del knob).
 */
export function ToggleSwitch({ value, onChange, disabled, dimmed, testID }: ToggleSwitchProps) {
  const colors = useThemeColors();
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, { duration: DURATION_MS });
  }, [value, progress]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [colors.bgMute, ON_TRACK_COLOR]),
  }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * KNOB_TRAVEL }],
  }));

  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onChange(!value);
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      style={{ opacity: dimmed ? 0.5 : 1 }}
    >
      <Animated.View
        style={[
          {
            width: TRACK_WIDTH,
            height: TRACK_HEIGHT,
            borderRadius: 999,
            padding: TRACK_PADDING,
            justifyContent: "center",
          },
          trackStyle,
        ]}
      >
        <Animated.View
          style={[
            { width: KNOB_SIZE, height: KNOB_SIZE, borderRadius: 999, backgroundColor: "#FFFFFF" },
            knobStyle,
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

