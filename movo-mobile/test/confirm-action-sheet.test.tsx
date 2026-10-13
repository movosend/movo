import { fireEvent, render } from "@testing-library/react-native";
import { ConfirmActionSheet } from "../components/ui/confirm-action-sheet";

const base = {
  visible: true,
  title: "¿Seguro?",
  description: "Detalle",
  confirmLabel: "Confirmar",
  testID: "sheet",
  onConfirm: jest.fn(),
  onClose: jest.fn(),
};

describe("ConfirmActionSheet", () => {
  beforeEach(() => jest.clearAllMocks());

  it("muestra título, descripción y dispara confirmar y volver", async () => {
    const { getByText, getByTestId } = await render(<ConfirmActionSheet {...base} />);

    expect(getByText("¿Seguro?")).toBeTruthy();
    expect(getByText("Detalle")).toBeTruthy();
    await fireEvent.press(getByTestId("sheet-confirm"));
    await fireEvent.press(getByTestId("sheet-cancel"));
    expect(base.onConfirm).toHaveBeenCalledTimes(1);
    expect(base.onClose).toHaveBeenCalledTimes(1);
  });

  it("mientras está en curso no se puede cerrar ni confirmar de nuevo", async () => {
    const { getByTestId } = await render(<ConfirmActionSheet {...base} isPending />);

    await fireEvent.press(getByTestId("sheet-confirm"));
    await fireEvent.press(getByTestId("sheet-cancel"));
    await fireEvent.press(getByTestId("sheet-backdrop"));
    expect(base.onConfirm).not.toHaveBeenCalled();
    expect(base.onClose).not.toHaveBeenCalled();
  });

  it("oculto no renderiza nada", async () => {
    const { queryByText } = await render(<ConfirmActionSheet {...base} visible={false} />);
    expect(queryByText("¿Seguro?")).toBeNull();
  });
});
