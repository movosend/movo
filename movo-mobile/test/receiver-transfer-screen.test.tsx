import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import ReceiverTransferScreen from "../app/(app)/shipments/[id]/receiver-transfer";

const mockRouterDismissTo = jest.fn();
jest.mock("expo-router", () => ({
  router: {
    replace: jest.fn(),
    dismissTo: (...args: unknown[]) => mockRouterDismissTo(...args),
    back: jest.fn(),
    canGoBack: () => true,
  },
  useLocalSearchParams: () => ({ id: "shipment-1" }),
}));

const mockUseShipment = jest.fn();
jest.mock("../src/hooks/use-shipments", () => ({
  useShipment: () => mockUseShipment(),
}));

const mockMutateAsync = jest.fn();
jest.mock("../src/hooks/use-receiver-transfers", () => ({
  useRequestReceiverTransfer: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (state: { user: { userId: string } }) => unknown) =>
    selector({ user: { userId: "lucia" } }),
}));

// Stub del buscador: deja elegir a alguien y expone qué recibe para excluir/deshabilitar.
const mockSearchProps = jest.fn();
jest.mock("../components/send/receiver-search-field", () => {
  const { Pressable, Text } = require("react-native");
  return {
    ReceiverSearchField: (props: {
      selected: { fullName: string } | null;
      onSelect: (profile: unknown) => void;
      excludeIds?: string[];
      disabledReasons?: Record<string, string>;
    }) => {
      mockSearchProps({ excludeIds: props.excludeIds, disabledReasons: props.disabledReasons });
      return (
        <Pressable
          testID="stub-pick"
          onPress={() => props.onSelect({ id: "martin", fullName: "Martín López", isVerified: true })}
        >
          <Text>{props.selected ? props.selected.fullName : "sin elegir"}</Text>
        </Pressable>
      );
    },
  };
});

function transitShipment(overrides: Record<string, unknown> = {}) {
  return {
    id: "shipment-1",
    senderId: "juan",
    receiverId: "lucia",
    carrierId: "diego",
    status: ShipmentStatus.IN_TRANSIT,
    deliveryAddress: "Av. Colón 1234, Córdoba",
    receiverTransfer: { viewerIsFormerReceiver: false, pending: null, completed: null },
    ...overrides,
  };
}

/** Confirma el `Alert` nativo tocando "Enviar invitación". */
function confirmAlert() {
  const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_title, _msg, buttons) => {
    const send = buttons?.find((b) => b.text === "Enviar invitación");
    void send?.onPress?.();
  });
  return alertSpy;
}

describe("ReceiverTransferScreen (MOVO-275)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("emisor y transportista aparecen deshabilitados con el motivo; uno mismo se excluye", async () => {
    mockUseShipment.mockReturnValue({ data: transitShipment(), isLoading: false, refetch: jest.fn() });

    await render(<ReceiverTransferScreen />);

    expect(mockSearchProps).toHaveBeenLastCalledWith({
      excludeIds: ["lucia"],
      disabledReasons: { juan: "Es el emisor de este envío", diego: "Es el transportista de este envío" },
    });
  });

  it("confirma, manda la invitación con el motivo y vuelve al detalle", async () => {
    mockUseShipment.mockReturnValue({ data: transitShipment(), isLoading: false, refetch: jest.fn() });
    mockMutateAsync.mockResolvedValue({ id: "tr-1" });
    const alertSpy = confirmAlert();

    const { getByTestId } = await render(<ReceiverTransferScreen />);
    await fireEvent.press(getByTestId("stub-pick"));
    await fireEvent.changeText(getByTestId("receiver-transfer-reason"), "  De viaje  ");
    await fireEvent.press(getByTestId("receiver-transfer-submit"));

    await waitFor(() => expect(mockRouterDismissTo).toHaveBeenCalledWith("/shipments/shipment-1"));
    expect(mockMutateAsync).toHaveBeenCalledWith({ shipmentId: "shipment-1", newReceiverId: "martin", reason: "De viaje" });
    expect(alertSpy.mock.calls[0][0]).toBe("¿Pasarle la recepción a Martín?");
  });

  it("un error del backend se muestra sin salir de la pantalla", async () => {
    mockUseShipment.mockReturnValue({ data: transitShipment(), isLoading: false, refetch: jest.fn() });
    mockMutateAsync.mockRejectedValue(new ApiError(409, "SHIPMENT_RECEIVER_TRANSFER_PENDING", "x"));
    confirmAlert();

    const { getByTestId, findByText } = await render(<ReceiverTransferScreen />);
    await fireEvent.press(getByTestId("stub-pick"));
    await fireEvent.press(getByTestId("receiver-transfer-submit"));

    expect(await findByText(/Ya le pediste a alguien que reciba este envío/)).toBeTruthy();
    expect(mockRouterDismissTo).not.toHaveBeenCalled();
  });

  it("sin poder transferir (no es el receptor o ya hay una solicitud), avisa en vez del formulario", async () => {
    mockUseShipment.mockReturnValue({
      data: transitShipment({
        receiverTransfer: {
          viewerIsFormerReceiver: false,
          pending: { id: "tr-1" },
          completed: null,
        },
      }),
      isLoading: false,
      refetch: jest.fn(),
    });

    const { getByTestId, queryByTestId } = await render(<ReceiverTransferScreen />);

    expect(getByTestId("receiver-transfer-unavailable")).toBeTruthy();
    expect(queryByTestId("receiver-transfer-submit")).toBeNull();
  });
});
