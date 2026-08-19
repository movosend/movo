import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render } from "@testing-library/react-native";
import type { ShipmentSummary } from "../src/api/shipments-client";
import { ShipmentRow } from "../components/shipments/shipment-row";

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

// MOVO-127: fila reusada por el preview de Home y el listado completo "Mis Envíos".
describe("ShipmentRow", () => {
  afterEach(() => jest.clearAllMocks());

  it("muestra dirección de entrega, precio y estado", async () => {
    const { getByText } = await render(
      <ShipmentRow
        shipment={shipment({ status: ShipmentStatus.IN_TRANSIT, agreedPriceArs: 5200 })}
        isFirst
      />,
    );

    expect(getByText("Bv. San Juan 500, Córdoba")).toBeTruthy();
    expect(getByText("En camino")).toBeTruthy();
    expect(getByText("$5.200")).toBeTruthy();
  });

  it("navega al detalle del envío al tocar la fila", async () => {
    const { getByTestId } = await render(
      <ShipmentRow shipment={shipment({ id: "s1" })} isFirst testID="row-s1" />,
    );

    await fireEvent.press(getByTestId("row-s1"));

    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/s1");
  });
});
