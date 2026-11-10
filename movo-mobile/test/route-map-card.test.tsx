import { render } from "@testing-library/react-native";
import { RouteMapCard } from "../components/send/route-map-card";

// El mock oficial de Reanimated no incluye `useFrameCallback`; acá alcanza con un
// callback inactivo (el barrido animado no se verifica en Jest). Tampoco `useReducedMotion`,
// que usa `SkeletonBlock` (MOVO-168).
jest.mock("react-native-reanimated", () => {
  const mock = require("react-native-reanimated/mock");
  return {
    ...mock,
    default: mock.default,
    useFrameCallback: () => ({ setActive: jest.fn(), isActive: false, callbackId: 0 }),
    useReducedMotion: () => false,
  };
});

const mockUseShipmentRoute = jest.fn();
jest.mock("../src/hooks/use-shipments", () => ({
  useShipmentRoute: () => mockUseShipmentRoute(),
}));

const PICKUP = { address: "Av. Colón 1000", lat: -31.41, lng: -64.19 };
const DELIVERY = { address: "Bv. San Juan 500", lat: -31.42, lng: -64.18 };
// "_p~iF~ps|U_ulLnnqC_mqNvxq`@": ejemplo canónico de Google, decodifica a 3 puntos.
const ROUTE = { polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@", distanceMeters: 1500, durationSeconds: 300 };

function baseCoordinates(getByTestId: (id: string) => { props: Record<string, unknown> }) {
  return getByTestId("map-route-base").props.coordinates as unknown[];
}

describe("RouteMapCard", () => {
  beforeEach(() => mockUseShipmentRoute.mockReset());

  it("ofrece expandir el mapa a pantalla completa", async () => {
    mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
    const { getByTestId } = await render(<RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} />);

    expect(getByTestId("map-frame-expand")).toBeTruthy();
  });

  it("mientras la ruta carga no dibuja la recta y tapa el mapa con un skeleton", async () => {
    mockUseShipmentRoute.mockReturnValue({ data: undefined, isError: false });
    const { getByTestId } = await render(<RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} />);

    expect(getByTestId("map-route-loading")).toBeTruthy();
    expect(baseCoordinates(getByTestId)).toEqual([]);
  });

  it("con la ruta real dibuja el trazo por calle y saca el skeleton", async () => {
    mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
    const { getByTestId, queryByTestId } = await render(
      <RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} />,
    );

    expect(queryByTestId("map-route-loading")).toBeNull();
    expect(baseCoordinates(getByTestId)).toHaveLength(3);
  });

  it("si la ruta falla cae a la recta entre los dos puntos", async () => {
    mockUseShipmentRoute.mockReturnValue({ data: undefined, isError: true });
    const { getByTestId, queryByTestId } = await render(
      <RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} />,
    );

    expect(queryByTestId("map-route-loading")).toBeNull();
    const coords = baseCoordinates(getByTestId);
    expect(coords[0]).toEqual({ latitude: PICKUP.lat, longitude: PICKUP.lng });
    expect(coords[coords.length - 1]).toEqual({ latitude: DELIVERY.lat, longitude: DELIVERY.lng });
  });

  it("con pickup null y pickupLabel muestra solo la entrega y el origen como texto (MOVO-194 AC4)", async () => {
    mockUseShipmentRoute.mockReturnValue({ data: undefined, isError: false });
    const { getByTestId, queryByTestId, queryByText } = await render(
      <RouteMapCard testID="map" pickup={null} pickupLabel="Av. Colón 1000" delivery={DELIVERY} />,
    );

    expect(getByTestId("map-map")).toBeTruthy();
    expect(getByTestId("map-pickup-label")).toHaveTextContent("Retiro en Av. Colón 1000");
    expect(queryByTestId("map-route-base")).toBeNull();
    expect(queryByTestId("map-route-loading")).toBeNull();
    expect(queryByText("Bv. San Juan 500")).toBeTruthy();
  });

  it("sin pickup ni pickupLabel sigue mostrando el estado vacío", async () => {
    mockUseShipmentRoute.mockReturnValue({ data: undefined, isError: false });
    const { getByText } = await render(<RouteMapCard testID="map" pickup={null} delivery={DELIVERY} />);

    expect(getByText("Definí el origen y destino para ver la ruta")).toBeTruthy();
  });

  describe("MOVO-346: seguimiento en vivo sobre el mismo mapa", () => {
    const TRACE = [
      { latitude: PICKUP.lat, longitude: PICKUP.lng },
      { latitude: -31.415, longitude: -64.185 },
    ];

    it("dibuja el recorrido, lo que falta desde el transportista y su marcador", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      const live = { position: { lat: -31.415, lng: -64.185 }, stale: false, trace: TRACE, planned: [] };
      const { getByTestId, queryByTestId } = await render(
        <RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} live={live} />,
      );

      // El recorrido termina en el transportista. Lo que falta va en gris continuo; como el transportista
      // está lejos de la ruta del fixture, arranca en su proyección y no en él (sin una recta que las una).
      expect(getByTestId("map-trace").props.coordinates).toEqual([...TRACE, { latitude: -31.415, longitude: -64.185 }]);
      const remaining = getByTestId("map-remaining").props.coordinates as unknown[];
      expect(remaining.length).toBeGreaterThan(1);
      expect(remaining[0]).not.toEqual({ latitude: -31.415, longitude: -64.185 });
      expect(getByTestId("map-remaining").props.lineDashPattern).toBeUndefined();
      expect(getByTestId("map-carrier")).toBeTruthy();
      expect(queryByTestId("map-last-signal")).toBeNull();
      // Una sola ruta: sin la línea base debajo (era la "doble línea" del feedback de la build 18).
      expect(queryByTestId("map-route-base")).toBeNull();
    });

    it("antes del retiro dibuja la ruta entera, sin recortarla desde el transportista", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      const live = { position: { lat: -31.3, lng: -64.3 }, stale: false, trace: [], planned: [], phase: "pickup" as const };
      const { getByTestId, queryByTestId } = await render(
        <RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} live={live} />,
      );

      const remaining = getByTestId("map-remaining").props.coordinates as Array<{ latitude: number; longitude: number }>;
      expect(remaining[0]).not.toEqual({ latitude: -31.3, longitude: -64.3 });
      expect(queryByTestId("map-trace")).toBeNull();
    });

    it("sin señal muestra la hora de la última", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: ROUTE, isError: false });
      const live = {
        position: { lat: -31.415, lng: -64.185 },
        stale: true,
        lastSignalLabel: "Última señal 19:10 h",
        trace: [],
        planned: [],
      };
      const { getByText } = await render(<RouteMapCard testID="map" pickup={PICKUP} delivery={DELIVERY} live={live} />);

      expect(getByText("Última señal 19:10 h")).toBeTruthy();
    });

    it("sin retiro a la vista (receptor) no dibuja la traza, que lo delataría", async () => {
      mockUseShipmentRoute.mockReturnValue({ data: undefined, isError: false });
      const live = { position: { lat: -31.415, lng: -64.185 }, stale: false, trace: TRACE, planned: [] };
      const { queryByTestId, getByTestId } = await render(
        <RouteMapCard testID="map" pickup={null} pickupLabel="Córdoba" delivery={DELIVERY} live={live} />,
      );

      expect(queryByTestId("map-trace")).toBeNull();
      expect(getByTestId("map-carrier")).toBeTruthy();
    });
  });
});
