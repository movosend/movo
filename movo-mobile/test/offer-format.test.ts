import { OfferStatus } from "@movo/shared/dist/types/offer";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { MyOfferSummary } from "../src/api/offers-client";
import { isOpenAcceptedOffer, offerNeedsAttention } from "../src/lib/offer-format";

type OfferShape = Pick<MyOfferSummary, "status" | "shipment" | "competitiveRank">;

function offer(
  status: OfferStatus,
  shipmentStatus: ShipmentStatus,
  competitiveRank: MyOfferSummary["competitiveRank"] = null
): OfferShape {
  return { status, shipment: { status: shipmentStatus } as MyOfferSummary["shipment"], competitiveRank };
}

describe("isOpenAcceptedOffer", () => {
  it.each([
    ShipmentStatus.ASSIGNMENT_PENDING,
    ShipmentStatus.ASSIGNED_UNFUNDED,
    ShipmentStatus.ASSIGNED,
    ShipmentStatus.IN_TRANSIT,
  ])("una aceptada con el envío en %s sigue abierta", (shipmentStatus) => {
    expect(isOpenAcceptedOffer(offer(OfferStatus.ACCEPTED, shipmentStatus))).toBe(true);
  });

  it.each([ShipmentStatus.DELIVERED, ShipmentStatus.COMPLETED, ShipmentStatus.CANCELLED, ShipmentStatus.DISPUTED])(
    "una aceptada con el envío en %s está cerrada",
    (shipmentStatus) => {
      expect(isOpenAcceptedOffer(offer(OfferStatus.ACCEPTED, shipmentStatus))).toBe(false);
    }
  );

  it("una oferta que no es aceptada nunca cuenta", () => {
    expect(isOpenAcceptedOffer(offer(OfferStatus.PENDING, ShipmentStatus.IN_TRANSIT))).toBe(false);
  });
});

describe("offerNeedsAttention", () => {
  it("una aceptada con el retiro o el viaje por delante requiere algo del transportista", () => {
    expect(offerNeedsAttention(offer(OfferStatus.ACCEPTED, ShipmentStatus.ASSIGNED))).toBe(true);
    expect(offerNeedsAttention(offer(OfferStatus.ACCEPTED, ShipmentStatus.IN_TRANSIT))).toBe(true);
  });

  it("una aceptada que espera el pago del emisor no depende del transportista", () => {
    expect(offerNeedsAttention(offer(OfferStatus.ACCEPTED, ShipmentStatus.ASSIGNMENT_PENDING))).toBe(false);
    expect(offerNeedsAttention(offer(OfferStatus.ACCEPTED, ShipmentStatus.ASSIGNED_UNFUNDED))).toBe(false);
  });

  it("una aceptada en disputa o terminada no se destaca", () => {
    expect(offerNeedsAttention(offer(OfferStatus.ACCEPTED, ShipmentStatus.DISPUTED))).toBe(false);
    expect(offerNeedsAttention(offer(OfferStatus.ACCEPTED, ShipmentStatus.DELIVERED))).toBe(false);
  });

  it("una pendiente se destaca si su envío se canceló o si quedó superada, no si lidera", () => {
    const rank = (n: number) => ({ rank: n, total: 3, lowestPriceNetArs: 1800, highestPriceNetArs: 2400 });
    expect(offerNeedsAttention(offer(OfferStatus.PENDING, ShipmentStatus.CANCELLED))).toBe(true);
    expect(offerNeedsAttention(offer(OfferStatus.PENDING, ShipmentStatus.PUBLISHED, rank(2)))).toBe(true);
    expect(offerNeedsAttention(offer(OfferStatus.PENDING, ShipmentStatus.PUBLISHED, rank(1)))).toBe(false);
    expect(offerNeedsAttention(offer(OfferStatus.PENDING, ShipmentStatus.PUBLISHED))).toBe(false);
  });

  it("una oferta cerrada (rechazada, retirada) no se destaca", () => {
    expect(offerNeedsAttention(offer(OfferStatus.REJECTED, ShipmentStatus.PUBLISHED))).toBe(false);
  });
});
