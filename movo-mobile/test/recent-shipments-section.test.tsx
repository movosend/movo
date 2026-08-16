import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { render } from "@testing-library/react-native";
import type { ShipmentSummary } from "../src/api/shipments-client";
import { RecentShipmentsSection } from "../components/home/recent-shipments-section";

const mockUseRecentShipments = jest.fn();

jest.mock("../src/hooks/use-shipments", () => ({
  useRecentShipments: () => mockUseRecentShipments(),
}));

function shipment(overrides: Partial<ShipmentSummary> = {}): ShipmentSummary {
  return {
    id: "shipment-1",
    senderId: "user-1",
    receiverId: "user-2",
    carrierId: null,
    packageType: "standard_package",
    weightKg: 2,
    lengthCm: 20,
    widthCm: 20,
    heightCm: 20,
    description: null,
    urgent: false,
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4,
    pickupLng: -64.18,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.41,
    deliveryLng: -64.19,
    pickupDate: "2026-08-20",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    suggestedPriceArs: 4500,
    agreedPriceArs: null,
    paymentMethod: null,
    status: ShipmentStatus.PUBLISHED,
    lastStatusChangedAt: null,
    deliveredAt: null,
    createdAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    ...overrides,
  };
}

// MOVO-83: sección "Actividad reciente" de Inicio, vista previa de GET /shipments/mine.
describe("RecentShipmentsSection", () => {
  afterEach(() => jest.clearAllMocks());

  it("muestra un indicador de carga mientras el fetch está pendiente", async () => {
    mockUseRecentShipments.mockReturnValue({ isLoading: true, isError: false, data: undefined, refetch: jest.fn() });

    const { getByTestId, queryByText } = await render(<RecentShipmentsSection testID="section" />);

    expect(getByTestId("section")).toBeTruthy();
    expect(queryByText("Todavía no hiciste ningún envío.")).toBeNull();
  });

  it("muestra el estado de error ante un fallo de red", async () => {
    mockUseRecentShipments.mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<RecentShipmentsSection testID="section" />);

    expect(getByText("No pudimos cargar tus envíos.")).toBeTruthy();
  });

  it("muestra el estado vacío cuando no hay envíos todavía", async () => {
    mockUseRecentShipments.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { items: [], page: 1, limit: 3, total: 0 },
      refetch: jest.fn(),
    });

    const { getByText } = await render(<RecentShipmentsSection testID="section" />);

    expect(getByText("Todavía no hiciste ningún envío.")).toBeTruthy();
  });

  it("lista los envíos recientes con su dirección de entrega y estado", async () => {
    mockUseRecentShipments.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        items: [shipment({ id: "s1", status: ShipmentStatus.IN_TRANSIT, agreedPriceArs: 5200 })],
        page: 1,
        limit: 3,
        total: 1,
      },
      refetch: jest.fn(),
    });

    const { getByText } = await render(<RecentShipmentsSection testID="section" />);

    expect(getByText("Bv. San Juan 500, Córdoba")).toBeTruthy();
    expect(getByText("En camino")).toBeTruthy();
    expect(getByText("$5.200")).toBeTruthy();
  });
});
