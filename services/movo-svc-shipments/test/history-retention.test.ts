import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyBaseLogger } from "fastify";
import historyRetentionSweepPlugin from "../src/plugins/history-retention-sweep";
import { EnvConfig } from "../src/config/env";
import { StorageProvider } from "../src/adapters/storage-provider";
import { UserDeletionClient } from "../src/adapters/users-client";
import {
  RetentionRepository,
  ShipmentPurgeCandidate,
  TripPurgeCandidate,
} from "../src/repositories/retention-repository";
import {
  createHistoryRetentionService,
  isHistoryExpired,
  retentionCutoff,
} from "../src/services/history-retention-service";

const NOW = new Date("2032-01-01T00:00:00Z");
const CUTOFF = retentionCutoff(NOW, 5);
const LONG_AGO = new Date("2026-06-01T00:00:00Z");
const RECENTLY = new Date("2030-06-01T00:00:00Z");

describe("isHistoryExpired (MOVO-230)", () => {
  const shipment = { senderId: "s", receiverId: "r", carrierId: "c" };

  it("vence si todas las partes se dieron de baja antes del corte", () => {
    const dates = new Map([["s", LONG_AGO], ["r", LONG_AGO], ["c", LONG_AGO]]);
    expect(isHistoryExpired(shipment, dates, CUTOFF)).toBe(true);
  });

  it("no vence si una parte sigue activa", () => {
    const dates = new Map([["s", LONG_AGO], ["c", LONG_AGO]]);
    expect(isHistoryExpired(shipment, dates, CUTOFF)).toBe(false);
  });

  it("se cuenta desde la última baja: una baja reciente frena la purga aunque las otras sean viejas", () => {
    const dates = new Map([["s", LONG_AGO], ["r", LONG_AGO], ["c", RECENTLY]]);
    expect(isHistoryExpired(shipment, dates, CUTOFF)).toBe(false);
  });

  it("un envío sin transportista solo mira emisor y receptor", () => {
    const dates = new Map([["s", LONG_AGO], ["r", LONG_AGO]]);
    expect(isHistoryExpired({ ...shipment, carrierId: null }, dates, CUTOFF)).toBe(true);
  });

  it("el corte es de 5 años calendario", () => {
    expect(CUTOFF.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

function silentLog(): FastifyBaseLogger {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as FastifyBaseLogger;
}

function fakeRepository(shipments: ShipmentPurgeCandidate[], trips: TripPurgeCandidate[] = []) {
  const deletedShipments: string[] = [];
  const deletedTrips: string[] = [];
  const page = <T extends { id: string }>(rows: T[], limit: number, afterId?: string) =>
    rows.filter((row) => !afterId || row.id > afterId).slice(0, limit);
  const repository: RetentionRepository = {
    findShipmentCandidates: async (_cutoff, limit, afterId) => page(shipments, limit, afterId),
    deleteShipment: async (id) => {
      deletedShipments.push(id);
    },
    findTripCandidates: async (_cutoff, limit, afterId) => page(trips, limit, afterId),
    deleteTrips: async (ids) => {
      deletedTrips.push(...ids);
      return ids.length;
    },
  };
  return { repository, deletedShipments, deletedTrips };
}

function fakeDeletionClient(dates: Record<string, Date>): UserDeletionClient {
  return { findDeletionDates: vi.fn(async (ids: string[]) => new Map(ids.filter((id) => dates[id]).map((id) => [id, dates[id] as Date]))) };
}

function fakeStorage(failingKey?: string) {
  const deleted: string[] = [];
  const storage = {
    deleteObject: vi.fn(async (key: string) => {
      if (key === failingKey) throw new Error("S3 caído");
      deleted.push(key);
    }),
  } as unknown as StorageProvider;
  return { storage, deleted };
}

describe("history-retention-service (MOVO-230)", () => {
  it("purga los envíos vencidos con sus fotos y deja los que tienen una parte activa", async () => {
    const { repository, deletedShipments } = fakeRepository([
      { id: "a", senderId: "s1", receiverId: "r1", carrierId: "c1", photoKeys: ["shipments/a/pickup/1.jpg"] },
      { id: "b", senderId: "s2", receiverId: "r1", carrierId: null, photoKeys: [] },
    ]);
    const client = fakeDeletionClient({ s1: LONG_AGO, r1: LONG_AGO, c1: LONG_AGO });
    const { storage, deleted } = fakeStorage();

    const result = await createHistoryRetentionService(repository, client, storage, silentLog()).purgeExpiredHistory(NOW, 5);

    expect(result).toEqual({ shipments: 1, trips: 0, failed: 0 });
    expect(deletedShipments).toEqual(["a"]);
    expect(deleted).toEqual(["shipments/a/pickup/1.jpg"]);
  });

  it("si falla el borrado en S3, conserva la fila para reintentar", async () => {
    const { repository, deletedShipments } = fakeRepository([
      { id: "a", senderId: "s1", receiverId: "r1", carrierId: null, photoKeys: ["k-ok", "k-falla"] },
    ]);
    const client = fakeDeletionClient({ s1: LONG_AGO, r1: LONG_AGO });
    const { storage } = fakeStorage("k-falla");

    const result = await createHistoryRetentionService(repository, client, storage, silentLog()).purgeExpiredHistory(NOW, 5);

    expect(result).toEqual({ shipments: 0, trips: 0, failed: 1 });
    expect(deletedShipments).toEqual([]);
  });

  it("recorre todas las páginas aunque la primera no tenga nada vencido", async () => {
    const blocked = Array.from({ length: 100 }, (_, i) => ({
      id: `a${String(i).padStart(3, "0")}`,
      senderId: "activo",
      receiverId: "r1",
      carrierId: null,
      photoKeys: [],
    }));
    const { repository, deletedShipments } = fakeRepository([
      ...blocked,
      { id: "b000", senderId: "s1", receiverId: "r1", carrierId: null, photoKeys: [] },
    ]);
    const client = fakeDeletionClient({ s1: LONG_AGO, r1: LONG_AGO });

    await createHistoryRetentionService(repository, client, fakeStorage().storage, silentLog()).purgeExpiredHistory(NOW, 5);

    expect(deletedShipments).toEqual(["b000"]);
    expect(client.findDeletionDates).toHaveBeenCalledTimes(2);
  });

  it("purga los viajes de transportistas dados de baja antes del corte", async () => {
    const { repository, deletedTrips } = fakeRepository(
      [],
      [
        { id: "t1", carrierId: "c-viejo" },
        { id: "t2", carrierId: "c-reciente" },
        { id: "t3", carrierId: "c-activo" },
      ],
    );
    const client = fakeDeletionClient({ "c-viejo": LONG_AGO, "c-reciente": RECENTLY });

    const result = await createHistoryRetentionService(repository, client, fakeStorage().storage, silentLog()).purgeExpiredHistory(NOW, 5);

    expect(result.trips).toBe(1);
    expect(deletedTrips).toEqual(["t1"]);
  });

  it("si svc-users falla, no purga nada y propaga el error", async () => {
    const { repository, deletedShipments } = fakeRepository([
      { id: "a", senderId: "s1", receiverId: "r1", carrierId: null, photoKeys: [] },
    ]);
    const client: UserDeletionClient = { findDeletionDates: vi.fn().mockRejectedValue(new Error("502")) };

    await expect(
      createHistoryRetentionService(repository, client, fakeStorage().storage, silentLog()).purgeExpiredHistory(NOW, 5),
    ).rejects.toThrow("502");
    expect(deletedShipments).toEqual([]);
  });
});

describe("history-retention-sweep plugin (MOVO-230)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function buildApp(enabled: boolean, lockResult: string | null) {
    const app = Fastify();
    app.decorate("config", {
      SHIPMENT_HISTORY_RETENTION_YEARS: 5,
      SHIPMENT_HISTORY_PURGE_SWEEP_INTERVAL_MINUTES: 60,
      SHIPMENT_HISTORY_PURGE_SWEEP_ENABLED: enabled,
    } as EnvConfig);
    const findMany = vi.fn().mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.decorate("db", { shipment: { findMany }, trip: { findMany } } as any);
    const set = vi.fn().mockResolvedValue(lockResult);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.decorate("redis", { set } as any);
    return { app, findMany, set };
  }

  const pluginOpts = { storageProvider: fakeStorage().storage, deletionClient: fakeDeletionClient({}) };

  it("no inicia el timer si está deshabilitado", async () => {
    const { app } = buildApp(false, "OK");
    await app.register(historyRetentionSweepPlugin, pluginOpts);
    await app.ready();

    expect(vi.getTimerCount()).toBe(0);
    await app.close();
  });

  it("con el lock corre la purga; sin el lock no toca la DB", async () => {
    const withLock = buildApp(true, "OK");
    await withLock.app.register(historyRetentionSweepPlugin, pluginOpts);
    await withLock.app.ready();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(withLock.set).toHaveBeenCalledWith("locks:history-retention-sweep", "locked", "PX", expect.any(Number), "NX");
    expect(withLock.findMany).toHaveBeenCalled();
    await withLock.app.close();

    const withoutLock = buildApp(true, null);
    await withoutLock.app.register(historyRetentionSweepPlugin, pluginOpts);
    await withoutLock.app.ready();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(withoutLock.findMany).not.toHaveBeenCalled();
    await withoutLock.app.close();
  });
});
