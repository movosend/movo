import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { PackageType, PhotoStage } from "../src/models/shipment";

const PICKUP_DATE = new Date("2026-10-01T00:00:00.000Z");
const AGREED_DATE = new Date("2026-10-04T00:00:00.000Z");
const MIGRATION_SQL = readFileSync(
  join(__dirname, "../prisma/migrations/20261003120000_add_original_pickup_window_to_shipments/migration.sql"),
  "utf8",
);
// El ALTER TABLE ya está aplicado en el esquema de test: solo se vuelve a correr el backfill.
const BACKFILL_SQL = MIGRATION_SQL.slice(MIGRATION_SQL.indexOf('UPDATE "shipments"."shipments"'));

/**
 * MOVO-258 (D3): los envíos asignados ANTES del deploy conservan la ventana original del
 * emisor en `pickup_*` (solo el `acceptOffer` nuevo la copia). Se los fabrica deshaciendo a mano
 * lo que hace `acceptOffer` y se ejecuta el SQL real del backfill.
 */
describe("migración de backfill de la ventana de retiro acordada (MOVO-258, D3)", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  let offerRepo: OfferRepository;

  async function assignedShipment(offered: { start?: string; end?: string } = {}): Promise<string> {
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
    const offer = await offerRepo.create({
      shipmentId: created.id,
      carrierId: randomUUID(),
      priceOffered: 5000,
      offeredDate: AGREED_DATE,
      offeredPickupTimeWindowStart: offered.start,
      offeredPickupTimeWindowEnd: offered.end,
    });
    await offerRepo.acceptOffer(offer.id, null);
    // Estado previo al deploy: la ventana del envío sigue siendo la original.
    await app.db.shipment.update({
      where: { id: created.id },
      data: {
        pickupDate: PICKUP_DATE,
        pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
        pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
        originalPickupDate: null,
        originalPickupTimeWindowStart: null,
        originalPickupTimeWindowEnd: null,
      },
    });
    return created.id;
  }

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

  it("copia la ventana de la oferta aceptada al envío y guarda la original", async () => {
    const withWindow = await assignedShipment({ start: "14:00:00", end: "16:00:00" });
    const dateOnly = await assignedShipment();

    await app.db.$executeRawUnsafe(BACKFILL_SQL);

    const a = await app.db.shipment.findUniqueOrThrow({ where: { id: withWindow } });
    expect(a.pickupDate).toEqual(AGREED_DATE);
    expect(a.pickupTimeWindowStart.toISOString()).toBe("1970-01-01T14:00:00.000Z");
    expect(a.pickupTimeWindowEnd.toISOString()).toBe("1970-01-01T16:00:00.000Z");
    expect(a.originalPickupDate).toEqual(PICKUP_DATE);
    expect(a.originalPickupTimeWindowEnd?.toISOString()).toBe("1970-01-01T12:00:00.000Z");

    // Sin franja propuesta: solo cambia el día, la franja del envío queda.
    const b = await app.db.shipment.findUniqueOrThrow({ where: { id: dateOnly } });
    expect(b.pickupDate).toEqual(AGREED_DATE);
    expect(b.pickupTimeWindowStart.toISOString()).toBe("1970-01-01T09:00:00.000Z");
    expect(b.pickupTimeWindowEnd.toISOString()).toBe("1970-01-01T12:00:00.000Z");
  });

  it("es idempotente: correrlo de nuevo no pisa lo ya migrado", async () => {
    const migrated = await assignedShipment();
    await app.db.$executeRawUnsafe(BACKFILL_SQL);
    await app.db.$executeRawUnsafe(BACKFILL_SQL); // idempotente: original_pickup_date ya no es NULL

    const row = await app.db.shipment.findUniqueOrThrow({ where: { id: migrated } });
    expect(row.originalPickupDate).toEqual(PICKUP_DATE);
    expect(row.pickupDate).toEqual(AGREED_DATE);
  });
});
