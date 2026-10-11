import { ApiError } from "@movo/shared/dist/errors/api-error";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import InvitationScreen from "../app/(app)/receiver-transfers/[id]";

const mockRouterReplace = jest.fn();
jest.mock("expo-router", () => ({
  router: {
    replace: (...args: unknown[]) => mockRouterReplace(...args),
    back: jest.fn(),
    canGoBack: () => true,
  },
  useLocalSearchParams: () => ({ id: "tr-1" }),
}));

const mockUseReceiverTransfer = jest.fn();
const mockAccept = jest.fn();
const mockReject = jest.fn();
jest.mock("../src/hooks/use-receiver-transfers", () => ({
  useReceiverTransfer: () => mockUseReceiverTransfer(),
  useAcceptReceiverTransfer: () => ({ mutateAsync: mockAccept, isPending: false }),
  useRejectReceiverTransfer: () => ({ mutateAsync: mockReject, isPending: false }),
}));

jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (state: { user: { userId: string } }) => unknown) =>
    selector({ user: { userId: "martin" } }),
}));

jest.mock("../components/shipments/counterpart-card", () => {
  const { Text } = require("react-native");
  return { CounterpartCard: ({ userId }: { userId: string }) => <Text>{`perfil ${userId}`}</Text> };
});

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: "tr-1",
    shipmentId: "shipment-1",
    requestedBy: "lucia",
    requesterName: "Lucía Gómez",
    newReceiverId: "martin",
    newReceiverName: "Martín López",
    reason: "Esa semana estoy de viaje",
    responseReason: null,
    status: "pending_new_receiver",
    cancelReason: null,
    newReceiverDeadline: new Date(Date.now() + 3 * 3600_000).toISOString(),
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
    shipment: {
      id: "shipment-1",
      status: "in_transit",
      senderId: "juan",
      carrierId: "diego",
      packageType: "standard_package",
      weightKg: 2.5,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
      description: null,
      deliveryAddress: "Av. Colón 1234, Córdoba",
    },
    ...overrides,
  };
}

describe("ReceiverTransferInvitationScreen (MOVO-275)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("muestra quién pide, el motivo, dónde lo recibe, el plazo y las partes", async () => {
    mockUseReceiverTransfer.mockReturnValue({ data: invitation(), isLoading: false, isError: false, refetch: jest.fn() });

    const { getByTestId, getByText } = await render(<InvitationScreen />);

    expect(getByTestId("transfer-invitation-title")).toHaveTextContent("Lucía te pidió que recibas su paquete");
    expect(getByText("“Esa semana estoy de viaje”")).toBeTruthy();
    expect(getByTestId("transfer-invitation-address")).toHaveTextContent("Av. Colón 1234, Córdoba");
    expect(getByTestId("transfer-invitation-deadline")).toHaveTextContent(/para aceptar$/);
    expect(getByText("perfil juan")).toBeTruthy();
    expect(getByText("perfil diego")).toBeTruthy();
  });

  it("aceptar muestra la confirmación y lleva al envío", async () => {
    mockUseReceiverTransfer.mockReturnValue({ data: invitation(), isLoading: false, isError: false, refetch: jest.fn() });
    mockAccept.mockResolvedValue({ id: "tr-1", shipmentId: "shipment-1" });

    const { getByTestId } = await render(<InvitationScreen />);
    await fireEvent.press(getByTestId("transfer-invitation-accept"));

    await waitFor(() => expect(getByTestId("transfer-invitation-accepted")).toBeTruthy());
    expect(mockAccept).toHaveBeenCalledWith({ transferId: "tr-1" });
    await fireEvent.press(getByTestId("transfer-invitation-view-shipment"));
    expect(mockRouterReplace).toHaveBeenCalledWith("/shipments/shipment-1");
  });

  it("rechazar pide confirmación y manda el motivo opcional", async () => {
    const refetch = jest.fn();
    mockUseReceiverTransfer.mockReturnValue({ data: invitation(), isLoading: false, isError: false, refetch });
    mockReject.mockResolvedValue({ id: "tr-1", shipmentId: "shipment-1" });

    const { getByTestId } = await render(<InvitationScreen />);
    await fireEvent.press(getByTestId("transfer-invitation-reject"));
    await fireEvent.changeText(getByTestId("transfer-invitation-reject-reason"), "Ese día trabajo");
    await fireEvent.press(getByTestId("transfer-invitation-reject-confirm"));

    await waitFor(() => expect(mockReject).toHaveBeenCalledWith({ transferId: "tr-1", reason: "Ese día trabajo" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("un error al aceptar (plazo vencido) se muestra y recarga la invitación", async () => {
    const refetch = jest.fn();
    mockUseReceiverTransfer.mockReturnValue({ data: invitation(), isLoading: false, isError: false, refetch });
    mockAccept.mockRejectedValue(new ApiError(409, "SHIPMENT_RECEIVER_TRANSFER_EXPIRED", "x"));

    const { getByTestId, findByText } = await render(<InvitationScreen />);
    await fireEvent.press(getByTestId("transfer-invitation-accept"));

    expect(await findByText("Venció el plazo para aceptar esta invitación.")).toBeTruthy();
    expect(refetch).toHaveBeenCalled();
  });

  it("una invitación cerrada dice por qué y no ofrece aceptar", async () => {
    mockUseReceiverTransfer.mockReturnValue({
      data: invitation({ status: "cancelled", cancelReason: "delivery_started", resolvedAt: new Date().toISOString() }),
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByTestId, queryByTestId } = await render(<InvitationScreen />);

    expect(getByTestId("transfer-invitation-closed")).toHaveTextContent(/La entrega ya empezó/);
    expect(queryByTestId("transfer-invitation-accept")).toBeNull();
  });
});
