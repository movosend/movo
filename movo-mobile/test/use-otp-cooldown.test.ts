import { act, renderHook } from "@testing-library/react-native";
import { formatCooldown, useOtpCooldown } from "../src/hooks/use-otp-cooldown";

describe("formatCooldown", () => {
  it("formatea en mm:ss", () => {
    expect(formatCooldown(60)).toBe("01:00");
    expect(formatCooldown(9)).toBe("00:09");
    expect(formatCooldown(0)).toBe("00:00");
  });

  // El wizard de registro formateaba a mano como `00:${padStart(2)}`, que con un
  // cooldown de más de 99 segundos mostraba "00:120". Al extraer el hook (MOVO-135)
  // se corrigió: los minutos salen del propio valor, no hardcodeados en "00".
  it("no se rompe con cooldowns de más de 99 segundos", () => {
    expect(formatCooldown(120)).toBe("02:00");
    expect(formatCooldown(605)).toBe("10:05");
  });

  it("trata los negativos como cero en vez de mostrar un signo menos", () => {
    expect(formatCooldown(-5)).toBe("00:00");
  });
});

describe("useOtpCooldown", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("arranca en cero y cuenta hacia atrás hasta agotarse", async () => {
    const { result } = await renderHook(() => useOtpCooldown());
    expect(result.current.secondsLeft).toBe(0);

    await act(async () => result.current.start(60));
    expect(result.current.secondsLeft).toBe(60);

    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(result.current.secondsLeft).toBe(50);

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(result.current.secondsLeft).toBe(0);
  });

  it("start(0) no arranca ninguna cuenta", async () => {
    const { result } = await renderHook(() => useOtpCooldown());
    await act(async () => result.current.start(0));
    expect(result.current.secondsLeft).toBe(0);
  });

  it("un reenvío reinicia la cuenta sobre el cooldown nuevo", async () => {
    const { result } = await renderHook(() => useOtpCooldown());
    await act(async () => result.current.start(60));
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(result.current.secondsLeft).toBe(30);

    await act(async () => result.current.start(60));
    expect(result.current.secondsLeft).toBe(60);
  });
});
