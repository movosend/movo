import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { renderHook } from "@testing-library/react-native";
import { useAttentionTasks } from "../src/hooks/use-attention-tasks";

const mockUseAttentionSourceShipments = jest.fn();
const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

jest.mock("../src/hooks/use-shipments", () => ({
  useAttentionSourceShipments: () => mockUseAttentionSourceShipments(),
}));

jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (s: { user: { userId: string } }) => unknown) =>
    selector({ user: { userId: "me" } }),
}));

function shipment(overrides: Record<string, unknown>) {
  return {
    id: "s1",
    senderId: "sender-1",
    receiverId: "receiver-1",
    carrierId: null,
    pickupAddress: "Córdoba 1200, Córdoba",
    deliveryAddress: "San Martín 450, Córdoba",
    ...overrides,
  };
}

describe("useAttentionTasks (MOVO-193)", () => {
  afterEach(() => jest.clearAllMocks());

  it("sin datos, no arma ninguna tarea", async () => {
    mockUseAttentionSourceShipments.mockReturnValue({ data: undefined, isLoading: true });

    const { result } = await renderHook(() => useAttentionTasks());

    expect(result.current.tasks).toEqual([]);
  });

  it("arma una tarea de confirmación si el usuario es el receptor en awaiting_receiver_confirmation", async () => {
    mockUseAttentionSourceShipments.mockReturnValue({
      data: {
        items: [
          shipment({
            id: "s1",
            receiverId: "me",
            status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
          }),
        ],
      },
      isLoading: false,
    });

    const { result } = await renderHook(() => useAttentionTasks());

    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].title).toBe("Tenés un envío para confirmar");
    result.current.tasks[0].onPrimary();
    expect(mockPush).toHaveBeenCalledWith("/shipments/s1");
  });

  it("arma una tarea de receptor rechazado si el usuario es el emisor", async () => {
    mockUseAttentionSourceShipments.mockReturnValue({
      data: {
        items: [
          shipment({
            id: "s2",
            senderId: "me",
            status: ShipmentStatus.REJECTED_BY_RECEIVER,
          }),
        ],
      },
      isLoading: false,
    });

    const { result } = await renderHook(() => useAttentionTasks());

    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].title).toBe("El receptor rechazó tu envío");
  });

  it("ignora envíos donde el usuario no es la parte relevante para ese estado", async () => {
    mockUseAttentionSourceShipments.mockReturnValue({
      data: {
        items: [
          shipment({
            id: "s3",
            receiverId: "otro",
            status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
          }),
          shipment({
            id: "s4",
            senderId: "otro",
            status: ShipmentStatus.REJECTED_BY_RECEIVER,
          }),
        ],
      },
      isLoading: false,
    });

    const { result } = await renderHook(() => useAttentionTasks());

    expect(result.current.tasks).toEqual([]);
  });

  it("ignora estados que no generan tarea (ej. in_transit)", async () => {
    mockUseAttentionSourceShipments.mockReturnValue({
      data: { items: [shipment({ id: "s5", senderId: "me", status: ShipmentStatus.IN_TRANSIT })] },
      isLoading: false,
    });

    const { result } = await renderHook(() => useAttentionTasks());

    expect(result.current.tasks).toEqual([]);
  });
});
