import { act, renderHook } from "@testing-library/react-native";
import { useDeadlineExpired } from "../src/hooks/use-deadline-expired";

describe("useDeadlineExpired (MOVO-130 AC5)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("devuelve false sin deadline", async () => {
    expect((await renderHook(() => useDeadlineExpired(undefined))).result.current).toBe(false);
    expect((await renderHook(() => useDeadlineExpired(null))).result.current).toBe(false);
  });

  it("devuelve true de entrada si el deadline ya pasó", async () => {
    const past = new Date(Date.now() - 1_000).toISOString();
    expect((await renderHook(() => useDeadlineExpired(past))).result.current).toBe(true);
  });

  it("pasa a true solo cuando vence el plazo, sin necesidad de otro render", async () => {
    const deadline = new Date(Date.now() + 10 * 60_000).toISOString();
    const { result } = await renderHook(() => useDeadlineExpired(deadline));

    expect(result.current).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(10 * 60_000);
    });

    expect(result.current).toBe(true);
  });

  it("ignora un deadline con formato inválido", async () => {
    expect((await renderHook(() => useDeadlineExpired("no-es-una-fecha"))).result.current).toBe(false);
  });
});
