import { fireEvent, render } from "@testing-library/react-native";
import { AttentionSection } from "../components/home/attention-section";

const mockUseAttentionTasks = jest.fn();

jest.mock("../src/hooks/use-attention-tasks", () => ({
  useAttentionTasks: () => mockUseAttentionTasks(),
}));

const mockMutateAccept = jest.fn();
const mockMutateReject = jest.fn();

jest.mock("../src/hooks/use-shipments", () => ({
  useAcceptShipment: () => ({ mutateAsync: mockMutateAccept, isPending: false }),
  useRejectShipment: () => ({ mutateAsync: mockMutateReject, isPending: false }),
}));

const mockRouterPush = jest.fn();

jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
}));

describe("AttentionSection (MOVO-193)", () => {
  afterEach(() => jest.clearAllMocks());

  it("no se renderiza sin tareas", async () => {
    mockUseAttentionTasks.mockReturnValue({ tasks: [], isLoading: false });

    const { queryByTestId } = await render(<AttentionSection testID="attention" />);

    expect(queryByTestId("attention")).toBeNull();
  });

  it("una tarea info navega al detalle al tocar la card o el botón", async () => {
    const onPress = jest.fn();
    const onPrimary = jest.fn();
    mockUseAttentionTasks.mockReturnValue({
      tasks: [
        {
          kind: "info",
          id: "t1",
          title: "El receptor rechazó tu envío",
          meta: "San Martín 450",
          onPress,
          primaryLabel: "Ver envío",
          onPrimary,
        },
      ],
      isLoading: false,
    });

    const { getByText, getByTestId } = await render(<AttentionSection testID="attention" />);

    expect(getByText("El receptor rechazó tu envío")).toBeTruthy();
    await fireEvent.press(getByTestId("attention-task-t1-primary"));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("una tarea de confirmación muestra Rechazar/Aceptar y abre el sheet real de confirmación", async () => {
    const onPress = jest.fn();
    mockUseAttentionTasks.mockReturnValue({
      tasks: [
        {
          kind: "confirm",
          id: "t2",
          shipmentId: "shipment-1",
          senderFirstName: "Julia",
          title: "Julia te quiere enviar un paquete",
          meta: "Recibís en Av. Rivadavia 5400 · vence en 22 h",
          onPress,
        },
      ],
      isLoading: false,
    });

    const { getByText, getByTestId } = await render(<AttentionSection testID="attention" />);

    expect(getByText("Julia te quiere enviar un paquete")).toBeTruthy();

    await fireEvent.press(getByTestId("attention-task-t2-primary"));
    expect(getByTestId("attention-task-t2-accept-modal")).toBeTruthy();
    expect(getByText("¿Aceptar este envío?")).toBeTruthy();

    expect(onPress).not.toHaveBeenCalled();
  });

  it("tocar la card fuera de los botones navega al detalle", async () => {
    const onPress = jest.fn();
    mockUseAttentionTasks.mockReturnValue({
      tasks: [
        {
          kind: "confirm",
          id: "t3",
          shipmentId: "shipment-1",
          title: "Tenés un envío para confirmar",
          meta: "Recibís en Av. Rivadavia 5400",
          onPress,
        },
      ],
      isLoading: false,
    });

    const { getByTestId } = await render(<AttentionSection testID="attention" />);

    await fireEvent.press(getByTestId("attention-task-t3"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("el modal de éxito de aceptar sobrevive a que la tarea desaparezca tras el refetch (regresión de review)", async () => {
    mockMutateAccept.mockResolvedValue({ id: "shipment-1", status: "published" });
    mockUseAttentionTasks.mockReturnValue({
      tasks: [
        {
          kind: "confirm",
          id: "t2",
          shipmentId: "shipment-1",
          senderFirstName: "Julia",
          title: "Julia te quiere enviar un paquete",
          meta: "Recibís en Av. Rivadavia 5400 · vence en 22 h",
          onPress: jest.fn(),
        },
      ],
      isLoading: false,
    });

    const { getByTestId, queryByTestId, rerender } = await render(
      <AttentionSection testID="attention" />,
    );

    await fireEvent.press(getByTestId("attention-task-t2-primary"));
    await fireEvent.press(getByTestId("attention-task-t2-accept-confirm-button"));

    expect(getByTestId("attention-accept-success-modal")).toBeTruthy();

    // El accept invalidó ["shipments","mine"]: la tarea ya no vuelve en el próximo
    // refetch, así que `AttentionConfirmCard` se desmonta — el modal, montado en
    // `AttentionTaskList` (el padre), tiene que sobrevivir a eso.
    mockUseAttentionTasks.mockReturnValue({ tasks: [], isLoading: false });
    await rerender(<AttentionSection testID="attention" />);

    expect(getByTestId("attention-accept-success-modal").props.visible).toBe(true);

    await fireEvent.press(getByTestId("attention-accept-success-modal-view-button"));

    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shipment-1");
    expect(queryByTestId("attention-accept-success-modal")).toBeNull();
  });
});
