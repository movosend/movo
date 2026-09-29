import { render } from "@testing-library/react-native";
import { RouteMapCard } from "../components/send/route-map-card";

// El mock oficial de Reanimated no incluye `useFrameCallback`; acá alcanza con un
// callback inactivo (el barrido animado no se verifica en Jest).
jest.mock("react-native-reanimated", () => {
  const mock = require("react-native-reanimated/mock");
  return {
    ...mock,
    default: mock.default,
    useFrameCallback: () => ({ setActive: jest.fn(), isActive: false, callbackId: 0 }),
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
});
