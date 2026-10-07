import { useBootStore } from "../src/store/boot-store";

describe("useBootStore (MOVO-247)", () => {
  beforeEach(() => {
    useBootStore.setState({ initialRouteResolved: false });
  });

  it("arranca en `false`", () => {
    expect(useBootStore.getState().initialRouteResolved).toBe(false);
  });

  it("markInitialRouteResolved lo pasa a `true`", () => {
    useBootStore.getState().markInitialRouteResolved();
    expect(useBootStore.getState().initialRouteResolved).toBe(true);
  });

  it("markInitialRouteResolved es idempotente (no dispara un `set` de más una vez ya en `true`)", () => {
    let renderCount = 0;
    const unsubscribe = useBootStore.subscribe(() => {
      renderCount += 1;
    });
    useBootStore.getState().markInitialRouteResolved();
    expect(renderCount).toBe(1);
    useBootStore.getState().markInitialRouteResolved();
    useBootStore.getState().markInitialRouteResolved();
    expect(renderCount).toBe(1);
    unsubscribe();
  });
});
