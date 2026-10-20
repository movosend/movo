import { act, renderHook } from "@testing-library/react-native";
import { useAutoStartTour } from "../src/hooks/use-auto-start-tour";
import { useBlockingGatesStore } from "../src/store/blocking-gates-store";
import { useTourStore } from "../src/store/tour-store";

let mockProfile: { tours: { tourId: string; version: number; outcome: string }[] } | undefined;
jest.mock("../src/hooks/use-profile", () => ({
  useMyProfile: () => ({ data: mockProfile }),
}));

type Props = { enabled: boolean; canBrowse?: boolean };

async function renderCarrierTrigger(initial: Props) {
  return renderHook(
    ({ enabled, canBrowse = true }: Props) =>
      useAutoStartTour("carrier", { enabled, delayMs: 450, context: { canBrowse, hasFeed: false } }),
    { initialProps: initial },
  );
}

async function flush(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

describe("useAutoStartTour (MOVO-169)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockProfile = { tours: [] };
    useTourStore.setState({ active: null, anchors: {}, pending: [], pendingLoaded: true });
    useBlockingGatesStore.setState({ mounted: true, gateVisible: false, tripMatchVisible: false });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("Tour 2: no se dispara con requisitos faltantes", async () => {
    await renderCarrierTrigger({ enabled: false, canBrowse: false });
    await flush(1000);

    expect(useTourStore.getState().active).toBeNull();
  });

  it("Tour 2: se dispara cuando canBrowse pasa a true estando en el tab, después de la espera", async () => {
    const { rerender } = await renderCarrierTrigger({ enabled: false, canBrowse: false });
    await flush(1000);
    expect(useTourStore.getState().active).toBeNull();

    await act(async () => {
      await rerender({ enabled: true, canBrowse: true });
    });
    await flush(400);
    expect(useTourStore.getState().active).toBeNull();
    await flush(100);

    expect(useTourStore.getState().active).toMatchObject({ tourId: "carrier", manual: false });
    expect(useTourStore.getState().context.canBrowse).toBe(true);
  });

  it("no se dispara si ya hay registro de la misma versión", async () => {
    mockProfile = { tours: [{ tourId: "carrier", version: 1, outcome: "skipped" }] };
    await renderCarrierTrigger({ enabled: true });
    await flush(1000);

    expect(useTourStore.getState().active).toBeNull();
  });

  it("un registro pendiente (PUT sin confirmar) cuenta como visto", async () => {
    useTourStore.setState({ pending: [{ tourId: "carrier", version: 1, outcome: "completed" }] });
    await renderCarrierTrigger({ enabled: true });
    await flush(1000);

    expect(useTourStore.getState().active).toBeNull();
  });

  it("espera a que se carguen los pendientes y a que no haya una pantalla bloqueante encima", async () => {
    useTourStore.setState({ pendingLoaded: false });
    useBlockingGatesStore.setState({ gateVisible: true });
    await renderCarrierTrigger({ enabled: true });
    await flush(1000);
    expect(useTourStore.getState().active).toBeNull();

    await act(async () => {
      useTourStore.setState({ pendingLoaded: true });
    });
    await flush(1000);
    expect(useTourStore.getState().active).toBeNull();

    await act(async () => {
      useBlockingGatesStore.setState({ gateVisible: false });
    });
    await flush(500);
    expect(useTourStore.getState().active?.tourId).toBe("carrier");
  });

  it("no pisa un tour que ya está en curso", async () => {
    useTourStore.getState().startTour("first_steps");
    await renderCarrierTrigger({ enabled: true });
    await flush(1000);

    expect(useTourStore.getState().active?.tourId).toBe("first_steps");
  });
});
