import { render } from "@testing-library/react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import {
  expandTabBar,
  useTabBarScrollHandler,
  useTabBarStore,
} from "../src/store/tab-bar-store";

function scrollEvent(y: number, contentHeight = 2000, viewportHeight = 800) {
  return {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 390, height: contentHeight },
      layoutMeasurement: { width: 390, height: viewportHeight },
    },
  } as NativeSyntheticEvent<NativeScrollEvent>;
}

let handler: ReturnType<typeof useTabBarScrollHandler>;

function Harness() {
  handler = useTabBarScrollHandler();
  return null;
}

describe("useTabBarScrollHandler", () => {
  beforeEach(async () => {
    expandTabBar();
    await render(<Harness />);
  });

  it("achica la barra al scrollear hacia abajo y la agranda al volver hacia arriba", () => {
    handler.onScroll(scrollEvent(100));
    expect(useTabBarStore.getState().collapsed).toBe(true);

    handler.onScroll(scrollEvent(60));
    expect(useTabBarStore.getState().collapsed).toBe(false);
  });

  it("ignora movimientos chicos por debajo del umbral", () => {
    handler.onScroll(scrollEvent(100));
    handler.onScroll(scrollEvent(96));
    expect(useTabBarStore.getState().collapsed).toBe(true);
  });

  it("siempre la muestra agrandada cerca del tope", () => {
    handler.onScroll(scrollEvent(100));
    handler.onScroll(scrollEvent(10));
    expect(useTabBarStore.getState().collapsed).toBe(false);
  });

  it("no la agranda por el rebote al llegar al fondo de la lista", () => {
    handler.onScroll(scrollEvent(1150));
    expect(useTabBarStore.getState().collapsed).toBe(true);

    handler.onScroll(scrollEvent(1230));
    handler.onScroll(scrollEvent(1200));
    expect(useTabBarStore.getState().collapsed).toBe(true);
  });

  it("expandTabBar la vuelve a su tamaño", () => {
    handler.onScroll(scrollEvent(100));
    expandTabBar();
    expect(useTabBarStore.getState().collapsed).toBe(false);
  });
});
