import { fireEvent, render } from "@testing-library/react-native";
import { MyOfferCard } from "../components/transport/my-offer-card";
import type { MyOfferSummary } from "../src/api/offers-client";

function offer(overrides: Partial<MyOfferSummary> = {}): MyOfferSummary {
  return {
    id: "offer-1",
    shipmentId: "shipment-1",
    carrierId: "carrier-1",
    priceOffered: 5000,
    priceNetArs: 4500,
    commissionAmountArs: 500,
    offeredDate: "2026-09-10",
    offeredPickupTimeWindowStart: null,
    offeredPickupTimeWindowEnd: null,
    message: null,
    carrierRatingAtOffer: null,
    carrierNameAtOffer: null,
    senderNameAtOffer: null,
    senderVerifiedAtOffer: null,
    senderRatingAtOffer: null,
    estimatedDeliveryDate: null,
    estimatedDeliveryTimeWindowStart: null,
    estimatedDeliveryTimeWindowEnd: null,
    viewedAtBySender: null,
    status: "pending" as MyOfferSummary["status"],
    expiresAt: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    respondedAt: null,
    competitiveRank: null,
    shipment: {
      id: "shipment-1",
      status: "published",
      pickupAddress: "Av. Colón 1234, Córdoba",
      pickupDate: "2026-09-10",
      pickupTimeWindowStart: "09:00",
      pickupTimeWindowEnd: "12:00",
      deliveryAddress: "Bv. San Juan 500, Córdoba",
      distanceKm: 9.4,
      packageType: "small_box" as MyOfferSummary["shipment"]["packageType"],
      weightKg: 3,
      description: null,
    },
    ...overrides,
  };
}

describe("MyOfferCard (MOVO-151)", () => {
  it("muestra ruta, fecha, distancia y el neto real (no el bruto)", async () => {
    const { getByText, queryByText } = await render(
      <MyOfferCard offer={offer()} testID="card" onPress={jest.fn()} />,
    );

    expect(getByText(/Av\. Colón.*→.*Bv\. San Juan/)).toBeTruthy();
    expect(getByText(/9,4 km/)).toBeTruthy();
    expect(getByText("$4.500")).toBeTruthy();
    expect(queryByText("$5.000")).toBeNull();
  });

  it.each([
    ["pending", "Pendiente"],
    ["accepted", "Aceptada"],
    ["rejected", "Rechazada"],
    ["withdrawn", "La retiraste"],
    ["expired", "Venció antes de que respondieran"],
    ["superseded", "El emisor eligió otra oferta"],
  ] as const)("AC3: el estado %s se explica con copy, nunca el enum crudo (%s)", async (status, expectedLabel) => {
    const { getByText } = await render(
      <MyOfferCard offer={offer({ status: status as MyOfferSummary["status"] })} testID="card" onPress={jest.fn()} />,
    );

    expect(getByText(expectedLabel)).toBeTruthy();
  });

  it.each([
    ["pending", "text-fg-2"],
    ["accepted", "text-info-700"],
    ["rejected", "text-danger-700"],
    ["withdrawn", "text-fg-3"],
    ["expired", "text-fg-3"],
    ["superseded", "text-fg-3"],
  ] as const)("el color del chip de %s va en el propio Text, no solo en el View padre (%s)", async (status, textClass) => {
    const { getByText } = await render(
      <MyOfferCard offer={offer({ status: status as MyOfferSummary["status"] })} testID="card" onPress={jest.fn()} />,
    );

    const label = getByText(
      {
        pending: "Pendiente",
        accepted: "Aceptada",
        rejected: "Rechazada",
        withdrawn: "La retiraste",
        expired: "Venció antes de que respondieran",
        superseded: "El emisor eligió otra oferta",
      }[status],
    );
    expect(label.props.className).toContain(textClass);
  });

  it("showSentAgo muestra cuándo se ofertó; sin él no aparece", async () => {
    const recent = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { getByTestId, queryByTestId, rerender } = await render(
      <MyOfferCard offer={offer({ createdAt: recent })} testID="card" showSentAgo onPress={jest.fn()} />,
    );
    expect(getByTestId("card-sent-ago")).toHaveTextContent("Ofertada hace 2 h");

    await rerender(<MyOfferCard offer={offer({ createdAt: recent })} testID="card" onPress={jest.fn()} />);
    expect(queryByTestId("card-sent-ago")).toBeNull();
  });

  it("sin aviso, no renderiza la franja de notice", async () => {
    const { queryByTestId } = await render(<MyOfferCard offer={offer()} testID="card" onPress={jest.fn()} />);
    expect(queryByTestId("card-notice")).toBeNull();
  });

  it("con aviso, lo renderiza con el texto dado", async () => {
    const { getByTestId } = await render(
      <MyOfferCard
        offer={offer()}
        testID="card"
        notice={{ text: "Ya te aceptaron.", tone: "positive" }}
        onPress={jest.fn()}
      />,
    );
    expect(getByTestId("card-notice")).toHaveTextContent("Ya te aceptaron.");
  });

  it("dispara onPress al tocarla", async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(<MyOfferCard offer={offer()} testID="card" onPress={onPress} />);
    await fireEvent.press(getByTestId("card"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
