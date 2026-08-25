import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { OfferStatus, ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import {
  createOfferRepository,
  OfferRepository,
  OfferNotFoundError,
  OfferShipmentNotFoundError,
  OfferDateOutOfRangeError,
  DuplicateActiveOfferError,
  ShipmentNotAvailableForAssignmentError,
  OfferConcurrentModificationError,
} from "../src/repositories/offer-repository";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateOfferInput } from "../src/models/offer";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { InvalidOfferTransitionError } from "../src/domain/offer-state-machine";

const PICKUP_DATE = new Date("2026-08-20T00:00:00.000Z");

describe("offer-repository (Postgres)", () => {
  let app: FastifyInstance;
  let repo: OfferRepository;
  let shipmentRepo: ShipmentRepository;

  const baseShipmentInput: CreateShipmentInput = {
    senderId: randomUUID(),
    receiverId: randomUUID(),
    packageType: PackageType.standard_package,
    weightKg: 2.5,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    description: "Caja con libros",
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
      carrierId: randomUUID(),
      priceOffered: 5000,
      offeredDate: PICKUP_DATE,
      ...overrides,
    };
  }

  /** Bypasea la máquina de estados de Shipment a propósito: es fixture de test, no flujo
   * de negocio. Las 2 fotos de creation son para satisfacer el gate de AC6 de MOVO-81
   * (mínimo para poder publicar) -- no son el objeto bajo prueba en este archivo. */
  async function createPublishedShipment(): Promise<string> {
    const created = await shipmentRepo.create(baseShipmentInput);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    const published = await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
    return published.id;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://user:password@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp();
    await app.ready();
    repo = createOfferRepository(app.db);
    shipmentRepo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // CASCADE también vacía shipments.offers (FK a shipments.shipments).
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  describe("create", () => {
    it("crea la oferta en pending (AC1)", async () => {
      const shipmentId = await createPublishedShipment();
      const offer = await repo.create(baseOfferInput({ shipmentId }));

      expect(offer.id).toBeTruthy();
      expect(offer.status).toBe(OfferStatus.PENDING);
      expect(offer.priceOffered).toBe(5000);
      expect(offer.respondedAt).toBeNull();
    });

    it("persiste el snapshot del transportista y el mensaje (AC2)", async () => {
      const shipmentId = await createPublishedShipment();
      const offer = await repo.create(
        baseOfferInput({
          shipmentId,
          message: "Puedo retirar a la mañana",
          carrierRatingAtOffer: 4.8,
          carrierNameAtOffer: "Juan Pérez",
        }),
      );

      expect(offer.message).toBe("Puedo retirar a la mañana");
      expect(offer.carrierRatingAtOffer).toBe(4.8);
      expect(offer.carrierNameAtOffer).toBe("Juan Pérez");
    });

    it("lanza OfferShipmentNotFoundError si el envío no existe", async () => {
      await expect(
        repo.create(baseOfferInput({ shipmentId: "00000000-0000-0000-0000-000000000000" })),
      ).rejects.toThrow(OfferShipmentNotFoundError);
    });

    it("lanza OfferDateOutOfRangeError si offeredDate no coincide con pickupDate del envío (AC10) y no persiste nada", async () => {
      const shipmentId = await createPublishedShipment();
      const otroDia = new Date("2026-08-21T00:00:00.000Z");

      await expect(repo.create(baseOfferInput({ shipmentId, offeredDate: otroDia }))).rejects.toThrow(
        OfferDateOutOfRangeError,
      );

      expect(await repo.listByShipment(shipmentId)).toHaveLength(0);
    });

    it("AC7: rechaza una segunda oferta pending del mismo transportista sobre el mismo envío", async () => {
      const shipmentId = await createPublishedShipment();
      const carrierId = randomUUID();

      await repo.create(baseOfferInput({ shipmentId, carrierId }));

      await expect(repo.create(baseOfferInput({ shipmentId, carrierId }))).rejects.toThrow(
        DuplicateActiveOfferError,
      );

      expect(await repo.listByShipment(shipmentId)).toHaveLength(1);
    });

    it("AC7: un rechazo previo NO bloquea una oferta nueva del mismo transportista", async () => {
      const shipmentId = await createPublishedShipment();
      const carrierId = randomUUID();

      const first = await repo.create(baseOfferInput({ shipmentId, carrierId }));
      await repo.reject(first.id);

      const second = await repo.create(baseOfferInput({ shipmentId, carrierId }));
      expect(second.status).toBe(OfferStatus.PENDING);
      expect(await repo.listByShipment(shipmentId)).toHaveLength(2);
    });

    it("distintos transportistas pueden ofertar pending simultáneamente sobre el mismo envío", async () => {
      const shipmentId = await createPublishedShipment();

      await repo.create(baseOfferInput({ shipmentId }));
      await repo.create(baseOfferInput({ shipmentId }));

      expect(await repo.listByShipment(shipmentId)).toHaveLength(2);
    });
  });

  describe("findById / listByShipment", () => {
    it("encuentra la oferta por id", async () => {
      const shipmentId = await createPublishedShipment();
      const created = await repo.create(baseOfferInput({ shipmentId }));
      const found = await repo.findById(created.id);
      expect(found?.id).toBe(created.id);
    });

    it("devuelve null si no existe", async () => {
      expect(await repo.findById("00000000-0000-0000-0000-000000000000")).toBeNull();
    });

    it("AC11: una oferta pending con expiresAt vencido se lee como expired, sin tocar la fila", async () => {
      const shipmentId = await createPublishedShipment();
      const vencida = new Date(Date.now() - 60_000);
      const created = await repo.create(baseOfferInput({ shipmentId, expiresAt: vencida }));

      const found = await repo.findById(created.id);
      expect(found?.status).toBe(OfferStatus.EXPIRED);

      // Segunda lectura: sigue reportando expired de forma estable, no cambia.
      const foundAgain = await repo.findById(created.id);
      expect(foundAgain?.status).toBe(OfferStatus.EXPIRED);
    });

    it("AC11: una oferta pending con expiresAt futuro se lee como pending", async () => {
      const shipmentId = await createPublishedShipment();
      const enElFuturo = new Date(Date.now() + 60 * 60 * 1000);
      const created = await repo.create(baseOfferInput({ shipmentId, expiresAt: enElFuturo }));

      expect((await repo.findById(created.id))?.status).toBe(OfferStatus.PENDING);
    });
  });

  describe("withdraw / reject", () => {
    it("withdraw: pending -> withdrawn, sin setear respondedAt", async () => {
      const shipmentId = await createPublishedShipment();
      const created = await repo.create(baseOfferInput({ shipmentId }));

      const withdrawn = await repo.withdraw(created.id);
      expect(withdrawn.status).toBe(OfferStatus.WITHDRAWN);
      expect(withdrawn.respondedAt).toBeNull();
    });

    it("reject: pending -> rejected, seteando respondedAt", async () => {
      const shipmentId = await createPublishedShipment();
      const created = await repo.create(baseOfferInput({ shipmentId }));

      const rejected = await repo.reject(created.id);
      expect(rejected.status).toBe(OfferStatus.REJECTED);
      expect(rejected.respondedAt).not.toBeNull();
    });

    it("lanza OfferNotFoundError si el id no existe", async () => {
      await expect(repo.withdraw("00000000-0000-0000-0000-000000000000")).rejects.toThrow(OfferNotFoundError);
      await expect(repo.reject("00000000-0000-0000-0000-000000000000")).rejects.toThrow(OfferNotFoundError);
    });

    it("rechaza una transición inválida (oferta ya rejected) con InvalidOfferTransitionError", async () => {
      const shipmentId = await createPublishedShipment();
      const created = await repo.create(baseOfferInput({ shipmentId }));
      await repo.reject(created.id);

      await expect(repo.withdraw(created.id)).rejects.toThrow(InvalidOfferTransitionError);
    });

    it("compare-and-swap real: dos respuestas terminales simultáneas sobre la misma oferta — una gana, la otra falla sin pisar el resultado (hallazgo de review PR #70)", async () => {
      // Reproduce el escenario de tmvergara sin depender de orden secuencial
      // (el caso secuencial, ej. withdraw() después de que acceptOffer() ya
      // dejó la oferta en superseded, ya lo atrapaba transition() antes de
      // este fix). El bug real era el read-then-write sin guarda: si el
      // UPDATE de una corre DESPUÉS del commit de la otra pero la lectura
      // previa a ese UPDATE fue ANTES, el UPDATE incondicional pisaba el
      // resultado igual. Carrera genuina entre withdraw/reject sobre la
      // misma oferta ejercita exactamente ese read-then-write.
      const shipmentId = await createPublishedShipment();
      const offer = await repo.create(baseOfferInput({ shipmentId }));

      // Precalienta el pool de conexiones (mismo motivo que el test de
      // concurrencia de AC9 más abajo).
      await Promise.all([app.db.$queryRawUnsafe("SELECT 1"), app.db.$queryRawUnsafe("SELECT 1")]);

      const [resWithdraw, resReject] = await Promise.allSettled([repo.withdraw(offer.id), repo.reject(offer.id)]);

      const results = [resWithdraw, resReject];
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(OfferConcurrentModificationError);

      // El estado final es exactamente el de la operación ganadora — nunca
      // termina pisado por la perdedora.
      const winnerStatus = (fulfilled[0] as PromiseFulfilledResult<{ status: OfferStatus }>).value.status;
      const final = await repo.findById(offer.id);
      expect(final?.status).toBe(winnerStatus);
    });
  });

  describe("acceptOffer (AC8/AC9)", () => {
    it("acepta la oferta, marca las demás pending como superseded y el envío como assignment_pending — todo en una transacción", async () => {
      const shipmentId = await createPublishedShipment();
      const offerA = await repo.create(baseOfferInput({ shipmentId }));
      const offerB = await repo.create(baseOfferInput({ shipmentId }));
      const offerC = await repo.create(baseOfferInput({ shipmentId }));
      const actorId = randomUUID();

      const result = await repo.acceptOffer(offerA.id, actorId);

      expect(result.offer.status).toBe(OfferStatus.ACCEPTED);
      expect(result.offer.respondedAt).not.toBeNull();
      expect(result.shipmentId).toBe(shipmentId);

      const [reloadedB, reloadedC] = await Promise.all([repo.findById(offerB.id), repo.findById(offerC.id)]);
      expect(reloadedB?.status).toBe(OfferStatus.SUPERSEDED);
      expect(reloadedC?.status).toBe(OfferStatus.SUPERSEDED);

      // Hallazgo de review (PR #105): `acceptOffer()` devuelve las ofertas
      // superadas directo de la misma transacción, sin que el caller necesite
      // un `listByShipment` aparte.
      expect(result.superseded).toHaveLength(2);
      expect(result.superseded.map((s) => s.id).sort()).toEqual([offerB.id, offerC.id].sort());
      expect(result.superseded.map((s) => s.carrierId).sort()).toEqual(
        [offerB.carrierId, offerC.carrierId].sort()
      );

      const shipment = await shipmentRepo.findById(shipmentId);
      expect(shipment?.status).toBe(ShipmentStatus.ASSIGNMENT_PENDING);
      expect(shipment?.carrierId).toBe(offerA.carrierId);

      const events = await shipmentRepo.listEvents(shipmentId);
      const acceptEvent = events.find((e) => e.toStatus === ShipmentStatus.ASSIGNMENT_PENDING);
      expect(acceptEvent?.actorId).toBe(actorId);
    });

    it("una oferta pending pero con expiresAt vencido NO se marca superseded al aceptar otra", async () => {
      const shipmentId = await createPublishedShipment();
      const offerA = await repo.create(baseOfferInput({ shipmentId }));
      const vencida = await repo.create(
        baseOfferInput({ shipmentId, expiresAt: new Date(Date.now() - 60_000) }),
      );

      await repo.acceptOffer(offerA.id, null);

      const reloaded = await repo.findById(vencida.id);
      expect(reloaded?.status).toBe(OfferStatus.EXPIRED);
    });

    it("lanza OfferNotFoundError si la oferta no existe", async () => {
      await expect(repo.acceptOffer("00000000-0000-0000-0000-000000000000", null)).rejects.toThrow(
        OfferNotFoundError,
      );
    });

    it("rechaza aceptar una oferta ya aceptada/rechazada/retirada/superseded/expirada", async () => {
      const shipmentId = await createPublishedShipment();

      const alreadyRejected = await repo.create(baseOfferInput({ shipmentId }));
      await repo.reject(alreadyRejected.id);
      await expect(repo.acceptOffer(alreadyRejected.id, null)).rejects.toThrow(InvalidOfferTransitionError);

      const expired = await repo.create(
        baseOfferInput({ shipmentId, expiresAt: new Date(Date.now() - 60_000) }),
      );
      await expect(repo.acceptOffer(expired.id, null)).rejects.toThrow(InvalidOfferTransitionError);
    });

    it("AC9: si el envío ya no está published, lanza ShipmentNotAvailableForAssignmentError y no persiste nada", async () => {
      const shipmentId = await createPublishedShipment();
      const offerA = await repo.create(baseOfferInput({ shipmentId }));
      const offerB = await repo.create(baseOfferInput({ shipmentId }));

      // Otro proceso ya movió el envío fuera de 'published' (ej. otra oferta ya aceptada).
      await shipmentRepo.updateStatus(shipmentId, ShipmentStatus.ASSIGNMENT_PENDING, null);

      await expect(repo.acceptOffer(offerB.id, null)).rejects.toThrow(ShipmentNotAvailableForAssignmentError);

      // Nada se persistió: la oferta sigue pending, no quedó marcada accepted/superseded.
      expect((await repo.findById(offerB.id))?.status).toBe(OfferStatus.PENDING);
      expect((await repo.findById(offerA.id))?.status).toBe(OfferStatus.PENDING);
    });

    it("AC9 (concurrencia): dos aceptaciones simultáneas sobre el mismo envío — una gana, la otra falla", async () => {
      const shipmentId = await createPublishedShipment();
      const offerA = await repo.create(baseOfferInput({ shipmentId }));
      const offerB = await repo.create(baseOfferInput({ shipmentId }));

      // Precalienta el pool con 2 conexiones ya establecidas: sin esto, el
      // resto de la suite deja el pool con una sola conexión idle (nunca
      // necesitó una segunda hasta acá), y la carrera de abajo deja de ser
      // pareja — la primera promesa reutiliza la conexión ya abierta y
      // termina su transacción entera antes de que la segunda termine de
      // abrir una conexión nueva (handshake TCP), lo que hace que la
      // "perdedora" nunca llegue a competir por el lock de `shipments` y en
      // cambio encuentre su propia oferta ya `superseded` al leerla.
      await Promise.all([app.db.$queryRawUnsafe("SELECT 1"), app.db.$queryRawUnsafe("SELECT 1")]);

      const [resA, resB] = await Promise.allSettled([
        repo.acceptOffer(offerA.id, randomUUID()),
        repo.acceptOffer(offerB.id, randomUUID()),
      ]);

      const results = [resA, resB];
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ShipmentNotAvailableForAssignmentError);

      const finalShipment = await shipmentRepo.findById(shipmentId);
      expect(finalShipment?.status).toBe(ShipmentStatus.ASSIGNMENT_PENDING);

      // La oferta ganadora quedó accepted; la perdedora quedó superseded (por el batch
      // de la transacción ganadora, AC8) — su propio intento de acceptOffer nunca llegó
      // a escribir la fila de offers, tiró antes en el UPDATE condicional del envío.
      const [reloadedA, reloadedB] = await Promise.all([repo.findById(offerA.id), repo.findById(offerB.id)]);
      const statuses = [reloadedA?.status, reloadedB?.status].sort();
      expect(statuses).toEqual([OfferStatus.ACCEPTED, OfferStatus.SUPERSEDED].sort());
    });

    it("compare-and-swap en el UPDATE de la propia oferta: un reject concurrente sobre la misma oferta que se está aceptando no queda pisado, y si gana el reject, el envío no se toca (rollback completo)", async () => {
      const shipmentId = await createPublishedShipment();
      const offer = await repo.create(baseOfferInput({ shipmentId }));

      await Promise.all([app.db.$queryRawUnsafe("SELECT 1"), app.db.$queryRawUnsafe("SELECT 1")]);

      const [resAccept, resReject] = await Promise.allSettled([
        repo.acceptOffer(offer.id, randomUUID()),
        repo.reject(offer.id),
      ]);

      const results = [resAccept, resReject];
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejectedResults = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejectedResults).toHaveLength(1);
      expect((rejectedResults[0] as PromiseRejectedResult).reason).toBeInstanceOf(OfferConcurrentModificationError);

      if (resAccept.status === "rejected") {
        // reject ganó la carrera: acceptOffer tira OfferConcurrentModificationError
        // en su propio UPDATE de la oferta -- eso hace ROLLBACK de toda su
        // transacción, así que el envío nunca debería haber quedado tocado.
        const shipment = await shipmentRepo.findById(shipmentId);
        expect(shipment?.status).toBe(ShipmentStatus.PUBLISHED);
      }

      const final = await repo.findById(offer.id);
      expect([OfferStatus.ACCEPTED, OfferStatus.REJECTED]).toContain(final?.status);
    });
  });

  describe("listByCarrier (MOVO-145)", () => {
    it("AC1: lista solo las ofertas propias -- otro transportista no ve nada del primero", async () => {
      const shipmentId = await createPublishedShipment();
      const carrierA = randomUUID();
      const carrierB = randomUUID();
      await repo.create(baseOfferInput({ shipmentId, carrierId: carrierA }));
      await repo.create(baseOfferInput({ shipmentId, carrierId: carrierB }));

      const resultA = await repo.listByCarrier(carrierA, 1, 20);
      expect(resultA.total).toBe(1);
      expect(resultA.items).toHaveLength(1);
      expect(resultA.items[0].carrierId).toBe(carrierA);
    });

    it("sin filtro devuelve todas las ofertas propias, más recientes primero", async () => {
      const shipmentId = await createPublishedShipment();
      const carrierId = randomUUID();
      const first = await repo.create(baseOfferInput({ shipmentId, carrierId }));
      const shipmentId2 = await createPublishedShipment();
      const second = await repo.create(baseOfferInput({ shipmentId: shipmentId2, carrierId }));

      const result = await repo.listByCarrier(carrierId, 1, 20);
      expect(result.total).toBe(2);
      expect(result.items.map((o) => o.id)).toEqual([second.id, first.id]);
    });

    it("AC3: filtra por status EFECTIVO -- una pending vencida sale como expired sin tocar la fila, y no aparece bajo pending", async () => {
      const shipmentId = await createPublishedShipment();
      const carrierId = randomUUID();
      const vigente = await repo.create(baseOfferInput({ shipmentId, carrierId }));
      const shipmentId2 = await createPublishedShipment();
      const vencida = await repo.create(
        baseOfferInput({ shipmentId: shipmentId2, carrierId, expiresAt: new Date(Date.now() - 60_000) }),
      );

      const pendingResult = await repo.listByCarrier(carrierId, 1, 20, OfferStatus.PENDING);
      expect(pendingResult.total).toBe(1);
      expect(pendingResult.items[0].id).toBe(vigente.id);

      const expiredResult = await repo.listByCarrier(carrierId, 1, 20, OfferStatus.EXPIRED);
      expect(expiredResult.total).toBe(1);
      expect(expiredResult.items[0].id).toBe(vencida.id);
      expect(expiredResult.items[0].status).toBe(OfferStatus.EXPIRED);

      // La fila en base sigue siendo 'pending' -- expired es puramente derivado (AC11).
      const raw = await app.db.offer.findUnique({ where: { id: vencida.id } });
      expect(raw?.status).toBe("pending");
    });

    it("DoD: filtra por cada uno de los 6 estados efectivos", async () => {
      const carrierId = randomUUID();

      const shipmentRejected = await createPublishedShipment();
      const rejected = await repo.create(baseOfferInput({ shipmentId: shipmentRejected, carrierId }));
      await repo.reject(rejected.id);

      const shipmentWithdrawn = await createPublishedShipment();
      const withdrawn = await repo.create(baseOfferInput({ shipmentId: shipmentWithdrawn, carrierId }));
      await repo.withdraw(withdrawn.id);

      const shipmentAccept = await createPublishedShipment();
      const accepted = await repo.create(baseOfferInput({ shipmentId: shipmentAccept, carrierId }));
      await repo.acceptOffer(accepted.id, null);

      // superseded: la oferta de `carrierId` queda pisada cuando el emisor acepta la
      // de OTRO transportista sobre el mismo envío (AC8 de MOVO-102) -- no puede ser el
      // mismo carrierId que la aceptada, el índice único parcial de AC7 rechaza dos
      // ofertas pending del mismo transportista sobre el mismo envío.
      const shipmentSuperseded = await createPublishedShipment();
      const superseded = await repo.create(baseOfferInput({ shipmentId: shipmentSuperseded, carrierId }));
      const winningOffer = await repo.create(baseOfferInput({ shipmentId: shipmentSuperseded }));
      await repo.acceptOffer(winningOffer.id, null);

      const shipmentPending = await createPublishedShipment();
      const pending = await repo.create(baseOfferInput({ shipmentId: shipmentPending, carrierId }));

      const shipmentExpired = await createPublishedShipment();
      const expired = await repo.create(
        baseOfferInput({ shipmentId: shipmentExpired, carrierId, expiresAt: new Date(Date.now() - 60_000) }),
      );

      const cases: [OfferStatus, string][] = [
        [OfferStatus.PENDING, pending.id],
        [OfferStatus.ACCEPTED, accepted.id],
        [OfferStatus.REJECTED, rejected.id],
        [OfferStatus.WITHDRAWN, withdrawn.id],
        [OfferStatus.EXPIRED, expired.id],
        [OfferStatus.SUPERSEDED, superseded.id],
      ];

      for (const [status, expectedId] of cases) {
        const result = await repo.listByCarrier(carrierId, 1, 20, status);
        expect(result.total, `status=${status}`).toBe(1);
        expect(result.items[0].id, `status=${status}`).toBe(expectedId);
        expect(result.items[0].status, `status=${status}`).toBe(status);
      }

      const all = await repo.listByCarrier(carrierId, 1, 20);
      expect(all.total).toBe(6);
    });

    it("pagina correctamente", async () => {
      const carrierId = randomUUID();
      for (let i = 0; i < 3; i++) {
        const shipmentId = await createPublishedShipment();
        await repo.create(baseOfferInput({ shipmentId, carrierId }));
      }

      const page1 = await repo.listByCarrier(carrierId, 1, 2);
      const page2 = await repo.listByCarrier(carrierId, 2, 2);

      expect(page1.total).toBe(3);
      expect(page1.items).toHaveLength(2);
      expect(page2.items).toHaveLength(1);
      const ids = [...page1.items, ...page2.items].map((o) => o.id);
      expect(new Set(ids).size).toBe(3);
    });

    it("AC4: trae el contexto mínimo del envío resuelto en la misma query", async () => {
      const shipmentId = await createPublishedShipment();
      const carrierId = randomUUID();
      await repo.create(baseOfferInput({ shipmentId, carrierId }));

      const result = await repo.listByCarrier(carrierId, 1, 20);
      expect(result.items[0].shipment).toMatchObject({
        id: shipmentId,
        pickupAddress: baseShipmentInput.pickupAddress,
        deliveryAddress: baseShipmentInput.deliveryAddress,
      });
      expect(result.items[0].shipment.pickupDate.toISOString()).toBe(PICKUP_DATE.toISOString());
    });

    it("AC5: una oferta accepted expone el status real del envío (assignment_pending), no published", async () => {
      const shipmentId = await createPublishedShipment();
      const carrierId = randomUUID();
      const offer = await repo.create(baseOfferInput({ shipmentId, carrierId }));
      await repo.acceptOffer(offer.id, null);

      const result = await repo.listByCarrier(carrierId, 1, 20);
      expect(result.items[0].status).toBe(OfferStatus.ACCEPTED);
      expect(result.items[0].shipment.status).toBe(ShipmentStatus.ASSIGNMENT_PENDING);
    });
  });
});
