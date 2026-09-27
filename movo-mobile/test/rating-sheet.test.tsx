import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { RatingSheet, type RatingTarget } from "../components/shipments/rating-sheet";

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

/** El sheet muestra la confirmación (tilde + vibración) ~1.1s antes de cerrar. */
async function flushSuccessMoment() {
  await act(async () => {
    jest.advanceTimersByTime(1200);
  });
}

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
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const targetNew: RatingTarget = {
    userId: "carrier-1",
    fullName: "Carlos Conductor",
    roleLabel: "Transportista",
    rateeRole: "carrier",
  };

  const targetExisting: RatingTarget = {
    userId: "carrier-1",
    fullName: "Carlos Conductor",
    roleLabel: "Transportista",
    rateeRole: "carrier",
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
      // MOVO-173: la estrella general autocompleta las 3 categorías del transportista.
      expect(mockMutateAsyncCreate).toHaveBeenCalledWith({
        rateeId: "carrier-1",
        score: 5,
        comment: "Excelente servicio",
        punctualityScore: 5,
        careScore: 5,
        communicationScore: 5,
      });
    });
    await flushSuccessMoment();
    expect(handleSuccess).toHaveBeenCalled();
    expect(handleClose).toHaveBeenCalled();
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
          // La calificación editada no tenía categorías: el nuevo puntaje general las autocompleta.
          punctualityScore: 5,
          careScore: 5,
          communicationScore: 5,
        },
      });
    });
    await flushSuccessMoment();
    expect(handleClose).toHaveBeenCalled();
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
  it("muestra la foto de la persona calificada en vez de sus iniciales", async () => {
    const { getByTestId, queryByText } = await render(
      <RatingSheet
        shipmentId="shipment-1"
        target={{ ...targetNew, photoUrl: "https://cdn.example.com/carlos.jpg" }}
        visible={true}
        onClose={jest.fn()}
      />
    );

    expect(getByTestId("rating-sheet-avatar")).toBeTruthy();
    // Con foto, `AvatarImage` renderiza la imagen y no el fallback de iniciales.
    expect(queryByText("CC")).toBeNull();
  });

  it("sin foto muestra las iniciales de la persona calificada", async () => {
    const { getByTestId, getByText } = await render(
      <RatingSheet shipmentId="shipment-1" target={targetNew} visible={true} onClose={jest.fn()} />
    );

    expect(getByTestId("rating-sheet-avatar")).toBeTruthy();
    expect(getByText("CC")).toBeTruthy();
  });

  describe("confirmación al enviar (MOVO-173)", () => {
    const created = {
      id: "rating-new",
      shipmentId: "shipment-1",
      raterId: "sender-1",
      rateeId: "carrier-1",
      role: "carrier" as const,
      score: 5,
      comment: null,
      createdAt: "2026-09-01T15:00:00.000Z",
    };

    async function submitFiveStars(onClose = jest.fn(), onSuccess = jest.fn()) {
      mockMutateAsyncCreate.mockResolvedValueOnce(created);
      const utils = await render(
        <RatingSheet shipmentId="shipment-1" target={targetNew} visible={true} onClose={onClose} onSuccess={onSuccess} />
      );
      await fireEvent.press(utils.getByTestId("rating-sheet-stars-star-5"));
      await fireEvent.press(utils.getByTestId("rating-sheet-submit-btn"));
      await waitFor(() => expect(mockMutateAsyncCreate).toHaveBeenCalled());
      return { ...utils, onClose, onSuccess };
    }

    it("vibra y muestra el tilde en lugar del formulario", async () => {
      const { getByTestId, getByText, queryByTestId } = await submitFiveStars();

      expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
      expect(getByTestId("rating-sheet-success")).toBeTruthy();
      expect(getByText("¡Gracias por calificar!")).toBeTruthy();
      expect(queryByTestId("rating-sheet-submit-btn")).toBeNull();
    });

    it("no cierra ni avisa hasta que termina la confirmación", async () => {
      const { onClose, onSuccess } = await submitFiveStars();

      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      expect(onClose).not.toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();

      await flushSuccessMoment();
      expect(onSuccess).toHaveBeenCalledWith(created);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("no se puede cerrar tocando el fondo mientras se ve la confirmación", async () => {
      const { getByTestId, onClose } = await submitFiveStars();

      await fireEvent.press(getByTestId("rating-sheet-backdrop"));
      expect(onClose).not.toHaveBeenCalled();
    });

    it("en edición el mensaje es de calificación actualizada", async () => {
      mockMutateAsyncUpdate.mockResolvedValueOnce(created);
      const { getByTestId, getByText } = await render(
        <RatingSheet shipmentId="shipment-1" target={targetExisting} visible={true} onClose={jest.fn()} />
      );
      await fireEvent.press(getByTestId("rating-sheet-submit-btn"));
      await waitFor(() => expect(mockMutateAsyncUpdate).toHaveBeenCalled());

      expect(getByText("¡Calificación actualizada!")).toBeTruthy();
    });

    it("si el envío falla no vibra ni muestra la confirmación", async () => {
      mockMutateAsyncCreate.mockRejectedValueOnce({ response: { data: { code: "SHIPMENT_RATING_WINDOW_EXPIRED" } } });
      const { getByTestId, queryByTestId } = await render(
        <RatingSheet shipmentId="shipment-1" target={targetNew} visible={true} onClose={jest.fn()} />
      );
      await fireEvent.press(getByTestId("rating-sheet-stars-star-4"));
      await fireEvent.press(getByTestId("rating-sheet-submit-btn"));

      await waitFor(() => expect(getByTestId("rating-sheet-error")).toBeTruthy());
      expect(Haptics.notificationAsync).not.toHaveBeenCalled();
      expect(queryByTestId("rating-sheet-success")).toBeNull();
    });
  });

  describe("categorías por rol (MOVO-173)", () => {
    const targetSender: RatingTarget = {
      userId: "sender-1",
      fullName: "Sofía Emisora",
      roleLabel: "Emisor",
      rateeRole: "sender",
    };
    const targetReceiver: RatingTarget = {
      userId: "receiver-1",
      fullName: "Rafa Receptor",
      roleLabel: "Receptor",
      rateeRole: "receiver",
    };
    const createdRating = {
      id: "rating-new",
      shipmentId: "shipment-1",
      raterId: "user-1",
      rateeId: "carrier-1",
      role: "carrier" as const,
      score: 5,
      comment: null,
      createdAt: "2026-09-01T15:00:00.000Z",
    };

    it("al calificar a un transportista pide puntualidad, cuidado y comunicación", async () => {
      const { getByTestId, getByText, queryByTestId } = await render(
        <RatingSheet shipmentId="shipment-1" target={targetNew} visible={true} onClose={jest.fn()} />
      );

      expect(getByText("Puntualidad")).toBeTruthy();
      expect(getByText("Cuidado del paquete")).toBeTruthy();
      expect(getByText("Comunicación")).toBeTruthy();
      expect(getByTestId("rating-sheet-category-punctuality")).toBeTruthy();
      expect(getByTestId("rating-sheet-category-care")).toBeTruthy();
      expect(getByTestId("rating-sheet-category-communication")).toBeTruthy();
      expect(queryByTestId("rating-sheet-category-package_ready")).toBeNull();
    });

    it("al calificar a un emisor pide puntualidad y comunicación", async () => {
      const { getByTestId, getByText, queryByTestId } = await render(
        <RatingSheet shipmentId="shipment-1" target={targetSender} visible={true} onClose={jest.fn()} />
      );

      expect(getByText("Puntualidad")).toBeTruthy();
      expect(getByText("Comunicación")).toBeTruthy();
      expect(getByTestId("rating-sheet-category-punctuality")).toBeTruthy();
      expect(getByTestId("rating-sheet-category-communication")).toBeTruthy();
      // "Cuidado del paquete" es solo del transportista.
      expect(queryByTestId("rating-sheet-category-care")).toBeNull();
    });

    it("al calificar a un receptor pide exactamente las mismas categorías que al emisor", async () => {
      const { getByTestId, queryByTestId, getByText } = await render(
        <RatingSheet shipmentId="shipment-1" target={targetReceiver} visible={true} onClose={jest.fn()} />
      );

      expect(getByText("Detalle de la experiencia (opcional)")).toBeTruthy();
      expect(getByTestId("rating-sheet-category-punctuality")).toBeTruthy();
      expect(getByTestId("rating-sheet-category-communication")).toBeTruthy();
      expect(queryByTestId("rating-sheet-category-care")).toBeNull();
    });

    it("la estrella general autocompleta las categorías con el mismo valor", async () => {
      mockMutateAsyncCreate.mockResolvedValueOnce(createdRating);
      const { getByTestId } = await render(
        <RatingSheet shipmentId="shipment-1" target={targetNew} visible={true} onClose={jest.fn()} />
      );

      await fireEvent.press(getByTestId("rating-sheet-stars-star-5"));
      await fireEvent.press(getByTestId("rating-sheet-submit-btn"));

      await waitFor(() => {
        expect(mockMutateAsyncCreate).toHaveBeenCalledWith({
          rateeId: "carrier-1",
          score: 5,
          punctualityScore: 5,
          careScore: 5,
          communicationScore: 5,
        });
      });
    });

    it("cambiar el puntaje general re-autocompleta mientras no toques ninguna categoría", async () => {
      mockMutateAsyncCreate.mockResolvedValueOnce(createdRating);
      const { getByTestId } = await render(
        <RatingSheet shipmentId="shipment-1" target={targetNew} visible={true} onClose={jest.fn()} />
      );

      await fireEvent.press(getByTestId("rating-sheet-stars-star-5"));
      await fireEvent.press(getByTestId("rating-sheet-stars-star-3"));
      await fireEvent.press(getByTestId("rating-sheet-submit-btn"));

      await waitFor(() => {
        expect(mockMutateAsyncCreate).toHaveBeenCalledWith(
          expect.objectContaining({ score: 3, punctualityScore: 3, careScore: 3, communicationScore: 3 }),
        );
      });
    });

    it("una categoría ajustada a mano gana sobre el autocompletado y no se pisa después", async () => {
      mockMutateAsyncCreate.mockResolvedValueOnce(createdRating);
      const { getByTestId } = await render(
        <RatingSheet shipmentId="shipment-1" target={targetNew} visible={true} onClose={jest.fn()} />
      );

      await fireEvent.press(getByTestId("rating-sheet-stars-star-5"));
      await fireEvent.press(getByTestId("rating-sheet-category-punctuality-star-2"));
      // Cambiar el general después no debe pisar la elección puntual de puntualidad.
      await fireEvent.press(getByTestId("rating-sheet-stars-star-4"));
      await fireEvent.press(getByTestId("rating-sheet-submit-btn"));

      await waitFor(() => {
        expect(mockMutateAsyncCreate).toHaveBeenCalledWith({
          rateeId: "carrier-1",
          score: 4,
          punctualityScore: 2,
          careScore: 4,
          communicationScore: 4,
        });
      });
    });

    it("al calificar a un receptor la estrella general autocompleta puntualidad y comunicación", async () => {
      mockMutateAsyncCreate.mockResolvedValueOnce(createdRating);
      const { getByTestId } = await render(
        <RatingSheet shipmentId="shipment-1" target={targetReceiver} visible={true} onClose={jest.fn()} />
      );

      await fireEvent.press(getByTestId("rating-sheet-stars-star-5"));
      await fireEvent.press(getByTestId("rating-sheet-submit-btn"));

      await waitFor(() => {
        expect(mockMutateAsyncCreate).toHaveBeenCalledWith({
          rateeId: "receiver-1",
          score: 5,
          punctualityScore: 5,
          communicationScore: 5,
        });
      });
      // "Cuidado del paquete" no aplica al receptor: no viaja.
      expect(mockMutateAsyncCreate.mock.calls[0][0]).not.toHaveProperty("careScore");
    });

    it("en edición precarga las categorías ya cargadas y reenvía el estado completo", async () => {
      mockMutateAsyncUpdate.mockResolvedValueOnce(createdRating);
      const { getByTestId } = await render(
        <RatingSheet
          shipmentId="shipment-1"
          target={{
            ...targetExisting,
            existingRating: { ...targetExisting.existingRating!, punctualityScore: 5, careScore: 3 },
          }}
          visible={true}
          onClose={jest.fn()}
        />
      );

      // Cambia solo "Comunicación"; las dos precargadas deben seguir viajando.
      await fireEvent.press(getByTestId("rating-sheet-category-communication-star-4"));
      await fireEvent.press(getByTestId("rating-sheet-submit-btn"));

      await waitFor(() => {
        expect(mockMutateAsyncUpdate).toHaveBeenCalledWith({
          rateeId: "carrier-1",
          input: {
            score: 4,
            comment: "Todo muy bien",
            punctualityScore: 5,
            careScore: 3,
            communicationScore: 4,
          },
        });
      });
    });

    it("en edición, cambiar el puntaje general no pisa las categorías precargadas", async () => {
      mockMutateAsyncUpdate.mockResolvedValueOnce(createdRating);
      const { getByTestId } = await render(
        <RatingSheet
          shipmentId="shipment-1"
          target={{
            ...targetExisting,
            existingRating: { ...targetExisting.existingRating!, punctualityScore: 5, careScore: 3 },
          }}
          visible={true}
          onClose={jest.fn()}
        />
      );

      await fireEvent.press(getByTestId("rating-sheet-stars-star-2"));
      await fireEvent.press(getByTestId("rating-sheet-submit-btn"));

      await waitFor(() => {
        expect(mockMutateAsyncUpdate).toHaveBeenCalledWith({
          rateeId: "carrier-1",
          input: {
            score: 2,
            comment: "Todo muy bien",
            punctualityScore: 5,
            careScore: 3,
            // Esta no estaba cargada: sí se autocompleta con el nuevo general.
            communicationScore: 2,
          },
        });
      });
    });
  });
});
