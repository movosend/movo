import { fireEvent, render } from "@testing-library/react-native";
import { TripCancelSheet } from "../components/trips/trip-cancel-sheet";

const base = {
  visible: true,
  destination: "Villa María",
  isCancelling: false,
  onConfirm: jest.fn(),
  onClose: jest.fn(),
};

describe("TripCancelSheet (MOVO-263 AC6)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("pregunta por el destino y explica qué pasa al cancelar", async () => {
    const { getByText } = await render(<TripCancelSheet {...base} />);

    expect(getByText("¿Cancelar el viaje a Villa María?")).toBeTruthy();
    expect(
      getByText("Va a pasar a tu historial como cancelado y dejarás de recibir avisos de paquetes compatibles."),
    ).toBeTruthy();
  });

  it("confirmar y volver disparan sus callbacks", async () => {
    const { getByTestId } = await render(<TripCancelSheet {...base} />);

    await fireEvent.press(getByTestId("trip-cancel-confirm"));
    await fireEvent.press(getByTestId("trip-cancel-dismiss"));

    expect(base.onConfirm).toHaveBeenCalled();
    expect(base.onClose).toHaveBeenCalled();
  });

  it("muestra el error adentro del sheet", async () => {
    const { getByTestId } = await render(<TripCancelSheet {...base} errorMessage="Ya tiene paquetes" />);

    expect(getByTestId("trip-cancel-error")).toBeTruthy();
  });

  it("no hace nada al confirmar mientras cancela", async () => {
    const { getByTestId } = await render(<TripCancelSheet {...base} isCancelling />);

    await fireEvent.press(getByTestId("trip-cancel-confirm"));

    expect(base.onConfirm).not.toHaveBeenCalled();
  });
});
