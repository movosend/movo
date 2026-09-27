import { useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { create } from "zustand";

interface TabBarState {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

export const useTabBarStore = create<TabBarState>((set) => ({
  collapsed: false,
  setCollapsed: (collapsed) => set((state) => (state.collapsed === collapsed ? state : { collapsed })),
}));

export function expandTabBar() {
  useTabBarStore.getState().setCollapsed(false);
}

const TOP_ZONE = 24;
const DIRECTION_THRESHOLD = 8;

/**
 * Props de scroll para las pantallas de los tabs: achica el tab bar al scrollear hacia
 * abajo y lo vuelve a agrandar al scrollear hacia arriba o al volver al tope. Ignora el
 * rebote de iOS en el fondo de la lista, que se leería como un scroll hacia arriba.
 */
export function useTabBarScrollHandler() {
  const lastY = useRef(0);

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const y = contentOffset.y;
    const { setCollapsed } = useTabBarStore.getState();

    if (y <= TOP_ZONE) {
      lastY.current = y;
      setCollapsed(false);
      return;
    }
    if (y + layoutMeasurement.height >= contentSize.height) {
      lastY.current = y;
      return;
    }

    const delta = y - lastY.current;
    if (Math.abs(delta) < DIRECTION_THRESHOLD) return;
    setCollapsed(delta > 0);
    lastY.current = y;
  }

  return { onScroll, scrollEventThrottle: 16 };
}
