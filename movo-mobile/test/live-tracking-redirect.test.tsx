import { render } from "@testing-library/react-native";
import LegacyTrackingRedirect from "../app/(app)/shipments/[id]/tracking";

const mockRedirect = jest.fn();
const mockParams = jest.fn((): { id?: string | string[] } => ({ id: "shipment-1" }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams(),
  Redirect: (props: { href: unknown }) => {
    mockRedirect(props.href);
    return null;
  },
}));

/** MOVO-361 AC4: la pantalla "Seguimiento en vivo" se fue; la ruta queda para deep links y pushes viejos. */
describe("/shipments/:id/tracking (MOVO-361)", () => {
  afterEach(() => jest.clearAllMocks());

  it("redirige al detalle del envío con el mapa abierto", async () => {
    await render(<LegacyTrackingRedirect />);

    expect(mockRedirect).toHaveBeenCalledWith({
      pathname: "/(app)/shipments/[id]",
      params: { id: "shipment-1", map: "live" },
    });
  });

  it("sin id va al inicio", async () => {
    mockParams.mockReturnValueOnce({});
    await render(<LegacyTrackingRedirect />);

    expect(mockRedirect).toHaveBeenCalledWith("/(app)/(tabs)/home");
  });
});
