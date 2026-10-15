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

    expect(base.onConfirm).toHaveBeenCalledWith(false);
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

  describe("MOVO-266: viaje recurrente", () => {
    it("sin recurring no muestra las opciones", async () => {
      const { queryByTestId } = await render(<TripCancelSheet {...base} />);

      expect(queryByTestId("trip-cancel-option-only")).toBeNull();
    });

    it("ofrece 'Solo este viaje' (default) y 'Este y dejar de repetir'", async () => {
      const { getByTestId, getByText } = await render(
        <TripCancelSheet {...base} recurring={{ weekdayName: "viernes" }} />,
      );

      expect(getByText("Cancelás solo el viaje de este viernes; el del próximo se declara igual.")).toBeTruthy();
      expect(getByTestId("trip-cancel-option-only").props.accessibilityState).toEqual(
        expect.objectContaining({ checked: true }),
      );

      await fireEvent.press(getByTestId("trip-cancel-confirm"));
      expect(base.onConfirm).toHaveBeenLastCalledWith(false);

      await fireEvent.press(getByTestId("trip-cancel-option-stop"));
      await fireEvent.press(getByTestId("trip-cancel-confirm"));
      expect(base.onConfirm).toHaveBeenLastCalledWith(true);
    });
  });
});
