import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import orphanPhotoSweepPlugin from "../src/plugins/orphan-photo-sweep";
import { EnvConfig } from "../src/config/env";

describe("orphan-photo-sweep plugin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("no inicia el timer si enabled es false o el intervalo es <= 0", async () => {
    const app = Fastify();
    app.decorate("config", {
      ORPHAN_PHOTO_RETENTION_HOURS: 24,
      ORPHAN_PHOTO_SWEEP_INTERVAL_MINUTES: 60,
      ORPHAN_PHOTO_SWEEP_ENABLED: false,
    } as EnvConfig);
    app.decorate("db", {} as any);
    app.decorate("redis", {} as any);

    await app.register(orphanPhotoSweepPlugin, { enabled: false });
    await app.ready();

    expect(vi.getTimerCount()).toBe(0);
    await app.close();
  });

  it("inicia el timer, adquiere el lock, borra huérfanos y deja en paz a los confirmados (AC3)", async () => {
    const app = Fastify();
    app.decorate("config", {
      ORPHAN_PHOTO_RETENTION_HOURS: 24,
      ORPHAN_PHOTO_SWEEP_INTERVAL_MINUTES: 60,
      ORPHAN_PHOTO_SWEEP_ENABLED: true,
    } as EnvConfig);

    app.decorate("db", {
      shipmentPhoto: {
        // "confirmed-key" ya tiene fila en shipment_photos (existsPhotoByS3Key -> true);
        // "orphan-key" nunca se confirmó.
        findFirst: vi.fn(async ({ where }: { where: { s3Key: string } }) =>
          where.s3Key === "shipments/1/creation/confirmed-key.jpg" ? { id: "photo-1" } : null
        ),
      },
    } as any);

    const mockRedisSet = vi.fn().mockResolvedValue("OK");
    const mockZrangebyscore = vi
      .fn()
      .mockResolvedValue(["shipments/1/creation/confirmed-key.jpg", "shipments/1/creation/orphan-key.jpg"]);
    const mockZrem = vi.fn().mockResolvedValue(1);
    const mockUnlink = vi.fn().mockResolvedValue(1);
    app.decorate("redis", {
      set: mockRedisSet,
      zrangebyscore: mockZrangebyscore,
      zrem: mockZrem,
      unlink: mockUnlink,
    } as any);

    const mockDeleteObject = vi.fn().mockResolvedValue(undefined);
    const storageProvider = {
      createUploadUrl: vi.fn(),
      headObject: vi.fn(),
      createDownloadUrl: vi.fn(),
      deleteObject: mockDeleteObject,
    };

    await app.register(orphanPhotoSweepPlugin, { storageProvider, enabled: true });
    await app.ready();

    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(mockRedisSet).toHaveBeenCalledWith(
      "locks:orphan-photo-sweep:shipments",
      "locked",
      "PX",
      expect.any(Number),
      "NX"
    );
    expect(mockZrangebyscore).toHaveBeenCalledWith(
      "photos:pending:shipments",
      "-inf",
      expect.any(Number),
      "LIMIT",
      0,
      100
    );

    // AC3: el candidato ya confirmado en Postgres nunca se borra de S3, solo se
    // destrackea de Redis.
    expect(mockDeleteObject).not.toHaveBeenCalledWith("shipments/1/creation/confirmed-key.jpg");
    expect(mockDeleteObject).toHaveBeenCalledWith("shipments/1/creation/orphan-key.jpg");
    expect(mockZrem).toHaveBeenCalledWith("photos:pending:shipments", "shipments/1/creation/confirmed-key.jpg");
    expect(mockZrem).toHaveBeenCalledWith("photos:pending:shipments", "shipments/1/creation/orphan-key.jpg");

    // Fix de review (PR #96): toma y libera el lock por key para cada candidato
    // -- mismo lock que usa `confirmPhoto()` para cerrar la ventana de TOCTOU entre
    // el chequeo de Postgres de arriba y el `deleteObject`/`zrem`.
    expect(mockRedisSet).toHaveBeenCalledWith(
      "locks:orphan-photo-sweep:key:shipments:shipments/1/creation/orphan-key.jpg",
      "1",
      "PX",
      expect.any(Number),
      "NX"
    );
    expect(mockUnlink).toHaveBeenCalledWith(
      "locks:orphan-photo-sweep:key:shipments:shipments/1/creation/orphan-key.jpg"
    );
    expect(mockUnlink).toHaveBeenCalledWith(
      "locks:orphan-photo-sweep:key:shipments:shipments/1/creation/confirmed-key.jpg"
    );

    await app.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("omite el sweep si no puede adquirir el lock de Redis (otra réplica corriendo)", async () => {
    const app = Fastify();
    app.decorate("config", {
      ORPHAN_PHOTO_RETENTION_HOURS: 24,
      ORPHAN_PHOTO_SWEEP_INTERVAL_MINUTES: 60,
      ORPHAN_PHOTO_SWEEP_ENABLED: true,
    } as EnvConfig);
    app.decorate("db", { shipmentPhoto: { findFirst: vi.fn() } } as any);

    const mockZrangebyscore = vi.fn();
    app.decorate("redis", {
      set: vi.fn().mockResolvedValue(null),
      zrangebyscore: mockZrangebyscore,
      zrem: vi.fn(),
      unlink: vi.fn(),
    } as any);

    await app.register(orphanPhotoSweepPlugin, {
      storageProvider: { createUploadUrl: vi.fn(), headObject: vi.fn(), createDownloadUrl: vi.fn(), deleteObject: vi.fn() },
      enabled: true,
    });
    await app.ready();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(mockZrangebyscore).not.toHaveBeenCalled();

    await app.close();
  });

  it("omite un candidato si confirmPhoto tiene el lock de esa key en este momento (TOCTOU, fix PR #96)", async () => {
    const app = Fastify();
    app.decorate("config", {
      ORPHAN_PHOTO_RETENTION_HOURS: 24,
      ORPHAN_PHOTO_SWEEP_INTERVAL_MINUTES: 60,
      ORPHAN_PHOTO_SWEEP_ENABLED: true,
    } as EnvConfig);

    const mockFindFirst = vi.fn();
    app.decorate("db", { shipmentPhoto: { findFirst: mockFindFirst } } as any);

    const mockZrangebyscore = vi.fn().mockResolvedValue(["shipments/1/creation/contested-key.jpg"]);
    const mockZrem = vi.fn();
    const mockUnlink = vi.fn();
    app.decorate("redis", {
      // El lock global del sweep se adquiere (primer `set`), el lock por key del
      // candidato está tomado por `confirmPhoto()` en este instante (segundo `set`).
      set: vi.fn().mockResolvedValueOnce("OK").mockResolvedValueOnce(null),
      zrangebyscore: mockZrangebyscore,
      zrem: mockZrem,
      unlink: mockUnlink,
    } as any);

    const mockDeleteObject = vi.fn();
    await app.register(orphanPhotoSweepPlugin, {
      storageProvider: { createUploadUrl: vi.fn(), headObject: vi.fn(), createDownloadUrl: vi.fn(), deleteObject: mockDeleteObject },
      enabled: true,
    });
    await app.ready();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    // Nunca llega a evaluar el candidato contra Postgres ni a tocar S3/Redis para
    // esa key -- se saltea entero, se reevalúa en la próxima corrida.
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(mockZrem).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();

    await app.close();
  });
});
