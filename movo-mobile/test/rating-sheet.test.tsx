import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { RatingSheet, type RatingTarget } from "../components/shipments/rating-sheet";

const mockMutateAsyncCreate = jest.fn();
const mockMutateAsyncUpdate = jest.fn();

jest.mock("../src/hooks/use-ratings", () => ({
  useCreateRating: () => ({
    mutateAsync: mockMutateAsyncCreate,
    isPending: false,
  }),
  useUpdateRating: () => ({
    mutateAsync: mockMutateAsyncUpdate,
    isPending: false,
  }),
}));

jest.mock("../src/hooks/use-theme-colors", () => ({
  useThemeColors: () => ({
    fg: "#FFFFFF",
    fg1: "#FFFFFF",
    fg2: "#A1A1AA",
    fg3: "#71717A",
    border: "#27272A",
  }),
}));

describe("RatingSheet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const targetNew: RatingTarget = {
    userId: "carrier-1",
    fullName: "Carlos Conductor",
    roleLabel: "Transportista",
  };

  const targetExisting: RatingTarget = {
    userId: "carrier-1",
    fullName: "Carlos Conductor",
    roleLabel: "Transportista",
    existingRating: {
      id: "rating-1",
      shipmentId: "shipment-1",
      raterId: "sender-1",
      rateeId: "carrier-1",
      role: "carrier",
      score: 4,
      comment: "Todo muy bien",
      createdAt: "2026-09-01T12:00:00.000Z",
    },
  };

  it("renderiza correctamente para una nueva calificación", async () => {
    const { getByTestId, getByText } = await render(
      <RatingSheet
        shipmentId="shipment-1"
        target={targetNew}
        visible={true}
        onClose={jest.fn()}
      />
    );

    expect(getByTestId("rating-sheet-title")).toHaveTextContent("Calificar contraparte");
    expect(getByTestId("rating-sheet-subtitle")).toHaveTextContent(
      "Carlos Conductor · Transportista"
    );
    expect(getByText("Tocá una estrella para calificar")).toBeTruthy();
    expect(getByText("Enviar calificación")).toBeTruthy();
  });

  it("permite elegir estrellas, escribir comentario y enviar calificación", async () => {
    const handleClose = jest.fn();
    const handleSuccess = jest.fn();
    mockMutateAsyncCreate.mockResolvedValueOnce({
      id: "rating-new",
      shipmentId: "shipment-1",
      raterId: "sender-1",
      rateeId: "carrier-1",
      role: "carrier",
      score: 5,
      comment: "Excelente servicio",
      createdAt: "2026-09-01T15:00:00.000Z",
    });

    const { getByTestId } = await render(
      <RatingSheet
        shipmentId="shipment-1"
        target={targetNew}
        visible={true}
        onClose={handleClose}
        onSuccess={handleSuccess}
      />
    );

    // Tocar estrella 5
    await fireEvent.press(getByTestId("rating-sheet-stars-star-5"));
    expect(getByTestId("rating-sheet-score-label")).toHaveTextContent("Excelente");

    // Escribir comentario
    await fireEvent.changeText(
      getByTestId("rating-sheet-comment-input"),
      "Excelente servicio"
    );

    // Enviar
    await fireEvent.press(getByTestId("rating-sheet-submit-btn"));

    await waitFor(() => {
      expect(mockMutateAsyncCreate).toHaveBeenCalledWith({
        rateeId: "carrier-1",
        score: 5,
        comment: "Excelente servicio",
      });
      expect(handleSuccess).toHaveBeenCalled();
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it("en modo edición pre-carga los valores y llama a updateMutation", async () => {
    const handleClose = jest.fn();
    mockMutateAsyncUpdate.mockResolvedValueOnce({
      ...targetExisting.existingRating,
      score: 5,
    });

    const { getByTestId } = await render(
      <RatingSheet
        shipmentId="shipment-1"
        target={targetExisting}
        visible={true}
        onClose={handleClose}
      />
    );

    expect(getByTestId("rating-sheet-title")).toHaveTextContent("Editar calificación");
    expect(getByTestId("rating-sheet-score-label")).toHaveTextContent("Muy buena");

    // Cambiar a 5 estrellas
    await fireEvent.press(getByTestId("rating-sheet-stars-star-5"));

    // Guardar cambios
    await fireEvent.press(getByTestId("rating-sheet-submit-btn"));

    await waitFor(() => {
      expect(mockMutateAsyncUpdate).toHaveBeenCalledWith({
        rateeId: "carrier-1",
        input: {
          score: 5,
          comment: "Todo muy bien",
        },
      });
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it("muestra mensaje de error cuando falla el submit", async () => {
    mockMutateAsyncCreate.mockRejectedValueOnce({
      response: {
        data: {
          code: "SHIPMENT_RATING_WINDOW_EXPIRED",
        },
      },
    });

    const { getByTestId } = await render(
      <RatingSheet
        shipmentId="shipment-1"
        target={targetNew}
        visible={true}
        onClose={jest.fn()}
      />
    );

    await fireEvent.press(getByTestId("rating-sheet-stars-star-4"));
    await fireEvent.press(getByTestId("rating-sheet-submit-btn"));

    await waitFor(() => {
      expect(getByTestId("rating-sheet-error")).toBeTruthy();
    });
  });
});
