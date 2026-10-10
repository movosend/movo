import { useState } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useEffect } from "react";
import type { TripListScope } from "../../src/api/trips-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

const TABS: { scope: TripListScope; label: string }[] = [
  { scope: "upcoming", label: "Próximos" },
  { scope: "history", label: "Historial" },
];
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const PADDING = 3;

function TabLabel({
  label,
  index,
  position,
  selectedColor,
  idleColor,
}: {
  label: string;
  index: number;
  position: { value: number };
  selectedColor: string;
  idleColor: string;
}) {
  const style = useAnimatedStyle(() => ({
    color: interpolateColor(Math.abs(position.value - index), [0, 1], [selectedColor, idleColor]),
  }));
  return (
    <Animated.Text style={style} className="font-sans-medium text-[15px]">
      {label}
    </Animated.Text>
  );
}

/**
 * Segmented control del mockup de "Mis viajes": píldora `ink-100` con un indicador `ink-950`
 * que se desliza (280ms ease-out) y etiquetas que cambian de color (200ms).
 */
export function TripsSegmented({ value, onChange }: { value: TripListScope; onChange: (s: TripListScope) => void }) {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);
  const index = TABS.findIndex((t) => t.scope === value);
  const slide = useSharedValue(index);
  const color = useSharedValue(index);

  useEffect(() => {
    slide.value = withTiming(index, { duration: 280, easing: EASE_OUT });
    color.value = withTiming(index, { duration: 200 });
  }, [index, slide, color]);

  const segmentWidth = Math.max(0, (width - PADDING * 2) / 2);
  const indicatorStyle = useAnimatedStyle(() => ({
    width: segmentWidth,
    transform: [{ translateX: slide.value * segmentWidth }],
  }));
  const position = useDerivedValue(() => color.value);

  return (
    <View
      testID="my-trips-tabs"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      className="mt-[18px] flex-row rounded-full bg-bg-mute p-[3px]"
    >
      <Animated.View
        style={[{ position: "absolute", top: PADDING, bottom: PADDING, left: PADDING }, indicatorStyle]}
        className="rounded-full bg-fg"
      />
      {TABS.map((tab, i) => (
        <Pressable
          key={tab.scope}
          testID={`my-trips-tab-${tab.scope}`}
          onPress={() => onChange(tab.scope)}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab.scope === value }}
          className="h-10 flex-1 items-center justify-center"
        >
          <TabLabel
            label={tab.label}
            index={i}
            position={position}
            selectedColor={colors.bg}
            idleColor={colors.fg1}
          />
        </Pressable>
      ))}
    </View>
  );
}
