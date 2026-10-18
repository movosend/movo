import { fireEvent, render } from "@testing-library/react-native";
import { OfferStatus } from "@movo/shared/dist/types/offer";
import { OfferCard } from "../components/shipments/offer-card";
import type { OfferSummary } from "../src/api/offers-client";

describe("OfferCard", () => {
  const mockOffer: OfferSummary = {
    id: "offer-123",
    shipmentId: "shipment-456",
    carrierId: "carrier-789",
    priceOffered: 15000,
    offeredDate: "2026-09-01T10:00:00.000Z",
    offeredPickupTimeWindowStart: null,
    offeredPickupTimeWindowEnd: null,
    message: "Puedo retirar mañana por la mañana.",
    carrierRatingAtOffer: null,
    carrierNameAtOffer: "Rodrigo Transportista",
    priceNetArs: 12750,
    commissionAmountArs: 2250,
    senderNameAtOffer: null,
    senderVerifiedAtOffer: null,
    senderRatingAtOffer: null,
    estimatedDeliveryDate: null,
    estimatedDeliveryTimeWindowStart: null,
    estimatedDeliveryTimeWindowEnd: null,
    viewedAtBySender: null,
    status: OfferStatus.PENDING,
    expiresAt: null,
    createdAt: "2026-08-25T12:00:00.000Z",
    respondedAt: null,
  };

  const mockOnAccept = jest.fn();
  const mockOnReject = jest.fn();
  const mockOnViewProfile = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renderiza correctamente datos de la oferta con 'Sin calificaciones' cuando rating es null", async () => {
    const { getByText, getByTestId } = await render(
      <OfferCard
        offer={mockOffer}
        onAccept={mockOnAccept}
        onReject={mockOnReject}
        onViewProfile={mockOnViewProfile}
      />
    );

    expect(getByText("Rodrigo Transportista")).toBeTruthy();
    expect(getByText("Sin calificaciones")).toBeTruthy();
    expect(getByText("Puedo retirar mañana por la mañana.")).toBeTruthy();
    expect(getByTestId("offer-card-offer-123-price")).toBeTruthy();
  });

  it("muestra la calificación numérica cuando está disponible", async () => {
    const offerWithRating: OfferSummary = {
      ...mockOffer,
      carrierRatingAtOffer: 4.8,
    };

    const { getByText } = await render(
      <OfferCard
        offer={offerWithRating}
        onAccept={mockOnAccept}
        onReject={mockOnReject}
        onViewProfile={mockOnViewProfile}
      />
    );

    expect(getByText("4.8")).toBeTruthy();
  });

  // MOVO-154, AC7: mismo `StarRatingInput` en modo lectura que el resto de la app,
  // no una representación aparte.
  it("muestra el score con el StarRatingInput en modo lectura, no un ícono estático", async () => {
    const offerWithRating: OfferSummary = { ...mockOffer, carrierRatingAtOffer: 4.8 };

    const { getByTestId } = await render(
      <OfferCard
        offer={offerWithRating}
        onAccept={mockOnAccept}
        onReject={mockOnReject}
        onViewProfile={mockOnViewProfile}
      />
    );

    const star5 = getByTestId("star-5");
    expect(star5.props.accessibilityState.disabled).toBe(true);
  });

  it("llama a onViewProfile al presionar la cabecera del transportista", async () => {
    const { getByTestId } = await render(
      <OfferCard
        offer={mockOffer}
        onAccept={mockOnAccept}
        onReject={mockOnReject}
        onViewProfile={mockOnViewProfile}
      />
    );

    fireEvent.press(getByTestId("offer-card-offer-123-carrier-pressable"));
    expect(mockOnViewProfile).toHaveBeenCalledWith("carrier-789");
  });

  it("llama a onAccept al presionar 'Elegir'", async () => {
    const { getByTestId } = await render(
      <OfferCard
        offer={mockOffer}
        onAccept={mockOnAccept}
        onReject={mockOnReject}
        onViewProfile={mockOnViewProfile}
      />
    );

    fireEvent.press(getByTestId("offer-card-offer-123-accept-btn"));
    expect(mockOnAccept).toHaveBeenCalledWith(mockOffer);
  });

  it("llama a onReject al presionar 'Rechazar'", async () => {
    const { getByTestId } = await render(
      <OfferCard
        offer={mockOffer}
        onAccept={mockOnAccept}
        onReject={mockOnReject}
        onViewProfile={mockOnViewProfile}
      />
    );

    fireEvent.press(getByTestId("offer-card-offer-123-reject-btn"));
    expect(mockOnReject).toHaveBeenCalledWith(mockOffer);
  });

  describe("aviso de fecha/horario distinto al pedido", () => {
    const requestedPickup = {
      pickupDate: "2026-09-01",
      pickupTimeWindowStart: "09:00:00",
      pickupTimeWindowEnd: "12:00:00",
    };
    const renderCard = (offer: OfferSummary, requested?: typeof requestedPickup) =>
      render(
        <OfferCard
          offer={offer}
          onAccept={mockOnAccept}
          onReject={mockOnReject}
          onViewProfile={mockOnViewProfile}
          requestedPickup={requested}
        />,
      );

    it("no muestra la nota si fecha y ventana coinciden con lo pedido", async () => {
      const { queryByTestId } = await renderCard(mockOffer, requestedPickup);
      expect(queryByTestId("offer-card-offer-123-schedule-note")).toBeNull();
    });

    it("muestra la nota si la fecha ofrecida es otra", async () => {
      const { getByTestId } = await renderCard(
        { ...mockOffer, offeredDate: "2026-09-02" },
        requestedPickup,
      );
      expect(getByTestId("offer-card-offer-123-schedule-note")).toBeTruthy();
    });

    it("muestra la nota si el horario ofrecido es otro con la misma fecha", async () => {
      const { getByTestId } = await renderCard(
        {
          ...mockOffer,
          offeredPickupTimeWindowStart: "14:00",
          offeredPickupTimeWindowEnd: "17:00",
        },
        requestedPickup,
      );
      expect(getByTestId("offer-card-offer-123-schedule-note")).toBeTruthy();
    });

    it("no muestra la nota sin datos del envío pedido", async () => {
      const { queryByTestId } = await renderCard({ ...mockOffer, offeredDate: "2026-09-02" });
      expect(queryByTestId("offer-card-offer-123-schedule-note")).toBeNull();
    });
  });
});
