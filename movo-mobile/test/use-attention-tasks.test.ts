import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { renderHook } from "@testing-library/react-native";
import { useAttentionTasks } from "../src/hooks/use-attention-tasks";

const mockUseAttentionSourceShipments = jest.fn();
const mockPush = jest.fn();
const mockUsePublicProfiles = jest.fn();
const mockUseInvitations = jest.fn((): { data: unknown[] } => ({ data: [] }));

jest.mock("../src/hooks/use-receiver-transfers", () => ({
  useShipmentReceiverTransfers: jest.fn(() => ({ data: [] })),
  useReceiverTransferInvitations: () => mockUseInvitations(),
  useCancelReceiverTransfer: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
}));

jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

jest.mock("../src/hooks/use-shipments", () => ({
  useAttentionSourceShipments: () => mockUseAttentionSourceShipments(),
}));

jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfiles: (ids: string[]) => mockUsePublicProfiles(ids),
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
  beforeEach(() => {
    mockUsePublicProfiles.mockReturnValue([]);
  });

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
            senderId: "sender-1",
            receiverId: "me",
            status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
          }),
        ],
      },
      isLoading: false,
    });

    const { result } = await renderHook(() => useAttentionTasks());

    expect(result.current.tasks).toHaveLength(1);
    expect(mockUsePublicProfiles).toHaveBeenCalledWith(["sender-1"]);
    const task = result.current.tasks[0];
    expect(task.kind).toBe("confirm");
    expect(task.title).toBe("Tenés un envío para confirmar");
    if (task.kind !== "confirm") throw new Error("expected confirm task");
    expect(task.shipmentId).toBe("s1");
    expect(task.meta).toContain("San Martín 450");
    expect(task.meta).not.toContain("Córdoba 1200");

    task.onPress();
    expect(mockPush).toHaveBeenCalledWith("/shipments/s1");
  });

  it("usa el primer nombre real del emisor en el título cuando el perfil ya cargó", async () => {
    mockUsePublicProfiles.mockReturnValue([{ data: { fullName: "Julia Fernández" } }]);
    mockUseAttentionSourceShipments.mockReturnValue({
      data: {
        items: [
          shipment({
            id: "s1",
            senderId: "sender-1",
            receiverId: "me",
            status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
          }),
        ],
      },
      isLoading: false,
    });

    const { result } = await renderHook(() => useAttentionTasks());
    const task = result.current.tasks[0];
    if (task.kind !== "confirm") throw new Error("expected confirm task");

    expect(task.title).toBe("Julia te quiere enviar un paquete");
    expect(task.senderFirstName).toBe("Julia");
  });

  it("MOVO-253: arma la tarea de rechazo con motivo, plazo y la acción de elegir otro receptor", async () => {
    mockUsePublicProfiles.mockReturnValue([{ data: { fullName: "Lucía Gómez" } }]);
    mockUseAttentionSourceShipments.mockReturnValue({
      data: {
        items: [
          shipment({
            id: "s2",
            senderId: "me",
            receiverId: "rejecter-1",
            status: ShipmentStatus.REJECTED_BY_RECEIVER,
            rejectionReason: "No estoy en la ciudad",
            receiverRedesignationDeadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          }),
        ],
      },
      isLoading: false,
    });

    const { result } = await renderHook(() => useAttentionTasks());

    expect(result.current.tasks).toHaveLength(1);
    expect(mockUsePublicProfiles).toHaveBeenCalledWith(["rejecter-1"]);
    const task = result.current.tasks[0];
    if (task.kind !== "rejected") throw new Error("expected rejected task");
    expect(task.title).toBe("Lucía rechazó tu envío");
    expect(task.reason).toBe("No estoy en la ciudad");
    expect(task.deadlineLabel).toMatch(/^Tenés hasta/);

    task.onChooseReceiver();
    expect(mockPush).toHaveBeenCalledWith("/shipments/s2/change-receiver");
  });

  it("MOVO-253 AC5: con el plazo vencido o nulo, la tarea de rechazo desaparece", async () => {
    mockUseAttentionSourceShipments.mockReturnValue({
      data: {
        items: [
          shipment({
            id: "vencido",
            senderId: "me",
            status: ShipmentStatus.REJECTED_BY_RECEIVER,
            receiverRedesignationDeadline: new Date(Date.now() - 1000).toISOString(),
          }),
          shipment({
            id: "previo-a-movo-253",
            senderId: "me",
            status: ShipmentStatus.REJECTED_BY_RECEIVER,
            receiverRedesignationDeadline: null,
          }),
        ],
      },
      isLoading: false,
    });

    const { result } = await renderHook(() => useAttentionTasks());

    expect(result.current.tasks).toEqual([]);
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

  it("arma una tarea de ofertas para un envío propio publicado con ofertas pendientes (MOVO-184 AC5)", async () => {
    mockUseAttentionSourceShipments.mockReturnValue({
      data: {
        items: [
          shipment({ id: "una", senderId: "me", status: ShipmentStatus.PUBLISHED, pendingOffersCount: 1 }),
          shipment({ id: "varias", senderId: "me", status: ShipmentStatus.PUBLISHED, pendingOffersCount: 3 }),
        ],
      },
      isLoading: false,
    });

    const { result } = await renderHook(() => useAttentionTasks());

    expect(result.current.tasks).toMatchObject([
      { kind: "info", id: "offers-una", icon: "offers", title: "Recibiste una oferta", primaryLabel: "Ver ofertas" },
      { kind: "info", id: "offers-varias", title: "Recibiste 3 ofertas" },
    ]);
    const [task] = result.current.tasks;
    if (task.kind !== "info") throw new Error("esperaba una tarea info");
    task.onPress();
    expect(mockPush).toHaveBeenLastCalledWith("/shipments/una");
    task.onPrimary();
    expect(mockPush).toHaveBeenLastCalledWith("/shipments/una/offers");
  });

  it("no arma tarea de ofertas sin ofertas pendientes ni si el envío publicado no es propio", async () => {
    mockUseAttentionSourceShipments.mockReturnValue({
      data: {
        items: [
          shipment({ id: "sin", senderId: "me", status: ShipmentStatus.PUBLISHED, pendingOffersCount: 0 }),
          shipment({ id: "nulo", senderId: "me", status: ShipmentStatus.PUBLISHED, pendingOffersCount: null }),
          shipment({ id: "ajeno", senderId: "otro", receiverId: "me", status: ShipmentStatus.PUBLISHED, pendingOffersCount: 2 }),
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

  it("MOVO-275 AC8: arma la invitación para recibir con el plazo; una vencida no se lista", async () => {
    mockUseAttentionSourceShipments.mockReturnValue({ data: { items: [] }, isLoading: false });
    const invitation = (id: string, deadline: string) => ({
      id,
      shipmentId: `s-${id}`,
      requestedBy: "lucia",
      requesterName: "Lucía Gómez",
      newReceiverId: "me",
      newReceiverName: "Yo",
      reason: null,
      responseReason: null,
      status: "pending_new_receiver",
      cancelReason: null,
      newReceiverDeadline: deadline,
      createdAt: "2026-10-10T12:00:00.000Z",
      resolvedAt: null,
      resolvedBy: null,
      shipment: { id: `s-${id}`, deliveryAddress: "Av. Colón 1234, Córdoba" },
    });
    mockUseInvitations.mockReturnValue({
      data: [
        invitation("tr-1", new Date(Date.now() + 3 * 3600_000).toISOString()),
        invitation("tr-old", new Date(Date.now() - 60_000).toISOString()),
      ],
    });

    const { result } = await renderHook(() => useAttentionTasks());

    expect(result.current.tasks).toHaveLength(1);
    const task = result.current.tasks[0];
    expect(task).toMatchObject({
      kind: "transfer_invite",
      transferId: "tr-1",
      title: "Lucía te pidió que recibas un paquete",
      meta: "Recibís en Av. Colón 1234",
    });
    task.onPress();
    expect(mockPush).toHaveBeenCalledWith("/receiver-transfers/tr-1");
    mockUseInvitations.mockReturnValue({ data: [] });
  });
});
