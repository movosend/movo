import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render } from "@testing-library/react-native";
import type { ShipmentSummary } from "../src/api/shipments-client";
import { ShipmentCard } from "../components/shipments/shipment-card";

const mockRouterPush = jest.fn();

jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
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

// MOVO-127: card de "Mis Envíos" — mini-ruta (origen/destino), precio, estado y ventana horaria.
describe("ShipmentCard", () => {
  afterEach(() => jest.clearAllMocks());

  it("muestra origen, destino, precio, estado y ventana horaria", async () => {
    const { getByText } = await render(
      <ShipmentCard
        shipment={shipment({ status: ShipmentStatus.IN_TRANSIT, agreedPriceArs: 5200 })}
      />,
    );

    expect(getByText("Av. Colón 1234")).toBeTruthy();
    expect(getByText("Bv. San Juan 500")).toBeTruthy();
    expect(getByText("$5.200")).toBeTruthy();
    expect(getByText("En camino")).toBeTruthy();
    expect(getByText(/09:00 a 12:00/)).toBeTruthy();
  });

  it("navega al detalle del envío al tocar la card", async () => {
    const { getByTestId } = await render(<ShipmentCard shipment={shipment({ id: "s1" })} testID="card-s1" />);

    await fireEvent.press(getByTestId("card-s1"));

    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/s1");
  });
});
