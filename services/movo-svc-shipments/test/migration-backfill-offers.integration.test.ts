import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { OfferStatus, ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { PackageType, PhotoStage } from "../src/models/shipment";

const PICKUP_DATE = new Date("2026-08-20T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const MIGRATION_SQL = readFileSync(
  join(__dirname, "../prisma/migrations/20261002120100_backfill_offers_of_cancelled_shipments/migration.sql"),
  "utf8",
);

/**
 * MOVO-258 (D7): la migración de backfill corre contra datos "viejos": envíos cancelados
 * por una vía que NO cerraba las ofertas. Se los fabrica cancelando directo en la base
 * (sin pasar por `updateStatus`, que ahora sí las cierra) y se ejecuta el SQL real.
 */
describe("migración de backfill de ofertas de envíos cancelados (MOVO-258)", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  let offerRepo: OfferRepository;

  async function publishedShipment(): Promise<string> {
    const created = await shipmentRepo.create({
      senderId: randomUUID(),
      receiverId: randomUUID(),
      packageType: PackageType.standard_package,
      weightKg: 2,
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
    return created.id;
  }

  const newOffer = (shipmentId: string, extra: { expiresAt?: Date } = {}) =>
    offerRepo.create({ shipmentId, carrierId: randomUUID(), priceOffered: 5000, offeredDate: PICKUP_DATE, ...extra });

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp();
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
    offerRepo = createOfferRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  it("pasa a shipment_cancelled las accepted y las pending vigentes de un envío cancelado, y nada más", async () => {
    // Envío cancelado con: una accepted, una pending vigente, una pending vencida, una rejected.
    const cancelled = await publishedShipment();
    const accepted = await newOffer(cancelled);
    const rejected = await newOffer(cancelled);
    await offerRepo.reject(rejected.id);
    const expired = await newOffer(cancelled, { expiresAt: new Date(Date.now() - HOUR_MS) });
    await offerRepo.acceptOffer(accepted.id, null); // supersede a las pending vigentes
    const pendingLive = await newOffer(cancelled, { expiresAt: new Date(Date.now() + HOUR_MS) });
    await app.db.shipment.update({ where: { id: cancelled }, data: { status: ShipmentStatus.CANCELLED } });

    // Envío vivo con una accepted: no se toca.
    const alive = await publishedShipment();
    const aliveOffer = await newOffer(alive);
    await offerRepo.acceptOffer(aliveOffer.id, null);

    await app.db.$executeRawUnsafe(MIGRATION_SQL);

    const status = async (id: string) => (await app.db.offer.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(accepted.id)).toBe(OfferStatus.SHIPMENT_CANCELLED);
    expect(await status(pendingLive.id)).toBe(OfferStatus.SHIPMENT_CANCELLED);
    expect(await status(rejected.id)).toBe(OfferStatus.REJECTED);
    // Vencida por fecha: sigue `pending` en base (se lee `expired`), no se reetiqueta.
    expect(await status(expired.id)).toBe("pending");
    expect(await status(aliveOffer.id)).toBe(OfferStatus.ACCEPTED);
  });

  it("una pending vencida por fecha queda pending en base (se lee expired)", async () => {
    const shipmentId = await publishedShipment();
    const expired = await newOffer(shipmentId, { expiresAt: new Date(Date.now() - HOUR_MS) });
    await app.db.shipment.update({ where: { id: shipmentId }, data: { status: ShipmentStatus.CANCELLED } });

    await app.db.$executeRawUnsafe(MIGRATION_SQL);

    expect((await app.db.offer.findUniqueOrThrow({ where: { id: expired.id } })).status).toBe("pending");
    expect((await offerRepo.findById(expired.id))?.status).toBe(OfferStatus.EXPIRED);
  });

  it("es idempotente: correrlo dos veces deja el mismo resultado", async () => {
    const shipmentId = await publishedShipment();
    const offer = await newOffer(shipmentId);
    await offerRepo.acceptOffer(offer.id, null);
    await app.db.shipment.update({ where: { id: shipmentId }, data: { status: ShipmentStatus.CANCELLED } });

    await app.db.$executeRawUnsafe(MIGRATION_SQL);
    await app.db.$executeRawUnsafe(MIGRATION_SQL);

    expect((await app.db.offer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("shipment_cancelled");
  });
});
