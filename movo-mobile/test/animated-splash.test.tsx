import { act, render } from "@testing-library/react-native";
import { AnimatedSplash } from "../components/splash/animated-splash";

// `render` es asíncrono en este setup (React 19 concurrente, ver la nota de
// testing de MOVO-135 en el CLAUDE.md del paquete) -- siempre `await render(...)`.
// El mock oficial de reanimated (`test/mocks/reanimated-setup.js`) resuelve
// `withTiming`/`withDelay`/`withSequence` de forma sincrónica -- una vez que
// `exiting` pasa a `true`, toda la cadena de salida (incluido el callback del
// `withTiming` final) corre en el mismo tick disparado por el `setTimeout`.

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe("AnimatedSplash (MOVO-247)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("se mantiene tapando mientras `ready` es `false`, incluso después de 10s", async () => {
    const onFinished = jest.fn();
    await render(<AnimatedSplash testID="splash" colorScheme="light" ready={false} onFinished={onFinished} />);

    await advance(10_000);
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("pedido explícito del usuario: nunca termina antes de ~3s aunque `ready` sea `true` desde el arranque", async () => {
    const onFinished = jest.fn();
    await render(<AnimatedSplash testID="splash" colorScheme="light" ready onFinished={onFinished} />);

    await advance(2_900);
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("termina (llama a onFinished) una vez que pasó el mínimo Y `ready` es `true`", async () => {
    const onFinished = jest.fn();
    await render(<AnimatedSplash testID="splash" colorScheme="light" ready onFinished={onFinished} />);

    await advance(3_200);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("si `ready` sigue en `false` en el primer límite de ciclo, reintenta en el próximo en vez de cortar", async () => {
    const onFinished = jest.fn();
    const screen = await render(<AnimatedSplash testID="splash" colorScheme="light" ready={false} onFinished={onFinished} />);

    // Primer chequeo (a los 3.2s): sigue sin estar `ready`.
    await advance(3_200);
    expect(onFinished).not.toHaveBeenCalled();

    // Recién ahora se vuelve `ready` -- el componente tiene que esperar al
    // PRÓXIMO límite de ciclo de respiración (1.6s más), no cortar ya mismo.
    await act(async () => {
      screen.rerender(<AnimatedSplash testID="splash" colorScheme="light" ready onFinished={onFinished} />);
    });
    await advance(1_000);
    expect(onFinished).not.toHaveBeenCalled();

    await advance(600);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("failsafe (review de Pedro): fuerza la salida a los 12s aunque `ready` nunca llegue a `true`", async () => {
    const onFinished = jest.fn();
    await render(<AnimatedSplash testID="splash" colorScheme="light" ready={false} onFinished={onFinished} />);

    await advance(11_900);
    expect(onFinished).not.toHaveBeenCalled();

    await advance(200);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('muestra el wordmark "movo"', async () => {
    const screen = await render(<AnimatedSplash testID="splash" colorScheme="dark" ready={false} onFinished={jest.fn()} />);
    expect(screen.getByText("movo")).toBeTruthy();
  });

  it("limpia su timer al desmontar sin llamar a onFinished", async () => {
    const onFinished = jest.fn();
    const screen = await render(<AnimatedSplash testID="splash" colorScheme="light" ready onFinished={onFinished} />);
    screen.unmount();

    await advance(10_000);
    expect(onFinished).not.toHaveBeenCalled();
  });
});
