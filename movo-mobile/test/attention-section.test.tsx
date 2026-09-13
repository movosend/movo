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
});
