import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createOfferRepository, OfferRepository } from "../src/repositories/offer-repository";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateOfferInput } from "../src/models/offer";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";

const PICKUP_DATE = new Date("2026-08-20T00:00:00.000Z");

describe("PATCH /offers/:id (Postgres, MOVO-181)", () => {
  let app: FastifyInstance;
  let offerRepo: OfferRepository;
  let shipmentRepo: ShipmentRepository;
  const senderId = randomUUID();
  const receiverId = randomUUID();
  const carrierId = randomUUID();
  const otherCarrierId = randomUUID();

  const baseShipmentInput: CreateShipmentInput = {
    senderId,
    receiverId,
    packageType: PackageType.standard_package,
    weightKg: 2.5,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
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
  };

  function baseOfferInput(overrides: Partial<CreateOfferInput> = {}): CreateOfferInput {
    return {
      shipmentId: overrides.shipmentId ?? "",
      carrierId,
      priceOffered: 1150,
      offeredDate: PICKUP_DATE,
      ...overrides,
    };
  }

  async function createPublishedShipment(): Promise<string> {
    const created = await shipmentRepo.create(baseShipmentInput);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    const published = await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
    return published.id;
  }

  function requestPatch(offerId: string, userId: string, body: Record<string, unknown>) {
    return app.inject({
      method: "PATCH",
      url: `/offers/${offerId}`,
      headers: { "x-user-id": userId },
      payload: body,
    });
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    app = buildApp({ sweepEnabled: false });
    await app.ready();
    offerRepo = createOfferRepository(app.db);
    shipmentRepo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  it("AC1/AC3: el transportista dueño modifica precio (neto->bruto) y devuelve el desglose actualizado", async () => {
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId, priceOffered: 1150 }));

    const response = await requestPatch(offer.id, carrierId, { priceOfferedArs: 2000 });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    // AC6 de MOVO-143 aplica igual acá: priceOfferedArs es el NETO, el servidor
    // persiste el bruto (2000 * 1.15 con la tasa 15% default).
    expect(data.priceOffered).toBe(2300);
    expect(data.priceNetArs).toBe(2000);
    expect(data.commissionAmountArs).toBe(300);
    expect(data.status).toBe("pending");

    const persisted = await offerRepo.findById(offer.id);
    expect(persisted?.priceOffered).toBe(2300);
  });

  it("AC1/AC3: modifica offeredDate y la franja horaria propuesta juntas", async () => {
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId }));
    const newOfferedDate = new Date(PICKUP_DATE.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const response = await requestPatch(offer.id, carrierId, {
      offeredDate: newOfferedDate,
      offeredPickupTimeWindowStart: "10:00",
      offeredPickupTimeWindowEnd: "13:00",
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.offeredDate.slice(0, 10)).toBe(newOfferedDate);
    expect(data.offeredPickupTimeWindowStart).toBe("10:00:00");
    expect(data.offeredPickupTimeWindowEnd).toBe("13:00:00");
  });

  it("AC1: no toca createdAt ni expiresAt", async () => {
    const shipmentId = await createPublishedShipment();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const offer = await offerRepo.create(baseOfferInput({ shipmentId, expiresAt }));

    const response = await requestPatch(offer.id, carrierId, { priceOfferedArs: 3000 });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(new Date(data.createdAt).getTime()).toBe(offer.createdAt.getTime());
    expect(new Date(data.expiresAt).getTime()).toBe(expiresAt.getTime());
  });

  it("403 AUTH_FORBIDDEN si quien modifica no es el dueño de la oferta", async () => {
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId }));

    const response = await requestPatch(offer.id, otherCarrierId, { priceOfferedArs: 3000 });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("AUTH_FORBIDDEN");

    const persisted = await offerRepo.findById(offer.id);
    expect(persisted?.priceOffered).toBe(1150);
  });

  it("404 OFFER_NOT_FOUND sobre una oferta inexistente", async () => {
    const response = await requestPatch(randomUUID(), carrierId, { priceOfferedArs: 3000 });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("OFFER_NOT_FOUND");
  });

  it("AC2: 409 OFFER_NOT_EDITABLE sobre una oferta ya aceptada", async () => {
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId }));
    await offerRepo.acceptOffer(offer.id, senderId);

    const response = await requestPatch(offer.id, carrierId, { priceOfferedArs: 3000 });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("OFFER_NOT_EDITABLE");
  });

  it("AC2: 409 OFFER_NOT_EDITABLE sobre una pending vencida (expired por lectura)", async () => {
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId, expiresAt: new Date(Date.now() - 60_000) }));

    const response = await requestPatch(offer.id, carrierId, { priceOfferedArs: 3000 });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("OFFER_NOT_EDITABLE");
  });

  it("AC3: 422 OFFER_DATE_OUT_OF_RANGE si el offeredDate editado sale del rango permitido", async () => {
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId }));
    const tooEarly = new Date(PICKUP_DATE.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const response = await requestPatch(offer.id, carrierId, { offeredDate: tooEarly });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("OFFER_DATE_OUT_OF_RANGE");
  });

  it("422 VALIDATION_FAILED si se manda solo un extremo de la franja horaria (both-or-neither)", async () => {
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId }));

    const response = await requestPatch(offer.id, carrierId, { offeredPickupTimeWindowStart: "10:00" });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("422 OFFER_PICKUP_WINDOW_INVALID si el fin de la franja no es posterior al inicio", async () => {
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId }));

    const response = await requestPatch(offer.id, carrierId, {
      offeredPickupTimeWindowStart: "13:00",
      offeredPickupTimeWindowEnd: "10:00",
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("OFFER_PICKUP_WINDOW_INVALID");
  });

  it("422 VALIDATION_FAILED si priceOfferedArs es <= 0", async () => {
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId }));

    const response = await requestPatch(offer.id, carrierId, { priceOfferedArs: 0 });

    expect(response.statusCode).toBe(400);
  });

  it("400 VALIDATION_FAILED con un body vacío (minProperties: 1 -- no es una edición válida)", async () => {
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId }));

    const response = await requestPatch(offer.id, carrierId, {});

    expect(response.statusCode).toBe(400);
  });

  it("PATCH concurrente con un withdraw sobre la misma oferta -- withdraw siempre gana, PATCH puede ganar o perder el CAS (test flaky corregido: no son mutuamente excluyentes)", async () => {
    const shipmentId = await createPublishedShipment();
    const offer = await offerRepo.create(baseOfferInput({ shipmentId }));

    // Precalienta el pool de conexiones -- mismo motivo documentado en el resto de
    // los tests de concurrencia del servicio (ver offer-repository.integration.test.ts).
    await Promise.all([app.db.$queryRawUnsafe("SELECT 1"), app.db.$queryRawUnsafe("SELECT 1")]);

    const [resPatch, resWithdraw] = await Promise.all([
      requestPatch(offer.id, carrierId, { priceOfferedArs: 2000 }),
      app.inject({ method: "POST", url: `/offers/${offer.id}/withdraw`, headers: { "x-user-id": carrierId } }),
    ]);

    // Bug de este test (no un timing flaky de infra -- confirmado fallando de forma
    // determinística según el orden real de commit, ver CI): asumía que exactamente
    // uno de los dos siempre pierde con 409, calcado del molde de "dos transiciones
    // terminales" (ej. accept vs withdraw) donde ambos compiten por el mismo `status`.
    // PATCH (`update()`) nunca escribe `status` -- su propio CAS lee `status:'pending'`
    // pero jamás lo cambia, así que la precondición de `withdraw()` (`status:'pending'`)
    // nunca se invalida por un PATCH, gane o pierda éste su carrera. `withdraw()` por
    // lo tanto SIEMPRE resuelve 200 acá -- el mismo razonamiento que ya documenta,
    // correctamente, `offer-repository.integration.test.ts#"compare-and-swap real:
    // update() concurrente con un withdraw()..."` para el mismo par de operaciones un
    // nivel más abajo (repositorio, sin pasar por HTTP). Lo no determinístico es
    // únicamente si el `UPDATE` de PATCH llega a commitear antes que el de withdraw
    // (los dos aplican, 200/200) o después (pierde el CAS contra el status ya
    // cambiado, 409/200) -- nunca al revés.
    expect(resWithdraw.statusCode).toBe(200);
    expect([200, 409]).toContain(resPatch.statusCode);

    const final = await offerRepo.findById(offer.id);
    expect(final?.status).toBe("withdrawn");
    if (resPatch.statusCode === 200) {
      // PATCH alcanzó a commitear antes que withdraw -- ambos efectos sobreviven.
      expect(final?.priceOffered).toBe(2300);
    } else {
      // withdraw commiteó primero -- PATCH perdió el CAS contra el status ya
      // cambiado, sin pisar el precio original.
      expect(final?.priceOffered).toBe(1150);
    }
  });
});
