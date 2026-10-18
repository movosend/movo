import { router } from "expo-router";
import { pushOnce, resetNavigationGuard } from "../src/lib/navigation-guard";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

describe("pushOnce (MOVO-301)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetNavigationGuard();
  });
  afterEach(() => jest.useRealTimers());

  it("un doble tap a la misma ruta navega una sola vez", () => {
    pushOnce("/(app)/shipments/s1/chat");
    pushOnce("/(app)/shipments/s1/chat");
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("una ruta distinta no se ignora", () => {
    pushOnce("/(app)/shipments/s1/chat");
    pushOnce("/(app)/shipments/s2/chat");
    expect(router.push).toHaveBeenCalledTimes(2);
  });

  it("pasada la ventana, abrir la misma ruta de nuevo sí navega", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-16T10:00:00Z"));
    pushOnce("/(app)/chats");
    jest.setSystemTime(new Date("2026-10-16T10:00:02Z"));
    pushOnce("/(app)/chats");
    expect(router.push).toHaveBeenCalledTimes(2);
  });
});
