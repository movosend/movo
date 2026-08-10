import * as Haptics from "expo-haptics";
import { type LucideIcon } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useEffect } from "react";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

const BUTTON_HEIGHT = 44;
const ICON_SIZE = 18;
const SPRING_CONFIG = { damping: 18, stiffness: 220, mass: 0.7 };
const PRESS_SPRING_CONFIG = { damping: 14, stiffness: 300 };

interface TabBarButtonProps {
  label: string;
  Icon: LucideIcon;
  isFocused: boolean;
  onPress: () => void;
  testID?: string;
}

/**
 * Botón individual del tab bar flotante (MOVO-78). Segunda reescritura tras feedback
 * de que la variante "expandable" (pill que crece con el label) no convencía: ahora
 * los 3 tabs muestran siempre ícono+label a ancho fijo (`flex: 1`, repartiendo el
 * ancho total de la barra en partes iguales — lo arma el padre, acá solo se ocupa
 * un slot ya fijo), y la única diferencia entre seleccionado/no-seleccionado es un
 * fondo negro (`colors.fg1`) + color de ícono/texto invertido. Nada cambia de tamaño
 * ni de posición al seleccionar, así que no hace falta animar layout de hermanos
 * (`LinearTransition` de la versión anterior ya no aplica) — solo hay un crossfade de
 * color con spring, más el bounce táctil de siempre en press-in/out.
 */
export function TabBarButton({ label, Icon, isFocused, onPress, testID }: TabBarButtonProps) {
  const colors = useThemeColors();
  const progress = useSharedValue(isFocused ? 1 : 0);
  const pressScale = useSharedValue(1);

  useEffect(() => {
    progress.value = withSpring(isFocused ? 1 : 0, SPRING_CONFIG);
  }, [isFocused, progress]);

  const containerStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], ["transparent", colors.fg1]),
    transform: [{ scale: pressScale.value }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [colors.fg2, colors.bg]),
  }));

  const inactiveIconStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const activeIconStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  function handlePressIn() {
    pressScale.value = withSpring(0.96, PRESS_SPRING_CONFIG);
  }

  function handlePressOut() {
    pressScale.value = withSpring(1, PRESS_SPRING_CONFIG);
  }

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }

  return (
    <Animated.View
      style={[{ flex: 1, height: BUTTON_HEIGHT, borderRadius: BUTTON_HEIGHT / 2 }, containerStyle]}
    >
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        testID={testID}
        accessibilityRole="tab"
        accessibilityState={{ selected: isFocused }}
        accessibilityLabel={label}
        className="h-full w-full flex-row items-center justify-center gap-1"
      >
        <View style={{ width: ICON_SIZE, height: ICON_SIZE }}>
          <Animated.View style={[{ position: "absolute" }, inactiveIconStyle]}>
            <Icon size={ICON_SIZE} strokeWidth={2} color={colors.fg2} />
          </Animated.View>
          <Animated.View style={[{ position: "absolute" }, activeIconStyle]}>
            <Icon size={ICON_SIZE} strokeWidth={2} color={colors.bg} />
          </Animated.View>
        </View>
        <Animated.Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
          style={[{ fontSize: 12.5 }, labelStyle]}
          className="font-sans-semibold"
        >
          {label}
        </Animated.Text>
      </Pressable>
    </Animated.View>
  );
}
