import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import ChangeReceiverScreen from "../app/(app)/shipments/[id]/change-receiver";

const mockRouterReplace = jest.fn();
jest.mock("expo-router", () => ({
  router: {
    replace: (...args: unknown[]) => mockRouterReplace(...args),
    back: jest.fn(),
    canGoBack: () => true,
  },
  useLocalSearchParams: () => ({ id: "shipment-1" }),
}));

const mockUseShipment = jest.fn();
const mockMutateAsync = jest.fn();
const mockRefetch = jest.fn();
jest.mock("../src/hooks/use-shipments", () => ({
  useShipment: () => mockUseShipment(),
  useShipmentEvents: () => ({
    data: [
      {
        id: "e1",
        shipmentId: "shipment-1",
        fromStatus: "awaiting_receiver_confirmation",
        toStatus: "rejected_by_receiver",
        actorId: "rejecter-1",
        reason: null,
        createdAt: "2026-09-25T10:00:00.000Z",
      },
    ],
  }),
  useRedesignateReceiver: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (state: { user: { userId: string } }) => unknown) =>
    selector({ user: { userId: "sender-1" } }),
}));

// El buscador real pega contra `GET /users/search`; acá alcanza con un stub que
// permita elegir a alguien y exponga qué ids recibe para excluir.
const mockExcludeIds = jest.fn();
jest.mock("../components/send/receiver-search-field", () => {
  const { Pressable, Text } = require("react-native");
  return {
    ReceiverSearchField: (props: {
      selected: { fullName: string } | null;
      onSelect: (profile: unknown) => void;
      excludeIds?: string[];
    }) => {
      mockExcludeIds(props.excludeIds);
      return (
        <Pressable
          testID="stub-pick-receiver"
          onPress={() => props.onSelect({ id: "receiver-2", fullName: "Pedro", isVerified: true })}
        >
          <Text>{props.selected ? props.selected.fullName : "sin elegir"}</Text>
        </Pressable>
      );
    },
  };
});

function rejectedShipment(overrides: Record<string, unknown> = {}) {
  return {
    id: "shipment-1",
    senderId: "sender-1",
    receiverId: "rejecter-1",
    status: ShipmentStatus.REJECTED_BY_RECEIVER,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    receiverRedesignationDeadline: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

describe("ChangeReceiverScreen (MOVO-253)", () => {
  afterEach(() => jest.clearAllMocks());

  it("excluye a quien ya rechazó y a uno mismo, y el botón se habilita al elegir", async () => {
    mockUseShipment.mockReturnValue({ data: rejectedShipment(), isLoading: false, refetch: mockRefetch });

    const { getByTestId } = await render(<ChangeReceiverScreen />);

    expect(mockExcludeIds).toHaveBeenLastCalledWith(["rejecter-1", "sender-1"]);
    expect(getByTestId("change-receiver-deadline")).toHaveTextContent(/^Tenés hasta/);
    expect(getByTestId("change-receiver-submit")).toBeDisabled();

    await fireEvent.press(getByTestId("stub-pick-receiver"));
    expect(getByTestId("change-receiver-submit")).toBeEnabled();
  });

  it("al confirmar, cambia el receptor y vuelve al detalle", async () => {
    mockUseShipment.mockReturnValue({ data: rejectedShipment(), isLoading: false, refetch: mockRefetch });
    mockMutateAsync.mockResolvedValue({});

    const { getByTestId } = await render(<ChangeReceiverScreen />);
    await fireEvent.press(getByTestId("stub-pick-receiver"));
    await fireEvent.press(getByTestId("change-receiver-submit"));

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({ id: "shipment-1", receiverId: "receiver-2" }),
    );
    expect(mockRouterReplace).toHaveBeenCalledWith("/shipments/shipment-1");
  });

  it("muestra el error traducido y refresca el envío si el backend rechaza", async () => {
    mockUseShipment.mockReturnValue({ data: rejectedShipment(), isLoading: false, refetch: mockRefetch });
    mockMutateAsync.mockRejectedValue(
      new ApiError(422, "SHIPMENT_RECEIVER_ALREADY_REJECTED", "ya rechazó"),
    );

    const { getByTestId, findByTestId } = await render(<ChangeReceiverScreen />);
    await fireEvent.press(getByTestId("stub-pick-receiver"));
    await fireEvent.press(getByTestId("change-receiver-submit"));

    expect(await findByTestId("change-receiver-error")).toHaveTextContent(
      "Esta persona ya rechazó este envío. Elegí a otra.",
    );
    expect(mockRefetch).toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it("con el plazo vencido o el envío en otro estado, no ofrece elegir", async () => {
    mockUseShipment.mockReturnValue({
      data: rejectedShipment({ receiverRedesignationDeadline: new Date(Date.now() - 1000).toISOString() }),
      isLoading: false,
      refetch: mockRefetch,
    });

    const { getByTestId, queryByTestId } = await render(<ChangeReceiverScreen />);

    expect(getByTestId("change-receiver-unavailable")).toBeTruthy();
    expect(queryByTestId("change-receiver-submit")).toBeNull();
  });
});
