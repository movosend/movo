import { fireEvent, render } from "@testing-library/react-native";
import { AttentionSection } from "../components/home/attention-section";

const mockUseAttentionTasks = jest.fn();

jest.mock("../src/hooks/use-attention-tasks", () => ({
  useAttentionTasks: () => mockUseAttentionTasks(),
}));

describe("AttentionSection (MOVO-193)", () => {
  afterEach(() => jest.clearAllMocks());

  it("no se renderiza sin tareas", async () => {
    mockUseAttentionTasks.mockReturnValue({ tasks: [], isLoading: false });

    const { queryByTestId } = await render(<AttentionSection testID="attention" />);

    expect(queryByTestId("attention")).toBeNull();
  });

  it("lista cada tarea y dispara su acción primaria al tocar el botón", async () => {
    const onPrimary = jest.fn();
    mockUseAttentionTasks.mockReturnValue({
      tasks: [
        { id: "t1", title: "El receptor rechazó tu envío", meta: "San Martín 450", primaryLabel: "Ver envío", onPrimary },
      ],
      isLoading: false,
    });

    const { getByText, getByTestId } = await render(<AttentionSection testID="attention" />);

    expect(getByText("El receptor rechazó tu envío")).toBeTruthy();
    await fireEvent.press(getByTestId("attention-task-t1"));
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });
});
