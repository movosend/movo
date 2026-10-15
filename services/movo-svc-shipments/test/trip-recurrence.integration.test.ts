import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll, Mock, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { AccountStatus, ApiError, KycStatus, TripStatus, argentinaWeekday } from "@movo/shared";
import { buildApp } from "../src/app";
import { createTripRepository, TripRepository } from "../src/repositories/trip-repository";
import { CreateTripInput, Trip } from "../src/models/trip";
import { generateRecurringOccurrences, TripRecurrenceDeps } from "../src/modules/trips/trip-recurrence";
import { UsersClient } from "../src/adapters/users-client";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";
import { PublicProfile } from "@movo/shared";
import { createFakePaymentsClient } from "./fake-payments-client";
import { createFakeNotificationsClient } from "./fake-notifications-client";
import { createFakePricingLogisticsClient } from "./fake-pricing-logistics-client";
import { attachAcceptedPackage } from "./trip-package-fixture";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * MOVO-265 (ADR-042): viajes recurrentes contra Postgres real. La idempotencia de la
 * generación (UNIQUE de `generated_from_trip_id`), el compare-and-swap del corte y la
 * excepción de `TRIP_HAS_ACCEPTED_PACKAGES` no se pueden probar con un repositorio fake.
 */
describe("viajes recurrentes (MOVO-265)", () => {
  let app: FastifyInstance;
  let tripRepo: TripRepository;
  // `GET /trips` exige el perfil verificado del transportista (`assertVerifiedCarrier`).
  const profiles: Record<string, PublicProfile> = {};

  function tripInput(overrides: Partial<CreateTripInput> = {}): CreateTripInput {
    return {
      carrierId: randomUUID(),
      originAddress: "Av. Colón 1234, Córdoba",
      originLat: -31.4201,
      originLng: -64.1888,
      destinationAddress: "Av. San Martín 100, Villa María",
      destinationLat: -32.4104,
      destinationLng: -63.2404,
      departureAt: new Date(Date.now() + DAY_MS),
      vehicleType: "auto",
      ...overrides,
    };
  }

  /** Trip recurrente que ya salió (candidato del barrido), con `seriesId = id`. */
  async function createPastRecurringTrip(overrides: Partial<CreateTripInput> = {}): Promise<Trip> {
    const departureAt = overrides.departureAt ?? new Date(Date.now() - 2 * HOUR_MS);
    const id = randomUUID();
    return tripRepo.create(
      tripInput({
        id,
        seriesId: id,
        departureAt,
        recurrenceWeekdays: [argentinaWeekday(departureAt)],
        ...overrides,
      }),
    );
  }

  function recurrenceDeps(overrides: Partial<TripRecurrenceDeps> = {}) {
    const notificationsClient = createFakeNotificationsClient();
    const deps: TripRecurrenceDeps = {
      tripRepository: tripRepo,
      usersClient: createFakeUsersClient({}),
      paymentsClient: createFakePaymentsClient(),
      notificationsClient,
      ...overrides,
    };
    return { deps, sendPush: notificationsClient.sendPush as Mock };
  }

  async function successorOf(tripId: string) {
    return app.db.trip.findUnique({ where: { generatedFromTripId: tripId } });
  }

  function headers(carrierId: string) {
    return { "x-user-id": carrierId, "x-user-roles": "carrier" };
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({
      tripExpirySweepEnabled: false,
      usersClient: createFakeUsersClient(profiles),
      paymentsClient: createFakePaymentsClient(),
      notificationsClient: createFakeNotificationsClient(),
      pricingLogisticsClient: createFakePricingLogisticsClient(),
    });
    await app.ready();
    tripRepo = createTripRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments, shipments.trips RESTART IDENTITY CASCADE");
  });

  describe("generación de la ocurrencia siguiente", () => {
    it("declara la siguiente a la misma hora de pared, copia ruta y recurrencia, y avisa", async () => {
      const head = await createPastRecurringTrip({ recurrenceUntil: "2099-12-31" });
      const { deps, sendPush } = recurrenceDeps();

      const result = await generateRecurringOccurrences(deps);

      expect(result.generated).toBe(1);
      const next = await tripRepo.findById((await successorOf(head.id))!.id);
      expect(next).toMatchObject({
        status: TripStatus.DECLARED,
        carrierId: head.carrierId,
        originAddress: head.originAddress,
        destinationAddress: head.destinationAddress,
        vehicleType: head.vehicleType,
        recurrenceWeekdays: head.recurrenceWeekdays,
        recurrenceUntil: "2099-12-31",
        seriesId: head.id,
        generatedFromTripId: head.id,
        isSeriesHead: true,
      });
      expect(next!.departureAt.getTime()).toBe(head.departureAt.getTime() + 7 * DAY_MS);
      expect((await tripRepo.findById(head.id))!.isSeriesHead).toBe(false);
      expect(sendPush).toHaveBeenCalledTimes(1);
      expect(sendPush.mock.calls[0][0]).toMatchObject({
        userId: head.carrierId,
        category: "trips",
        data: { type: "trip_recurrence_generated", tripId: next!.id },
      });
      expect((sendPush.mock.calls[0][0] as { body: string }).body).toContain("Av. San Martín 100");
    });

    it("es idempotente ante una segunda corrida y ante corridas concurrentes", async () => {
      const head = await createPastRecurringTrip();
      const { deps, sendPush } = recurrenceDeps();

      await Promise.all([generateRecurringOccurrences(deps), generateRecurringOccurrences(deps)]);
      await generateRecurringOccurrences(deps);

      expect(await app.db.trip.count({ where: { seriesId: head.id } })).toBe(2);
      expect(sendPush).toHaveBeenCalledTimes(1);
    });

    it("si otra corrida ya generó la ocurrencia, la cuenta como alreadyGenerated y no avisa", async () => {
      await createPastRecurringTrip();
      const base = recurrenceDeps();
      const deps: TripRecurrenceDeps = {
        ...base.deps,
        tripRepository: { ...tripRepo, createRecurrenceSuccessor: async () => null },
      };

      const result = await generateRecurringOccurrences(deps);

      expect(result).toEqual({ generated: 0, stopped: 0, deferred: 0, alreadyGenerated: 1 });
      expect(base.sendPush).not.toHaveBeenCalled();
    });

    it("con más de una página de candidatos no saltea ninguno y loguea el resumen de la corrida", async () => {
      // 101 series: la primera página (100) queda generada y deja de cumplir el filtro de
      // candidatos; la 101 tiene que aparecer igual en la segunda página.
      const heads = await Promise.all(
        Array.from({ length: 101 }, (_, i) =>
          createPastRecurringTrip({ departureAt: new Date(Date.now() - 2 * HOUR_MS - i * 60_000) }),
        ),
      );
      const info = vi.fn();
      const { deps } = recurrenceDeps({ logger: { info, warn: vi.fn() } });

      const result = await generateRecurringOccurrences(deps);

      expect(result).toEqual({ generated: 101, stopped: 0, deferred: 0, alreadyGenerated: 0 });
      for (const head of heads) {
        expect(await successorOf(head.id)).not.toBeNull();
      }
      expect(info).toHaveBeenCalledWith(
        { event: "trip_recurrence_run", generated: 101, stopped: 0, deferred: 0, alreadyGenerated: 0 },
        expect.any(String),
      );
    });

    it.each([TripStatus.ACTIVE, TripStatus.EXPIRED, TripStatus.CANCELLED, TripStatus.COMPLETED])(
      "genera aunque el vigente esté %s",
      async (status) => {
        const head = await createPastRecurringTrip();
        await app.db.trip.update({ where: { id: head.id }, data: { status } });

        await generateRecurringOccurrences(recurrenceDeps().deps);

        expect(await successorOf(head.id)).not.toBeNull();
      },
    );

    it("no genera nada para un trip no recurrente ni para uno que todavía no salió", async () => {
      await tripRepo.create(tripInput({ departureAt: new Date(Date.now() - HOUR_MS) }));
      await createPastRecurringTrip({ departureAt: new Date(Date.now() + DAY_MS) });

      const result = await generateRecurringOccurrences(recurrenceDeps().deps);

      expect(result).toEqual({ generated: 0, stopped: 0, deferred: 0, alreadyGenerated: 0 });
      expect(await app.db.trip.count()).toBe(2);
    });

    it("con la fecha siguiente fuera de recurrenceUntil, apaga la serie sin avisar", async () => {
      const departureAt = new Date(Date.now() - 2 * HOUR_MS);
      // Mañana es el último día: la próxima ocurrencia (en 7 días) ya no entra.
      const until = new Date(Date.now() + DAY_MS).toISOString().slice(0, 10);
      const head = await createPastRecurringTrip({ departureAt, recurrenceUntil: until });
      const { deps, sendPush } = recurrenceDeps();

      const result = await generateRecurringOccurrences(deps);

      expect(result.stopped).toBe(1);
      expect(await successorOf(head.id)).toBeNull();
      expect(await tripRepo.findById(head.id)).toMatchObject({ recurrenceWeekdays: null, recurrenceUntil: null, seriesId: head.id });
      expect(sendPush).not.toHaveBeenCalled();
    });
  });

  describe("corte automático", () => {
    /** Cadena de `statuses.length` trips, del más viejo al más nuevo; devuelve el vigente. */
    async function createChain(statuses: TripStatus[]): Promise<Trip> {
      let previous = await createPastRecurringTrip({ departureAt: new Date(Date.now() - 15 * DAY_MS) });
      await app.db.trip.update({
        where: { id: previous.id },
        data: { status: statuses[0], createdAt: new Date(Date.now() - 15 * DAY_MS) },
      });
      for (let i = 1; i < statuses.length; i++) {
        const created = await tripRepo.createRecurrenceSuccessor({
          ...tripInput({ carrierId: previous.carrierId }),
          departureAt: new Date(previous.departureAt.getTime() + 7 * DAY_MS),
          recurrenceWeekdays: previous.recurrenceWeekdays,
          seriesId: previous.seriesId,
          generatedFromTripId: previous.id,
        });
        await app.db.trip.update({
          where: { id: created!.id },
          data: { status: statuses[i], createdAt: new Date(Date.now() - (15 - 7 * i) * DAY_MS) },
        });
        previous = (await tripRepo.findById(created!.id))!;
      }
      return previous;
    }

    it("corta la serie fantasma (3 expired seguidos) y avisa con el copy de 'últimos 3 viajes'", async () => {
      const head = await createChain([TripStatus.EXPIRED, TripStatus.EXPIRED, TripStatus.EXPIRED]);
      const { deps, sendPush } = recurrenceDeps();

      const result = await generateRecurringOccurrences(deps);

      expect(result.stopped).toBe(1);
      expect(await successorOf(head.id)).toBeNull();
      expect((await tripRepo.findById(head.id))!.recurrenceWeekdays).toBeNull();
      expect(sendPush).toHaveBeenCalledTimes(1);
      expect(sendPush.mock.calls[0][0]).toMatchObject({ data: { type: "trip_recurrence_stopped", tripId: head.id } });
      expect((sendPush.mock.calls[0][0] as { body: string }).body).toContain("no saliste en tus últimos 3 viajes");
    });

    it("una cancelled en el medio resetea la racha", async () => {
      const head = await createChain([TripStatus.EXPIRED, TripStatus.CANCELLED, TripStatus.EXPIRED]);

      await generateRecurringOccurrences(recurrenceDeps().deps);

      expect(await successorOf(head.id)).not.toBeNull();
    });

    it.each([
      ["cuenta banned", { accountStatus: AccountStatus.BANNED }],
      ["suspensión temporal vigente", { bannedUntil: new Date(Date.now() + DAY_MS).toISOString() }],
      ["falta la licencia", { kycStatusLicense: KycStatus.PENDING }],
    ])("corta la serie si %s", async (_label, kycOverride) => {
      const head = await createPastRecurringTrip();
      const usersClient = createFakeUsersClient({}, {}, [], { [head.carrierId]: kycOverride });
      const { deps, sendPush } = recurrenceDeps({ usersClient });

      const result = await generateRecurringOccurrences(deps);

      expect(result.stopped).toBe(1);
      expect(await successorOf(head.id)).toBeNull();
      expect((await tripRepo.findById(head.id))!.recurrenceWeekdays).toBeNull();
      expect((sendPush.mock.calls[0][0] as { body: string }).body).toContain("No pudimos declarar tu próximo viaje");
    });

    it("una suspensión temporal ya vencida no corta", async () => {
      const head = await createPastRecurringTrip();
      const usersClient = createFakeUsersClient({}, {}, [], {
        [head.carrierId]: { bannedUntil: new Date(Date.now() - DAY_MS).toISOString() },
      });

      await generateRecurringOccurrences(recurrenceDeps({ usersClient }).deps);

      expect(await successorOf(head.id)).not.toBeNull();
    });

    it("corta la serie si la cuenta se dio de baja (svc-users responde 404)", async () => {
      const head = await createPastRecurringTrip();
      const base = createFakeUsersClient({});
      const usersClient: UsersClient = { ...base, findKycStatus: async () => null };

      const result = await generateRecurringOccurrences(recurrenceDeps({ usersClient }).deps);

      expect(result.stopped).toBe(1);
      expect(await successorOf(head.id)).toBeNull();
    });

    it("si svc-users no informa el estado de la cuenta (versión anterior), posterga sin cortar", async () => {
      const head = await createPastRecurringTrip();
      const base = createFakeUsersClient({});
      const usersClient: UsersClient = {
        ...base,
        findKycStatus: async () => ({ kycStatusIdentity: KycStatus.APPROVED, kycStatusLicense: KycStatus.APPROVED }),
      };

      const result = await generateRecurringOccurrences(recurrenceDeps({ usersClient }).deps);

      expect(result).toEqual({ generated: 0, stopped: 0, deferred: 1, alreadyGenerated: 0 });
      expect((await tripRepo.findById(head.id))!.recurrenceWeekdays).toEqual(head.recurrenceWeekdays);
    });

    it("corta la serie si el transportista no tiene MP vinculado", async () => {
      const head = await createPastRecurringTrip();
      const paymentsClient = createFakePaymentsClient([head.carrierId]);

      const result = await generateRecurringOccurrences(recurrenceDeps({ paymentsClient }).deps);

      expect(result.stopped).toBe(1);
      expect((await tripRepo.findById(head.id))!.recurrenceWeekdays).toBeNull();
    });

    it.each(["users", "payments"])("con svc-%s caído no genera ni corta, y la corrida siguiente genera", async (down) => {
      const head = await createPastRecurringTrip();
      const unavailable = async () => {
        throw new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "caído");
      };
      const base = recurrenceDeps();
      const failing: TripRecurrenceDeps =
        down === "users"
          ? { ...base.deps, usersClient: { ...base.deps.usersClient, findKycStatus: unavailable } }
          : { ...base.deps, paymentsClient: { ...base.deps.paymentsClient, getCarrierMpAccountStatus: unavailable } };

      const first = await generateRecurringOccurrences(failing);
      expect(first).toEqual({ generated: 0, stopped: 0, deferred: 1, alreadyGenerated: 0 });
      expect(await successorOf(head.id)).toBeNull();
      expect((await tripRepo.findById(head.id))!.recurrenceWeekdays).toEqual(head.recurrenceWeekdays);
      expect(base.sendPush).not.toHaveBeenCalled();

      const second = await generateRecurringOccurrences(base.deps);
      expect(second.generated).toBe(1);
      // La fecha sale de max(departureAt, now): nunca nace vencida.
      expect((await successorOf(head.id))!.departureAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("POST /trips y PATCH /trips/:id", () => {
    function futureDeparture(daysAhead = 2) {
      return new Date(Date.now() + daysAhead * DAY_MS);
    }

    it("POST /trips con recurrenceWeekdays crea el primero de la serie (seriesId = id)", async () => {
      const carrierId = randomUUID();
      const departureAt = futureDeparture();
      const res = await app.inject({
        method: "POST",
        url: "/trips",
        headers: headers(carrierId),
        payload: {
          ...tripInput(),
          carrierId: undefined,
          departureAt: departureAt.toISOString(),
          recurrenceWeekdays: [argentinaWeekday(departureAt)],
          recurrenceUntil: "2099-01-01",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toMatchObject({
        recurrenceWeekdays: [argentinaWeekday(departureAt)],
        recurrenceUntil: "2099-01-01",
        seriesId: body.id,
        generatedFromTripId: null,
        isSeriesHead: true,
      });
    });

    it("POST /trips sin recurrencia expone los campos en null", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/trips",
        headers: headers(randomUUID()),
        payload: { ...tripInput(), carrierId: undefined, departureAt: futureDeparture().toISOString() },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ recurrenceWeekdays: null, recurrenceUntil: null, seriesId: null, isSeriesHead: true });
    });

    it.each([
      ["sin el día de salida", (day: number) => ({ recurrenceWeekdays: [(day + 1) % 7] })],
      ["con días repetidos", (day: number) => ({ recurrenceWeekdays: [day, day] })],
      ["con un día fuera de rango", (day: number) => ({ recurrenceWeekdays: [day, 7] })],
      ["sin días", () => ({ recurrenceWeekdays: [] })],
      ["con recurrenceUntil anterior a la salida", (day: number) => ({ recurrenceWeekdays: [day], recurrenceUntil: "2020-01-01" })],
    ])("POST /trips responde 400 %s", async (_label, recurrence) => {
      const departureAt = futureDeparture();
      const res = await app.inject({
        method: "POST",
        url: "/trips",
        headers: headers(randomUUID()),
        payload: {
          ...tripInput(),
          carrierId: undefined,
          departureAt: departureAt.toISOString(),
          ...recurrence(argentinaWeekday(departureAt)),
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("409 RECURRING_SERIES_LIMIT al prender una cuarta serie; cambiar los días de una activa no cuenta", async () => {
      const carrierId = randomUUID();
      const heads: Trip[] = [];
      for (let i = 0; i < 3; i++) heads.push(await createPastRecurringTrip({ carrierId, departureAt: futureDeparture(i + 1) }));
      const plain = await tripRepo.create(tripInput({ carrierId, departureAt: futureDeparture(5) }));

      const fourth = await app.inject({
        method: "PATCH",
        url: `/trips/${plain.id}`,
        headers: headers(carrierId),
        payload: { recurrenceWeekdays: [argentinaWeekday(plain.departureAt)] },
      });
      expect(fourth.statusCode).toBe(409);
      expect(fourth.json().error.code).toBe("RECURRING_SERIES_LIMIT");

      const day = argentinaWeekday(heads[0].departureAt);
      const edit = await app.inject({
        method: "PATCH",
        url: `/trips/${heads[0].id}`,
        headers: headers(carrierId),
        payload: { recurrenceWeekdays: [day, (day + 3) % 7] },
      });
      expect(edit.statusCode).toBe(200);
      expect(edit.json().recurrenceWeekdays).toEqual([day, (day + 3) % 7]);
    });

    it("prender la recurrencia en un trip existente fija seriesId = id", async () => {
      const trip = await tripRepo.create(tripInput({ departureAt: futureDeparture() }));

      const res = await app.inject({
        method: "PATCH",
        url: `/trips/${trip.id}`,
        headers: headers(trip.carrierId),
        payload: { recurrenceWeekdays: [argentinaWeekday(trip.departureAt)] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ seriesId: trip.id, isSeriesHead: true });
    });

    it("con paquetes aceptados solo se permite apagar la recurrencia; cambiarla o un PATCH mixto da 409", async () => {
      const head = await createPastRecurringTrip({ departureAt: futureDeparture(), recurrenceUntil: "2099-01-01" });
      await attachAcceptedPackage(app.db, head);
      const day = argentinaWeekday(head.departureAt);

      for (const payload of [
        { recurrenceWeekdays: [day, (day + 2) % 7] },
        { recurrenceUntil: "2099-06-30" },
        { recurrenceWeekdays: [day], departureAt: futureDeparture(9).toISOString() },
      ]) {
        const res = await app.inject({
          method: "PATCH",
          url: `/trips/${head.id}`,
          headers: headers(head.carrierId),
          payload,
        });
        expect(res.statusCode).toBe(409);
        expect(res.json().error.code).toBe("TRIP_HAS_ACCEPTED_PACKAGES");
      }

      const stop = await app.inject({
        method: "PATCH",
        url: `/trips/${head.id}`,
        headers: headers(head.carrierId),
        payload: { recurrenceWeekdays: null },
      });
      expect(stop.statusCode).toBe(200);
      expect(stop.json()).toMatchObject({ recurrenceWeekdays: null, recurrenceUntil: null, seriesId: head.id });
    });

    it("recurrenceWeekdays: null apaga la serie, limpia recurrenceUntil y conserva seriesId", async () => {
      const head = await createPastRecurringTrip({ departureAt: futureDeparture(), recurrenceUntil: "2099-01-01" });

      const res = await app.inject({
        method: "PATCH",
        url: `/trips/${head.id}`,
        headers: headers(head.carrierId),
        payload: { recurrenceWeekdays: null },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ recurrenceWeekdays: null, recurrenceUntil: null, seriesId: head.id });
    });

    it("editar la recurrencia de un trip que no es el vigente da 409 TRIP_NOT_SERIES_HEAD", async () => {
      const head = await createPastRecurringTrip();
      await generateRecurringOccurrences(recurrenceDeps().deps);

      const res = await app.inject({
        method: "PATCH",
        url: `/trips/${head.id}`,
        headers: headers(head.carrierId),
        payload: { recurrenceWeekdays: null },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("TRIP_NOT_SERIES_HEAD");
    });

    it("GET /trips expone isSeriesHead y generatedFromTripId", async () => {
      const head = await createPastRecurringTrip();
      await generateRecurringOccurrences(recurrenceDeps().deps);

      profiles[head.carrierId] = fakePublicProfile({ id: head.carrierId, isVerified: true });

      const res = await app.inject({ method: "GET", url: "/trips", headers: headers(head.carrierId) });

      expect(res.statusCode).toBe(200);
      const items = res.json().items as Array<{ id: string; isSeriesHead: boolean; generatedFromTripId: string | null }>;
      expect(items.find((item) => item.id === head.id)).toMatchObject({ isSeriesHead: false, generatedFromTripId: null });
      expect(items.find((item) => item.id !== head.id)).toMatchObject({ isSeriesHead: true, generatedFromTripId: head.id });
    });
  });

  describe("POST /trips/:id/cancel con stopRecurrence", () => {
    it("sin el flag cancela solo la ocurrencia y la serie sigue", async () => {
      const head = await createPastRecurringTrip({ departureAt: new Date(Date.now() + DAY_MS) });

      const res = await app.inject({ method: "POST", url: `/trips/${head.id}/cancel`, headers: headers(head.carrierId) });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: TripStatus.CANCELLED, recurrenceWeekdays: head.recurrenceWeekdays });
    });

    it("con stopRecurrence: true cancela y apaga la recurrencia en la misma operación", async () => {
      const head = await createPastRecurringTrip({ departureAt: new Date(Date.now() + DAY_MS) });

      const res = await app.inject({
        method: "POST",
        url: `/trips/${head.id}/cancel`,
        headers: headers(head.carrierId),
        payload: { stopRecurrence: true },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: TripStatus.CANCELLED, recurrenceWeekdays: null, seriesId: head.id });
    });

    it("el flag se ignora sobre un trip no recurrente", async () => {
      const trip = await tripRepo.create(tripInput());

      const res = await app.inject({
        method: "POST",
        url: `/trips/${trip.id}/cancel`,
        headers: headers(trip.carrierId),
        payload: { stopRecurrence: true },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: TripStatus.CANCELLED, recurrenceWeekdays: null });
    });

    it("el flag no apaga la serie desde un trip que ya no es el vigente", async () => {
      const head = await createPastRecurringTrip();
      await generateRecurringOccurrences(recurrenceDeps().deps);
      const next = (await successorOf(head.id))!;

      const cancelled = await tripRepo.cancel(head.id, { stopRecurrence: true });

      expect(cancelled.status).toBe(TripStatus.CANCELLED);
      expect((await tripRepo.findById(next.id))!.recurrenceWeekdays).toEqual(head.recurrenceWeekdays);
    });
  });
});
