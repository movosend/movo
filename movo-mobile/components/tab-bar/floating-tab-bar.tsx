import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import type { BottomTabBarProps } from "expo-router/build/react-navigation/bottom-tabs";
import { useColorScheme } from "nativewind";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, View, type LayoutRectangle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { expandTabBar, useTabBarStore } from "../../src/store/tab-bar-store";
import { TAB_BAR_ITEMS } from "./tab-config";
import { TabBarButton } from "./tab-bar-button";

const BOTTOM_MARGIN = 12;
const BAR_RADIUS = 28;
const ROW_PADDING = 6;
const INDICATOR_HEIGHT = 44;
const HAS_LIQUID_GLASS = isLiquidGlassAvailable();
const SLIDE_SPRING = { damping: 26, stiffness: 300, mass: 0.9 };
const FOLLOW_SPRING = { damping: 30, stiffness: 500 };
const LIFT_SPRING = { damping: 18, stiffness: 260 };
const LIFTED_SCALE = 1.12;
const COLLAPSED_SCALE = 0.86;
const COLLAPSED_OFFSET_Y = 6;

const INDICATOR_BG = {
  light: "rgba(10, 10, 11, 0.07)",
  dark: "rgba(255, 255, 255, 0.12)",
} as const;

interface TabFrame {
  x: number;
  width: number;
}

/**
 * Tab bar flotante (MOVO-78), estética tomada de expo-motion-tabs: pill centrada que
 * se ajusta al contenido. En iOS 26+ usa el Liquid Glass nativo (`GlassView`
 * interactivo); en Android e iOS anteriores cae a `BlurView` + tinte, porque ahí
 * `GlassView` renderiza un `View` plano sin efecto.
 *
 * La selección es una única pill que se desliza hasta el tab activo, usando la
 * posición que cada botón reporta por `onLayout`. Como en iOS 26, se puede arrastrar:
 * un pan horizontal (que solo se activa tras ~10px, así los taps siguen yendo a cada
 * botón) hace que la pill siga al dedo, salte de tab en tab y navegue al soltar.
 * Mientras se toca o arrastra, la pill crece levemente ("lente").
 *
 * Como en Instagram, la barra se achica cuando la pantalla scrollea hacia abajo
 * (`useTabBarScrollHandler` en cada tab) y vuelve a su tamaño al scrollear hacia
 * arriba, al tocarla o al cambiar de tab.
 *
 * No usa `SafeAreaView`: la barra flota sobre el contenido de cada screen, así que el
 * margen inferior se calcula a mano con `insets.bottom`.
 */
export function FloatingTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = useThemeColors();
  const [layouts, setLayouts] = useState<Record<number, LayoutRectangle>>({});
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const indicatorX = useSharedValue(0);
  const indicatorW = useSharedValue(0);
  const indicatorVisible = useSharedValue(0);
  const lifted = useSharedValue(0);
  const dragIndex = useSharedValue(-1);
  const frames = useSharedValue<TabFrame[]>([]);
  const collapsed = useTabBarStore((store) => store.collapsed);
  const collapse = useSharedValue(0);

  useEffect(() => {
    collapse.value = withTiming(collapsed ? 1 : 0, {
      duration: 280,
      easing: Easing.out(Easing.cubic),
    });
  }, [collapsed, collapse]);

  useEffect(() => {
    expandTabBar();
  }, [state.index]);

  const target = layouts[state.index];

  useEffect(() => {
    const ordered = state.routes.map((_, index) => layouts[index]);
    if (ordered.every(Boolean)) {
      frames.value = ordered.map((layout) => ({ x: layout.x, width: layout.width }));
    }
  }, [layouts, state.routes, frames]);

  useEffect(() => {
    if (!target) return;
    if (indicatorVisible.value === 0) {
      indicatorX.value = target.x;
      indicatorW.value = target.width;
      indicatorVisible.value = 1;
      return;
    }
    indicatorX.value = withSpring(target.x, SLIDE_SPRING);
    indicatorW.value = withSpring(target.width, SLIDE_SPRING);
  }, [target, indicatorX, indicatorW, indicatorVisible]);

  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: indicatorVisible.value,
    width: indicatorW.value,
    transform: [
      { translateX: indicatorX.value },
      { scale: withSpring(lifted.value ? LIFTED_SCALE : 1, LIFT_SPRING) },
    ],
  }));

  const barStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(collapse.value, [0, 1], [0, COLLAPSED_OFFSET_Y]) },
      { scale: interpolate(collapse.value, [0, 1], [1, COLLAPSED_SCALE]) },
    ],
  }));

  function navigateToIndex(index: number) {
    const route = state.routes[index];
    if (!route) return;
    const isFocused = state.index === index;
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });
    if (!isFocused && !event.defaultPrevented) {
      navigation.navigate(route.name);
      return;
    }
    // Sin navegación (tab ya activo o evento prevenido): la pill vuelve a su lugar.
    const current = layouts[state.index];
    if (current) {
      indicatorX.value = withSpring(current.x, SLIDE_SPRING);
      indicatorW.value = withSpring(current.width, SLIDE_SPRING);
    }
  }

  // Funciones JS planas para `runOnJS`: un worklet no puede cerrar sobre el módulo
  // `Haptics` entero (mismo criterio que `slide-to-confirm.tsx`).
  function handleDragHover(index: number) {
    Haptics.selectionAsync();
    setHoverIndex(index);
  }

  function handleDragEnd(index: number) {
    setHoverIndex(null);
    navigateToIndex(index);
  }

  function clearHover() {
    setHoverIndex(null);
  }

  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-20, 20])
    .onStart(() => {
      runOnJS(expandTabBar)();
      lifted.value = 1;
      dragIndex.value = -1;
    })
    .onUpdate((event) => {
      const tabs = frames.value;
      if (tabs.length === 0) return;

      let nearest = 0;
      let nearestDistance = Number.MAX_VALUE;
      for (let i = 0; i < tabs.length; i++) {
        const center = tabs[i].x + tabs[i].width / 2;
        const distance = Math.abs(event.x - center);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = i;
        }
      }

      const width = tabs[nearest].width;
      const minX = tabs[0].x;
      const maxX = tabs[tabs.length - 1].x + tabs[tabs.length - 1].width - width;
      indicatorX.value = Math.min(Math.max(event.x - width / 2, minX), maxX);
      indicatorW.value = withSpring(width, FOLLOW_SPRING);

      if (nearest !== dragIndex.value) {
        dragIndex.value = nearest;
        runOnJS(handleDragHover)(nearest);
      }
    })
    .onEnd(() => {
      const tabs = frames.value;
      const index = dragIndex.value;
      if (index < 0 || !tabs[index]) return;
      indicatorX.value = withSpring(tabs[index].x, SLIDE_SPRING);
      indicatorW.value = withSpring(tabs[index].width, SLIDE_SPRING);
      runOnJS(handleDragEnd)(index);
    })
    .onFinalize(() => {
      lifted.value = 0;
      if (dragIndex.value >= 0) {
        dragIndex.value = -1;
        runOnJS(clearHover)();
      }
    });

  const cardStyle = {
    borderRadius: BAR_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
  } as const;

  const highlightedIndex = hoverIndex ?? state.index;

  const row = (
    <GestureDetector gesture={pan}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 2, padding: ROW_PADDING }}>
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              left: 0,
              top: ROW_PADDING,
              height: INDICATOR_HEIGHT,
              borderRadius: INDICATOR_HEIGHT / 2,
              backgroundColor: INDICATOR_BG[isDark ? "dark" : "light"],
            },
            indicatorStyle,
          ]}
        />
        {state.routes.map((route, index) => {
          const config = TAB_BAR_ITEMS.find((item) => item.name === route.name);
          if (!config) return null;

          const isFocused = state.index === index;

          return (
            <TabBarButton
              key={route.key}
              testID={`tab-bar-button-${config.name}`}
              label={config.label}
              Icon={config.Icon}
              isFocused={isFocused}
              isHighlighted={highlightedIndex === index}
              onPress={() => navigateToIndex(index)}
              onPressIn={() => {
                expandTabBar();
                if (isFocused) lifted.value = 1;
              }}
              onPressOut={() => {
                lifted.value = 0;
              }}
              onLayout={(event) => {
                const layout = event.nativeEvent.layout;
                setLayouts((current) => {
                  const existing = current[index];
                  if (existing?.x === layout.x && existing.width === layout.width) return current;
                  return { ...current, [index]: layout };
                });
              }}
            />
          );
        })}
      </View>
    </GestureDetector>
  );

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: insets.bottom + BOTTOM_MARGIN,
        alignItems: "center",
      }}
    >
      {/* Sombra en un wrapper sin `overflow: hidden`, si no el clip del card la recorta. */}
      <Animated.View
        style={[
          {
            borderRadius: BAR_RADIUS,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.18,
            shadowRadius: 20,
            elevation: 8,
          },
          barStyle,
        ]}
      >
        {HAS_LIQUID_GLASS ? (
          <GlassView
            glassEffectStyle="regular"
            isInteractive
            colorScheme={isDark ? "dark" : "light"}
            style={cardStyle}
          >
            {row}
          </GlassView>
        ) : (
          <View style={cardStyle}>
            <BlurView
              intensity={isDark ? 45 : 70}
              tint={
                Platform.OS === "ios"
                  ? isDark
                    ? "systemUltraThinMaterialDark"
                    : "systemUltraThinMaterialLight"
                  : isDark
                    ? "dark"
                    : "light"
              }
              blurMethod={Platform.OS === "android" ? "dimezisBlurView" : "none"}
              style={StyleSheet.absoluteFill}
            />
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: isDark ? "rgba(24,24,27,0.55)" : "rgba(245,245,247,0.6)" },
              ]}
            />
            {row}
          </View>
        )}
      </Animated.View>
    </View>
  );
}
