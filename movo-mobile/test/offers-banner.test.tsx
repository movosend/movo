import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import { OffersBanner } from "../components/shipments/offers-banner";

const mockUseShipmentOffers = jest.fn();

jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
  },
}));

jest.mock("../src/hooks/use-offers", () => ({
  useShipmentOffers: (...args: unknown[]) => mockUseShipmentOffers(...args),
}));

describe("OffersBanner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renderiza estado sin ofertas cuando el contador es 0", async () => {
    mockUseShipmentOffers.mockReturnValue({ data: [], isLoading: false });

    const { getByText, getByTestId } = await render(
      <OffersBanner shipmentId="shipment-1" testID="offers-banner" />
    );

    expect(getByText("Ofertas")).toBeTruthy();
    expect(getByText("Aún no tenés ofertas")).toBeTruthy();
    expect(getByTestId("offers-banner")).toBeTruthy();
  });

  it("renderiza 'Ofertas recibidas (N)' con el conteo cuando hay ofertas", async () => {
    mockUseShipmentOffers.mockReturnValue({
      data: [{ id: "off-1" }, { id: "off-2" }],
      isLoading: false,
    });

    const { getByText } = await render(
      <OffersBanner shipmentId="shipment-1" testID="offers-banner" />
    );

    expect(getByText("Ofertas recibidas (2)")).toBeTruthy();
    expect(getByText("Compará las propuestas y elegí un transportista")).toBeTruthy();
  });

  it("el ícono va en un círculo: lima con ofertas, apagado sin ofertas", async () => {
    mockUseShipmentOffers.mockReturnValue({ data: [{ id: "off-1" }], isLoading: false });
    const withOffers = await render(<OffersBanner shipmentId="shipment-1" testID="offers-banner" />);
    expect(withOffers.getByTestId("offers-banner-icon").props.className).toMatch(/rounded-full.*bg-lime-500/);
    await withOffers.unmount();

    mockUseShipmentOffers.mockReturnValue({ data: [], isLoading: false });
    const withoutOffers = await render(<OffersBanner shipmentId="shipment-1" testID="offers-banner" />);
    expect(withoutOffers.getByTestId("offers-banner-icon").props.className).toMatch(/rounded-full.*bg-bg\b/);
  });

  it("navega a /shipments/:id/offers al presionar el banner", async () => {
    mockUseShipmentOffers.mockReturnValue({ data: [], isLoading: false });

    const { getByTestId } = await render(
      <OffersBanner shipmentId="shipment-123" testID="offers-banner" />
    );

    fireEvent.press(getByTestId("offers-banner"));

    expect(router.push).toHaveBeenCalledWith("/shipments/shipment-123/offers");
  });
});
