import { randomUUID } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { ShipmentStatus } from "@movo/shared";
import { createShipmentRepository } from "../src/repositories/shipment-repository";
import { createOfferRepository } from "../src/repositories/offer-repository";
import { PackageType, PhotoStage } from "../src/models/shipment";

const PICKUP_DATE = new Date("2026-08-20T00:00:00.000Z");

/**
 * MOVO-258: `TripRepository.start()` exige al menos un paquete aceptado vivo. Este fixture
 * le agrega a un viaje un envío con oferta `accepted` (taggeada con su `tripId`, mismo
 * cableado que `createOfferForShipment`), para los tests que necesitan un viaje iniciable.
 * Devuelve el envío y la oferta para poder moverlos de estado después.
 */
export async function attachAcceptedPackage(
  db: PrismaClient,
  trip: { id: string; carrierId: string },
): Promise<{ shipmentId: string; offerId: string }> {
  const shipmentRepo = createShipmentRepository(db);
  const offerRepo = createOfferRepository(db);

  const created = await shipmentRepo.create({
    senderId: randomUUID(),
    receiverId: randomUUID(),
    packageType: PackageType.standard_package,
    weightKg: 2.5,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    description: "Caja",
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4201,
    pickupLng: -64.1888,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.4135,
    deliveryLng: -64.1811,
    pickupDate: PICKUP_DATE,
    pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
    pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
    suggestedPriceArs: 4500,
  });
  await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
  await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
  await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
  const offer = await offerRepo.create({
    shipmentId: created.id,
    carrierId: trip.carrierId,
    priceOffered: 5000,
    offeredDate: PICKUP_DATE,
  });
  await offerRepo.acceptOffer(offer.id, trip.carrierId);
  await db.offer.update({ where: { id: offer.id }, data: { tripId: trip.id } });
  return { shipmentId: created.id, offerId: offer.id };
}
