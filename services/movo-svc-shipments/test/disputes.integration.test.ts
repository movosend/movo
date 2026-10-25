import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";
import { FastifyInstance } from "fastify";
import { DisputeReason, ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import {
  createShipmentRepository,
  ShipmentRepository,
} from "../src/repositories/shipment-repository";
import {
  createMockStorageProvider,
  MockStorageProvider,
} from "../src/adapters/mock-storage-provider";
import { AlertNotifier } from "../src/adapters/alert-notifier";
import { PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakePaymentsClient } from "./fake-payments-client";
import { createFakePricingClient } from "./fake-pricing-client";
import { createFakePricingLogisticsClient } from "./fake-pricing-logistics-client";

const DAY_MS = 24 * 60 * 60 * 1000;
const PICKUP_DATE = new Date("2026-08-20T00:00:00.000Z");
const JPEG = { contentType: "image/jpeg", contentLength: 1024 };
const MIGRATION_SQL = readFileSync(
  join(__dirname, "../prisma/migrations/20261023120000_disputes/migration.sql"),
  "utf8",
);

/**
 * MOVO-334 (DD-054): disputas abiertas por las partes contra Postgres/Redis reales: apertura,
 * ventana de 7 días desde `completed`, una abierta por envío, descargos, detalle, avisos, el
 * bloqueo del transportista y de la baja de cuenta, y el backfill de la migración.
 */
describe("disputas (Postgres, MOVO-334)", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  let storage: MockStorageProvider;
  const sendPush = vi.fn(async () => {});
  const alertSend = vi.fn<AlertNotifier["send"]>(async () => {});

  interface Parties {
    shipmentId: string;
    senderId: string;
    receiverId: string;
    carrierId: string;
  }

  /** Envío con transportista, llevado a `status` escribiendo la columna (mismo criterio que `attachAcceptedPackage`). */
  async function shipmentIn(
    status: ShipmentStatus,
    deliveredDaysAgo: number | null = null,
  ): Promise<Parties> {
    const senderId = randomUUID();
    const receiverId = randomUUID();
    const carrierId = randomUUID();
    const created = await shipmentRepo.create({
      senderId,
      receiverId,
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
    await shipmentRepo.addPhoto(
      created.id,
      PhotoStage.creation,
      `shipments/${created.id}/creation/${randomUUID()}.jpg`,
    );
    await shipmentRepo.addPhoto(
      created.id,
      PhotoStage.creation,
      `shipments/${created.id}/creation/${randomUUID()}.jpg`,
    );
    await shipmentRepo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
    await app.db.shipment.update({
      where: { id: created.id },
      data: {
        status,
        carrierId,
        deliveredAt:
          deliveredDaysAgo === null
            ? null
            : new Date(Date.now() - deliveredDaysAgo * DAY_MS),
      },
    });
    return { shipmentId: created.id, senderId, receiverId, carrierId };
  }

  const openDispute = (
    shipmentId: string,
    userId: string,
    payload: Record<string, unknown> = {},
  ) =>
    app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/disputes`,
      headers: { "x-user-id": userId },
      payload: {
        reason: DisputeReason.DAMAGED,
        description: "El paquete llegó roto",
        ...payload,
      },
    });

  const addStatement = (
    disputeId: string,
    userId: string,
    payload: Record<string, unknown> = {},
  ) =>
    app.inject({
      method: "POST",
      url: `/disputes/${disputeId}/statements`,
      headers: { "x-user-id": userId },
      payload: { text: "Mi versión", ...payload },
    });

  /** Presign + subida simulada: devuelve la key lista para `photoKeys`. */
  async function uploadedPhoto(
    shipmentId: string,
    userId: string,
  ): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/disputes/photos/presign`,
      headers: { "x-user-id": userId },
      payload: JPEG,
    });
    expect(response.statusCode).toBe(200);
    const { s3Key } = response.json() as { s3Key: string };
    storage.__simulateUpload(s3Key, JPEG);
    return s3Key;
  }

  /** Disputa de sistema como la deja el barrido (o el backfill). */
  async function systemDispute(
    status: ShipmentStatus,
    reason: DisputeReason,
  ): Promise<Parties & { disputeId: string }> {
    const parties = await shipmentIn(status);
    const disputeId = randomUUID();
    await shipmentRepo.updateStatus(
      parties.shipmentId,
      ShipmentStatus.DISPUTED,
      null,
      "barrido",
      {
        expectedFrom: status,
        dispute: {
          id: disputeId,
          openedBy: null,
          openedByRole: null,
          reason,
          description: "barrido",
        },
      },
    );
    return { ...parties, disputeId };
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    storage = createMockStorageProvider();
    app = buildApp({
      usersClient: createFakeUsersClient({}),
      paymentsClient: createFakePaymentsClient(),
      notificationsClient: { sendPush },
      alertNotifier: { send: alertSend },
      storageProvider: storage,
      pricingClient: createFakePricingClient(),
      pricingLogisticsClient: createFakePricingLogisticsClient(),
      sweepEnabled: false,
      orphanPhotoSweepEnabled: false,
      tripExpirySweepEnabled: false,
      transitAnomalySweepEnabled: false,
      pickupMissedSweepEnabled: false,
    });
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    sendPush.mockClear();
    alertSend.mockClear();
    await app.db.$executeRawUnsafe(
      "TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE",
    );
  });

  describe("apertura (AC1-AC6, AC11)", () => {
    it.each(["sender", "receiver", "carrier"] as const)(
      "la abre el %s: el envío pasa a disputed con evento y expediente, y avisa a las tres partes",
      async (role) => {
        const parties = await shipmentIn(ShipmentStatus.IN_TRANSIT);
        const callerId = {
          sender: parties.senderId,
          receiver: parties.receiverId,
          carrier: parties.carrierId,
        }[role];

        const response = await openDispute(parties.shipmentId, callerId);

        expect(response.statusCode).toBe(201);
        const dispute = response.json();
        expect(dispute).toMatchObject({
          shipmentId: parties.shipmentId,
          openedBy: callerId,
          openedByRole: role,
          reason: DisputeReason.DAMAGED,
          description: "El paquete llegó roto",
          status: "open",
          photos: [],
          statements: [],
        });
        expect((await shipmentRepo.findById(parties.shipmentId))?.status).toBe(
          ShipmentStatus.DISPUTED,
        );
        const event = await app.db.shipmentEvent.findFirst({
          where: {
            shipmentId: parties.shipmentId,
            toStatus: ShipmentStatus.DISPUTED,
          },
        });
        expect(event).toMatchObject({
          fromStatus: ShipmentStatus.IN_TRANSIT,
          actorId: callerId,
        });

        expect(sendPush).toHaveBeenCalledTimes(3);
        expect(
          sendPush.mock.calls
            .map(([input]) => (input as { userId: string }).userId)
            .sort(),
        ).toEqual(
          [parties.senderId, parties.receiverId, parties.carrierId].sort(),
        );
        expect(sendPush).toHaveBeenCalledWith(
          expect.objectContaining({
            category: "disputes",
            data: {
              type: "dispute_opened",
              disputeId: dispute.id,
              shipmentId: parties.shipmentId,
            },
          }),
        );
        expect(alertSend).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: "dispute_opened",
            context: expect.objectContaining({ disputeId: dispute.id }),
          }),
        );
      },
    );

    it("403 a quien no es parte, aunque sea admin", async () => {
      const { shipmentId } = await shipmentIn(ShipmentStatus.IN_TRANSIT);

      expect((await openDispute(shipmentId, randomUUID())).statusCode).toBe(
        403,
      );
      const asAdmin = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/disputes`,
        headers: { "x-user-id": randomUUID(), "x-user-roles": "admin" },
        payload: { reason: DisputeReason.DAMAGED, description: "x" },
      });
      expect(asAdmin.statusCode).toBe(403);
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(
        ShipmentStatus.IN_TRANSIT,
      );
    });

    it("DD-054: se abre sobre un completed dentro de los 7 días desde la entrega, sin tocar el hold", async () => {
      const { shipmentId, senderId } = await shipmentIn(
        ShipmentStatus.COMPLETED,
        6,
      );

      const response = await openDispute(shipmentId, senderId, {
        reason: DisputeReason.NOT_DELIVERED,
      });

      expect(response.statusCode).toBe(201);
      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(
        ShipmentStatus.DISPUTED,
      );
      expect(
        await app.db.shipmentEvent.findFirst({
          where: { shipmentId, toStatus: ShipmentStatus.DISPUTED },
        }),
      ).toMatchObject({ fromStatus: ShipmentStatus.COMPLETED });
    });

    it("también sobre un delivered dentro de la ventana", async () => {
      const { shipmentId, receiverId } = await shipmentIn(
        ShipmentStatus.DELIVERED,
        1,
      );
      expect((await openDispute(shipmentId, receiverId)).statusCode).toBe(201);
    });

    it.each([
      [ShipmentStatus.DELIVERED, 8],
      [ShipmentStatus.COMPLETED, 8],
    ])(
      "422 DISPUTE_WINDOW_EXPIRED sobre un %s entregado hace %i días",
      async (status, days) => {
        const { shipmentId, senderId } = await shipmentIn(status, days);

        const response = await openDispute(shipmentId, senderId);

        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe("DISPUTE_WINDOW_EXPIRED");
        expect((await shipmentRepo.findById(shipmentId))?.status).toBe(status);
      },
    );

    it.each([
      ShipmentStatus.ASSIGNED,
      ShipmentStatus.PUBLISHED,
      ShipmentStatus.CANCELLED,
    ])(
      "422 DISPUTE_NOT_ALLOWED desde %s (un assigned solo lo disputa el barrido)",
      async (status) => {
        const { shipmentId, senderId } = await shipmentIn(status);

        const response = await openDispute(shipmentId, senderId);

        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe("DISPUTE_NOT_ALLOWED");
      },
    );

    it("409 DISPUTE_ALREADY_OPEN con el id de la existente", async () => {
      const { shipmentId, senderId, carrierId } = await shipmentIn(
        ShipmentStatus.IN_TRANSIT,
      );
      const first = (await openDispute(shipmentId, senderId)).json();

      const second = await openDispute(shipmentId, carrierId);

      expect(second.statusCode).toBe(409);
      expect(second.json().error).toMatchObject({
        code: "DISPUTE_ALREADY_OPEN",
        details: { disputeId: first.id },
      });
      expect(await app.db.dispute.count({ where: { shipmentId } })).toBe(1);
    });

    it("400 con un motivo de sistema o sin descripción", async () => {
      const { shipmentId, senderId } = await shipmentIn(
        ShipmentStatus.IN_TRANSIT,
      );

      expect(
        (
          await openDispute(shipmentId, senderId, {
            reason: DisputeReason.TRANSIT_ANOMALY,
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await openDispute(shipmentId, senderId, {
            reason: DisputeReason.PICKUP_NO_SHOW,
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (await openDispute(shipmentId, senderId, { description: "" }))
          .statusCode,
      ).toBe(400);
      expect(await app.db.dispute.count()).toBe(0);
    });
  });

  describe("evidencia (AC5)", () => {
    it("asocia las fotos subidas y las devuelve como URLs de lectura", async () => {
      const { shipmentId, senderId } = await shipmentIn(
        ShipmentStatus.IN_TRANSIT,
      );
      const keys = [
        await uploadedPhoto(shipmentId, senderId),
        await uploadedPhoto(shipmentId, senderId),
      ];

      const response = await openDispute(shipmentId, senderId, {
        photoKeys: keys,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().photos).toHaveLength(2);
      expect(
        await app.db.disputePhoto.count({ where: { s3Key: { in: keys } } }),
      ).toBe(2);
      expect(await shipmentRepo.existsPhotoByS3Key(keys[0])).toBe(true);
    });

    it("403 con la foto de otra parte, 422 si no se subió y 400 si pasa el tope de 4", async () => {
      const { shipmentId, senderId, receiverId } = await shipmentIn(
        ShipmentStatus.IN_TRANSIT,
      );
      const foreign = await uploadedPhoto(shipmentId, receiverId);
      expect(
        (await openDispute(shipmentId, senderId, { photoKeys: [foreign] }))
          .statusCode,
      ).toBe(403);

      const presigned = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/disputes/photos/presign`,
        headers: { "x-user-id": senderId },
        payload: JPEG,
      });
      const notUploaded = await openDispute(shipmentId, senderId, {
        photoKeys: [presigned.json().s3Key],
      });
      expect(notUploaded.statusCode).toBe(422);

      const five = await Promise.all(
        Array.from({ length: 5 }, () => uploadedPhoto(shipmentId, senderId)),
      );
      expect(
        (await openDispute(shipmentId, senderId, { photoKeys: five }))
          .statusCode,
      ).toBe(400);

      expect((await shipmentRepo.findById(shipmentId))?.status).toBe(
        ShipmentStatus.IN_TRANSIT,
      );
    });

    it("presign: 403 a quien no es parte", async () => {
      const { shipmentId } = await shipmentIn(ShipmentStatus.IN_TRANSIT);
      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/disputes/photos/presign`,
        headers: { "x-user-id": randomUUID() },
        payload: JPEG,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe("descargos y detalle (AC9, AC10)", () => {
    it("cada contraparte carga un descargo y quien abrió amplía una vez; los intentos extra son 409", async () => {
      const { shipmentId, senderId, receiverId, carrierId } = await shipmentIn(
        ShipmentStatus.IN_TRANSIT,
      );
      const dispute = (await openDispute(shipmentId, senderId)).json();
      const photo = await uploadedPhoto(shipmentId, carrierId);

      expect(
        (await addStatement(dispute.id, carrierId, { photoKeys: [photo] }))
          .statusCode,
      ).toBe(201);
      expect((await addStatement(dispute.id, receiverId)).statusCode).toBe(201);
      expect(
        (await addStatement(dispute.id, senderId, { text: "Más evidencia" }))
          .statusCode,
      ).toBe(201);

      for (const userId of [carrierId, receiverId, senderId]) {
        const again = await addStatement(dispute.id, userId);
        expect(again.statusCode).toBe(409);
        expect(again.json().error.code).toBe(
          "DISPUTE_STATEMENT_ALREADY_SUBMITTED",
        );
      }

      const detail = await app.inject({
        method: "GET",
        url: `/disputes/${dispute.id}`,
        headers: { "x-user-id": receiverId },
      });
      expect(detail.statusCode).toBe(200);
      const statements = detail.json().statements as Array<{
        authorRole: string;
        kind: string;
        photos: unknown[];
      }>;
      expect(statements.map((s) => [s.authorRole, s.kind])).toEqual([
        ["carrier", "statement"],
        ["receiver", "statement"],
        ["sender", "amendment"],
      ]);
      expect(statements[0].photos).toHaveLength(1);
    });

    it("en una disputa de sistema las tres partes cargan descargo y nadie amplía", async () => {
      const { disputeId, senderId, receiverId, carrierId } =
        await systemDispute(
          ShipmentStatus.IN_TRANSIT,
          DisputeReason.TRANSIT_ANOMALY,
        );

      for (const userId of [senderId, receiverId, carrierId]) {
        expect((await addStatement(disputeId, userId)).statusCode).toBe(201);
      }
      const kinds = await app.db.disputeStatement.findMany({
        where: { disputeId },
        select: { kind: true },
      });
      expect(kinds.map((k) => k.kind)).toEqual([
        "statement",
        "statement",
        "statement",
      ]);
    });

    it("409 DISPUTE_NOT_OPEN si ya se resolvió; 403 y 404 al resto", async () => {
      const { shipmentId, senderId, carrierId } = await shipmentIn(
        ShipmentStatus.IN_TRANSIT,
      );
      const dispute = (await openDispute(shipmentId, senderId)).json();

      expect((await addStatement(dispute.id, randomUUID())).statusCode).toBe(
        403,
      );
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/disputes/${dispute.id}`,
            headers: { "x-user-id": randomUUID() },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/disputes/${randomUUID()}`,
            headers: { "x-user-id": senderId },
          })
        ).statusCode,
      ).toBe(404);

      await app.db.dispute.update({
        where: { id: dispute.id },
        data: { status: "resolved" },
      });
      const closed = await addStatement(dispute.id, carrierId);
      expect(closed.statusCode).toBe(409);
      expect(closed.json().error.code).toBe("DISPUTE_NOT_OPEN");
    });
  });

  describe("disputas de sistema y bloqueos (AC7, AC13)", () => {
    it("pasar a disputed sin expediente no es posible", async () => {
      const { shipmentId } = await shipmentIn(ShipmentStatus.IN_TRANSIT);
      await expect(
        shipmentRepo.updateStatus(shipmentId, ShipmentStatus.DISPUTED, null),
      ).rejects.toThrow(/MOVO-334/);
    });

    it("una disputa de una parte bloquea al transportista; la de pickup_no_show no", async () => {
      const userDispute = await shipmentIn(ShipmentStatus.IN_TRANSIT);
      await openDispute(userDispute.shipmentId, userDispute.receiverId);
      expect(
        await shipmentRepo.hasOpenDisputeAsCarrier(userDispute.carrierId),
      ).toBe(true);

      const noShow = await systemDispute(
        ShipmentStatus.ASSIGNED,
        DisputeReason.PICKUP_NO_SHOW,
      );
      expect(await shipmentRepo.hasOpenDisputeAsCarrier(noShow.carrierId)).toBe(
        false,
      );

      const transit = await systemDispute(
        ShipmentStatus.IN_TRANSIT,
        DisputeReason.TRANSIT_ANOMALY,
      );
      expect(
        await shipmentRepo.hasOpenDisputeAsCarrier(transit.carrierId),
      ).toBe(true);
    });

    it("una disputa abierta bloquea la baja de cuenta de las tres partes, sea cual sea el motivo", async () => {
      const noShow = await systemDispute(
        ShipmentStatus.ASSIGNED,
        DisputeReason.PICKUP_NO_SHOW,
      );
      const fromCompleted = await shipmentIn(ShipmentStatus.COMPLETED, 2);
      await openDispute(fromCompleted.shipmentId, fromCompleted.senderId);

      for (const { senderId, receiverId, carrierId } of [
        noShow,
        fromCompleted,
      ]) {
        for (const userId of [senderId, receiverId, carrierId]) {
          expect(
            await shipmentRepo.hasActiveShipmentsForUser(userId),
          ).toMatchObject({ hasActiveDispute: true });
        }
      }
    });
  });

  describe("migración (AC7)", () => {
    it("crea la disputa de sistema de cada envío ya disputado, con el motivo según el evento", async () => {
      const transit = await shipmentIn(ShipmentStatus.DISPUTED);
      const noShow = await shipmentIn(ShipmentStatus.DISPUTED);
      const alreadyMigrated = await systemDispute(
        ShipmentStatus.IN_TRANSIT,
        DisputeReason.TRANSIT_ANOMALY,
      );
      await app.db.shipmentEvent.createMany({
        data: [
          {
            shipmentId: transit.shipmentId,
            fromStatus: ShipmentStatus.IN_TRANSIT,
            toStatus: ShipmentStatus.DISPUTED,
            reason: "demorado",
          },
          {
            shipmentId: noShow.shipmentId,
            fromStatus: ShipmentStatus.ASSIGNED,
            toStatus: ShipmentStatus.DISPUTED,
            reason: "llegó",
          },
        ],
      });

      await app.db.$executeRawUnsafe(
        MIGRATION_SQL.slice(
          MIGRATION_SQL.indexOf('INSERT INTO "shipments"."disputes"'),
        ),
      );

      const disputes = await app.db.dispute.findMany();
      expect(disputes).toHaveLength(3);
      expect(
        disputes.find((d) => d.shipmentId === transit.shipmentId),
      ).toMatchObject({
        reason: "transit_anomaly",
        openedBy: null,
        status: "open",
        description: "demorado",
      });
      expect(
        disputes.find((d) => d.shipmentId === noShow.shipmentId),
      ).toMatchObject({ reason: "pickup_no_show" });
      expect(
        disputes.filter((d) => d.shipmentId === alreadyMigrated.shipmentId),
      ).toHaveLength(1);
      expect(
        await shipmentRepo.hasOpenDisputeAsCarrier(transit.carrierId),
      ).toBe(true);
      expect(await shipmentRepo.hasOpenDisputeAsCarrier(noShow.carrierId)).toBe(
        false,
      );
    });
  });
});
