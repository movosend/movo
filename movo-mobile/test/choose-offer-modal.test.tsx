import { render } from "@testing-library/react-native";
import { OfferStatus } from "@movo/shared/dist/types/offer";
import { ChooseOfferModal } from "../components/shipments/choose-offer-modal";
import type { OfferSummary } from "../src/api/offers-client";

const offer: OfferSummary = {
  id: "offer-1",
  shipmentId: "ship-1",
  carrierId: "carrier-1",
  priceOffered: 15000,
  offeredDate: "2026-09-01",
  offeredPickupTimeWindowStart: null,
  offeredPickupTimeWindowEnd: null,
  message: null,
  carrierRatingAtOffer: null,
  carrierNameAtOffer: "Rodrigo",
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

const renderModal = (payNow?: boolean | null) =>
  render(
    <ChooseOfferModal
      offer={offer}
      visible
      isPending={false}
      errorMessage={null}
      payNow={payNow}
      onConfirm={jest.fn()}
      onClose={jest.fn()}
    />,
  );

describe("ChooseOfferModal — aviso del pago", () => {
  it("retiro cercano: avisa que se reserva ahora y que el cobro es al entregar", async () => {
    const { getByText } = await renderModal(true);
    expect(getByText(/Después te pedimos reservar el pago/)).toBeTruthy();
    expect(getByText(/el cobro se hace recién cuando el paquete se entrega/)).toBeTruthy();
  });

  it("retiro lejano: avisa que todavía no paga nada", async () => {
    const { getByText } = await renderModal(false);
    expect(getByText(/Todavía no pagás nada/)).toBeTruthy();
  });

  it("sin datos del envío no promete nada del momento del pago", async () => {
    const { queryByTestId } = await renderModal(null);
    expect(queryByTestId("choose-offer-modal-payment-note")).toBeNull();
  });
});
