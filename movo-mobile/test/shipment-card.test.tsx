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

const mockCurrentUser = jest.fn();
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector?: (state: { user: { userId: string } | null }) => unknown) => {
    const state = { user: mockCurrentUser() };
    return typeof selector === "function" ? selector(state) : state;
  },
}));

// MOVO-127 / MOVO-132: card de "Mis Envíos" — mini-ruta, precio, rol ("Enviás"/"Recibís"), estado y deadline.
describe("ShipmentCard", () => {
  beforeEach(() => {
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
  });
  afterEach(() => jest.clearAllMocks());

  it("muestra origen, destino, estado y ventana horaria", async () => {
    const { getByText, queryByText } = await render(
      <ShipmentCard
        shipment={shipment({ status: ShipmentStatus.IN_TRANSIT, agreedPriceArs: 5200 })}
      />,
    );

    expect(getByText("Av. Colón 1234")).toBeTruthy();
    expect(getByText("Bv. San Juan 500")).toBeTruthy();
    expect(queryByText("$5.200")).toBeNull();
    expect(getByText("En camino")).toBeTruthy();
    expect(getByText(/09:00 a 12:00/)).toBeTruthy();
  });

  it("muestra tag 'Enviás' y 'Esperando al receptor' cuando el usuario es el emisor (MOVO-132)", async () => {
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
    const { getByText, queryByTestId } = await render(
      <ShipmentCard
        shipment={shipment({
          status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
          senderId: "user-1",
          receiverId: "user-2",
        })}
        testID="card-1"
      />,
    );

    expect(getByText("Enviás")).toBeTruthy();
    expect(getByText("Esperando al receptor")).toBeTruthy();
    expect(queryByTestId("card-1-deadline")).toBeNull();
  });

  it("muestra tag 'Recibís', 'Requiere tu confirmación' y deadline cuando el usuario es el receptor (MOVO-132)", async () => {
    mockCurrentUser.mockReturnValue({ userId: "user-2" });
    const futureDeadline = new Date(Date.now() + 36 * 3600 * 1000).toISOString();
    const { getByText, getByTestId } = await render(
      <ShipmentCard
        shipment={shipment({
          status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
          senderId: "user-1",
          receiverId: "user-2",
          receiverConfirmationDeadline: futureDeadline,
        })}
        testID="card-1"
      />,
    );

    expect(getByText("Recibís")).toBeTruthy();
    expect(getByText("Requiere tu confirmación")).toBeTruthy();
    expect(getByTestId("card-1-deadline")).toBeTruthy();
    expect(getByText(/Te quedan \d+ h para confirmar/)).toBeTruthy();
  });

  it("navega al detalle del envío al tocar la card", async () => {
    const { getByTestId } = await render(<ShipmentCard shipment={shipment({ id: "s1" })} testID="card-s1" />);

    await fireEvent.press(getByTestId("card-s1"));

    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/s1");
  });
});
