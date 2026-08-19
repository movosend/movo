import { fireEvent, render } from "@testing-library/react-native";
import { ViewAllShipmentsLink } from "../components/home/view-all-shipments-link";

const mockRouterPush = jest.fn();

jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
}));

const mockUseRecentShipments = jest.fn();

jest.mock("../src/hooks/use-shipments", () => ({
  useRecentShipments: () => mockUseRecentShipments(),
}));

// MOVO-127: acceso a "Mis Envíos", sección propia debajo de Actividad Reciente.
describe("ViewAllShipmentsLink", () => {
  afterEach(() => jest.clearAllMocks());

  it("no renderiza nada mientras no hay datos", async () => {
    mockUseRecentShipments.mockReturnValue({ data: undefined });

    const { queryByTestId } = await render(<ViewAllShipmentsLink testID="link" />);

    expect(queryByTestId("link")).toBeNull();
  });

  it("no renderiza nada en el estado vacío", async () => {
    mockUseRecentShipments.mockReturnValue({ data: { items: [], page: 1, limit: 3, total: 0 } });

    const { queryByTestId } = await render(<ViewAllShipmentsLink testID="link" />);

    expect(queryByTestId("link")).toBeNull();
  });

  it("navega al listado completo al tocarlo cuando hay envíos", async () => {
    mockUseRecentShipments.mockReturnValue({
      data: { items: [{ id: "s1" }], page: 1, limit: 3, total: 1 },
    });

    const { getByTestId } = await render(<ViewAllShipmentsLink testID="link" />);

    await fireEvent.press(getByTestId("link"));

    expect(mockRouterPush).toHaveBeenCalledWith("/shipments");
  });
});
