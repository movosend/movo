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
});
