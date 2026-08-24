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

const mockCurrentUser = jest.fn();
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector?: (state: { user: { userId: string } | null }) => unknown) => {
    const state = { user: mockCurrentUser() };
    return typeof selector === "function" ? selector(state) : state;
  },
}));

jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: (userId: string) => ({
    data: {
      id: userId,
      fullName: userId === "user-1" ? "Pedro Emisor" : "Tomás Olmos",
      photoUrl: null,
      isVerified: true,
      badges: [],
      transactionCounts: { asSender: 0, asCarrier: 0 },
      reputationScore: null,
    },
    isLoading: false,
    isError: false,
  }),
}));

// MOVO-127 / MOVO-132: fila usada por el preview de Home ("Actividad reciente").
describe("ShipmentRow", () => {
  beforeEach(() => {
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
  });
  afterEach(() => jest.clearAllMocks());

  it("muestra 'Envío a [Nombre]' y estado cuando el usuario es el emisor", async () => {
    const { getByText, queryByText } = await render(
      <ShipmentRow
        shipment={shipment({
          status: ShipmentStatus.IN_TRANSIT,
          senderId: "user-1",
          receiverId: "user-2",
        })}
        isFirst
      />,
    );

    expect(getByText("Envío a Tomás")).toBeTruthy();
    expect(getByText("En camino")).toBeTruthy();
    expect(queryByText("Bv. San Juan 500, Córdoba")).toBeNull();
  });

  it("muestra 'Envío de [Nombre]' y 'Requiere tu confirmación' cuando el usuario es el receptor", async () => {
    mockCurrentUser.mockReturnValue({ userId: "user-2" });
    const { getByText } = await render(
      <ShipmentRow
        shipment={shipment({
          status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
          senderId: "user-1",
          receiverId: "user-2",
        })}
        isFirst
      />,
    );

    expect(getByText("Envío de Pedro")).toBeTruthy();
    expect(getByText("Requiere tu confirmación")).toBeTruthy();
  });

  it("navega al detalle del envío al tocar la fila", async () => {
    const { getByTestId } = await render(
      <ShipmentRow shipment={shipment({ id: "s1" })} isFirst testID="row-s1" />,
    );

    await fireEvent.press(getByTestId("row-s1"));

    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/s1");
  });
});
