import { render } from "@testing-library/react-native";
import {
  APPROACH_REFRESH_MIN_INTERVAL_MS,
  useApproachRefresh,
} from "../src/hooks/use-approach-refresh";

// MOVO-359: la ruta al retiro se pide una vez y se renueva solo si el auto se aleja de la línea.
// Una línea de ~2,2 km hacia el sur sobre el meridiano -64,2.
const APPROACH = [
  { latitude: -31.4, longitude: -64.2 },
  { latitude: -31.41, longitude: -64.2 },
  { latitude: -31.42, longitude: -64.2 },
];

type Props = Parameters<typeof useApproachRefresh>[0];
function Harness(props: Props) {
  useApproachRefresh(props);
  return null;
}

describe("useApproachRefresh", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-10T12:00:00Z"));
  });
  afterEach(() => jest.useRealTimers());

  const base = (over: Partial<Props> = {}): Props => ({
    active: true,
    approach: APPROACH,
    position: { lat: -31.405, lng: -64.2 },
    refetch: jest.fn(),
    ...over,
  });

  it("con el auto sobre la línea no pide otra", async () => {
    const props = base();
    await render(<Harness {...props} />);
    expect(props.refetch).not.toHaveBeenCalled();
  });

  it("si el auto se aleja más de 150 m de la línea, la pide de nuevo", async () => {
    // ~0,002° de longitud a esta latitud son ~190 m.
    const props = base({ position: { lat: -31.405, lng: -64.198 } });
    await render(<Harness {...props} />);
    expect(props.refetch).toHaveBeenCalledTimes(1);
  });

  it("sin ruta todavía (la posición llegó después del pedido, o el proveedor falló) la pide", async () => {
    const props = base({ approach: [] });
    await render(<Harness {...props} />);
    expect(props.refetch).toHaveBeenCalledTimes(1);
  });

  it("no la pide más de una vez por minuto, aunque el auto siga lejos", async () => {
    const refetch = jest.fn();
    const far = { lat: -31.405, lng: -64.198 };
    const screen = await render(<Harness {...base({ refetch, position: far })} />);
    await screen.rerender(<Harness {...base({ refetch, position: { lat: -31.406, lng: -64.198 } })} />);
    expect(refetch).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(APPROACH_REFRESH_MIN_INTERVAL_MS + 1);
    await screen.rerender(<Harness {...base({ refetch, position: { lat: -31.407, lng: -64.198 } })} />);
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("inactivo (en camino a la entrega, o sin posición) no pide nada", async () => {
    const inactive = base({ active: false, approach: [] });
    await render(<Harness {...inactive} />);
    const noPosition = base({ approach: [], position: null });
    await render(<Harness {...noPosition} />);
    expect(inactive.refetch).not.toHaveBeenCalled();
    expect(noPosition.refetch).not.toHaveBeenCalled();
  });
});
