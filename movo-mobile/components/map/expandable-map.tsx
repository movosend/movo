import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Maximize2 } from "lucide-react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

const OPEN_MS = 380;
const CLOSE_MS = 300;
const EASING = Easing.bezier(0.32, 0.72, 0, 1);

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ExpandableMapProps {
  /** El mapa de la card (y sus overlays). El botón de expandir se superpone abajo a la derecha. */
  children: ReactNode;
  /** Contenido del modo pantalla completa; `close` anima el cierre y, al terminar, llama a `then`
   * (p. ej. navegar: un `router.push` con el modal abierto queda tapado por el modal). */
  renderFullscreen: (close: (then?: () => void) => void) => ReactNode;
  /** Abre la pantalla completa apenas la card se dibuja (una vez por montaje), como si se tocara
   * el botón: entrar al detalle desde "Seguir en vivo" del inicio (MOVO-361). */
  openOnMount?: boolean;
  /** Se llama al terminar de abrirse sola con `openOnMount`. */
  onOpenedOnMount?: () => void;
  /** Avisa si el modal está abierto (incluida la animación de cierre), p. ej. para pausar lo que anima la card tapada. */
  onVisibleChange?: (visible: boolean) => void;
  /** Color de fondo mientras el mapa nativo carga, para que la expansión no muestre un hueco. */
  backgroundColor: string;
  /** Radio de la card, para que el rectángulo animado parta con las mismas esquinas. */
  borderRadius?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Envuelve el mapa de una card y le suma un botón de expandir. Al tocarlo mide la card en
 * pantalla y abre un modal cuyo contenedor parte exactamente de ese rectángulo y crece
 * hasta ocupar toda la ventana (esquinas, posición y tamaño interpolados con un solo
 * progreso). El mapa de adentro tiene siempre el tamaño de la ventana y se mantiene
 * centrado, así que el contenedor lo va "revelando" sin reescalar el mapa nativo.
 */
export function ExpandableMap({
  children,
  renderFullscreen,
  backgroundColor,
  borderRadius = 0,
  openOnMount = false,
  onOpenedOnMount,
  onVisibleChange,
  className,
  style,
  testID,
}: ExpandableMapProps) {
  const colors = useThemeColors();
  const { width: windowW, height: windowH } = useWindowDimensions();
  const frameRef = useRef<View>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    onVisibleChange?.(visible);
  }, [visible, onVisibleChange]);
  const origin = useSharedValue<Rect>({ x: 0, y: 0, width: windowW, height: windowH });
  const progress = useSharedValue(0);

  const closing = useRef(false);
  const open = useCallback(() => {
    closing.current = false;
    frameRef.current?.measureInWindow((x, y, width, height) => {
      origin.value = { x, y, width, height };
      progress.value = 0;
      setVisible(true);
      progress.value = withTiming(1, { duration: OPEN_MS, easing: EASING });
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, [origin, progress]);

  // `then` queda del lado de JS: pasar una función de JS por el worklet a `runOnJS` no es seguro.
  const afterClose = useRef<(() => void) | undefined>(undefined);
  const finishClose = useCallback(() => {
    closing.current = false;
    setVisible(false);
    const then = afterClose.current;
    afterClose.current = undefined;
    then?.();
  }, []);

  const close = (then?: () => void) => {
    // Un segundo `close()` durante la animación no pisa la navegación del primero.
    if (closing.current) return;
    closing.current = true;
    afterClose.current = then;
    progress.value = withTiming(0, { duration: CLOSE_MS, easing: EASING }, (finished) => {
      if (finished) runOnJS(finishClose)();
    });
  };

  // Se abre recién con la card medida (`onLayout`): la animación parte de su rectángulo.
  const [laidOut, setLaidOut] = useState(false);
  const openedOnMount = useRef(false);
  useEffect(() => {
    if (!openOnMount || !laidOut || openedOnMount.current) return;
    openedOnMount.current = true;
    open();
    onOpenedOnMount?.();
  }, [openOnMount, laidOut, open, onOpenedOnMount]);

  const containerStyle = useAnimatedStyle(() => {
    const o = origin.value;
    const p = progress.value;
    return {
      left: interpolate(p, [0, 1], [o.x, 0]),
      top: interpolate(p, [0, 1], [o.y, 0]),
      width: interpolate(p, [0, 1], [o.width, windowW]),
      height: interpolate(p, [0, 1], [o.height, windowH]),
      borderRadius: interpolate(p, [0, 1], [borderRadius, 0]),
    };
  });

  // Mapa de tamaño fijo (la ventana), centrado en el contenedor que crece.
  const innerStyle = useAnimatedStyle(() => {
    const o = origin.value;
    const p = progress.value;
    return {
      left: (interpolate(p, [0, 1], [o.width, windowW]) - windowW) / 2,
      top: (interpolate(p, [0, 1], [o.height, windowH]) - windowH) / 2,
    };
  });

  return (
    <>
      <View
        ref={frameRef}
        collapsable={false}
        className={className}
        style={style}
        testID={testID}
        onLayout={() => setLaidOut(true)}
      >
        {children}
        <Pressable
          testID={testID ? `${testID}-expand` : undefined}
          onPress={open}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Ver mapa en pantalla completa"
          className="absolute right-3 top-3 h-9 w-9 items-center justify-center rounded-full bg-bg active:opacity-80"
          style={{ shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } }}
        >
          <Maximize2 size={16} color={colors.fg1} strokeWidth={1.8} />
        </Pressable>
      </View>

      <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={() => close()}>
        <Animated.View style={[{ position: "absolute", overflow: "hidden", backgroundColor }, containerStyle]}>
          <Animated.View style={[{ position: "absolute", width: windowW, height: windowH }, innerStyle]}>
            {renderFullscreen(close)}
          </Animated.View>
        </Animated.View>
      </Modal>
    </>
  );
}
