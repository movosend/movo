import { useEffect, useRef } from "react";
import type { LayoutChangeEvent, View } from "react-native";
import { useTourStore } from "../store/tour-store";

interface TourAnchorOptions {
  /** Radio de las esquinas del elemento. */
  radius: number;
  /** Cuánto se agranda el spotlight alrededor del elemento (prototipo: 6px). */
  padding?: number;
  /** Recibe la `y` del último `onLayout` (relativa al padre, ej. el contenido de un `ScrollView`). */
  scrollIntoView?: (layoutY: number) => void;
}

/**
 * MOVO-169: registra un elemento real como ancla de un paso del tutorial. La posición no
 * se guarda al hacer layout sino que se mide con `measureInWindow` recién cuando el paso es
 * el suyo, así no queda vieja si la pantalla scrolleó o la tab bar se achicó.
 */
export function useTourAnchor(id: string, { radius, padding = 6, scrollIntoView }: TourAnchorOptions) {
  const ref = useRef<View>(null);
  const layoutY = useRef(0);
  const scrollIntoViewRef = useRef(scrollIntoView);
  scrollIntoViewRef.current = scrollIntoView;
  const canScroll = scrollIntoView !== undefined;

  useEffect(
    () =>
      useTourStore.getState().registerAnchor(id, {
        radius,
        padding,
        measure: () =>
          new Promise((resolve) => {
            const node = ref.current;
            if (!node) {
              resolve(null);
              return;
            }
            node.measureInWindow((x, y, width, height) => {
              resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
            });
          }),
        scrollIntoView: canScroll ? () => scrollIntoViewRef.current?.(layoutY.current) : undefined,
      }),
    [id, radius, padding, canScroll],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    layoutY.current = event.nativeEvent.layout.y;
  };

  return { ref, onLayout };
}
