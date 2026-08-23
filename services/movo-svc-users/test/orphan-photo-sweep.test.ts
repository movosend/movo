import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import orphanPhotoSweepPlugin from "../src/plugins/orphan-photo-sweep";
import { EnvConfig } from "../src/config/env";

describe("orphan-photo-sweep plugin (movo-svc-users)", () => {
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

    const publicUrlFor = (key: string) => `https://mock-bucket.s3.mock-region.movo.local/${key}`;

    app.decorate("db", {
      user: {
        // El usuario "confirmed-user" tiene esa key como su photoUrl vigente
        // (existsByPhotoUrl -> true); "orphan-key" nunca se confirmó.
        findFirst: vi.fn(async ({ where }: { where: { photoUrl: string } }) =>
          where.photoUrl === publicUrlFor("profile-photos/confirmed-user/confirmed-key.jpg")
            ? { id: "user-1" }
            : null
        ),
      },
    } as any);

    const mockRedisSet = vi.fn().mockResolvedValue("OK");
    const mockZrangebyscore = vi
      .fn()
      .mockResolvedValue([
        "profile-photos/confirmed-user/confirmed-key.jpg",
        "profile-photos/orphan-user/orphan-key.jpg",
      ]);
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
      getPublicUrl: publicUrlFor,
      getKeyFromUrl: vi.fn(),
      deleteObject: mockDeleteObject,
    };

    await app.register(orphanPhotoSweepPlugin, { storageProvider, enabled: true });
    await app.ready();

    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(mockRedisSet).toHaveBeenCalledWith(
      "locks:orphan-photo-sweep:profile-photos",
      "locked",
      "PX",
      expect.any(Number),
      "NX"
    );
    expect(mockZrangebyscore).toHaveBeenCalledWith(
      "photos:pending:profile-photos",
      "-inf",
      expect.any(Number),
      "LIMIT",
      0,
      100
    );

    // AC3: el candidato ya confirmado en Postgres nunca se borra de S3, solo se
    // destrackea de Redis.
    expect(mockDeleteObject).not.toHaveBeenCalledWith("profile-photos/confirmed-user/confirmed-key.jpg");
    expect(mockDeleteObject).toHaveBeenCalledWith("profile-photos/orphan-user/orphan-key.jpg");
    expect(mockZrem).toHaveBeenCalledWith("photos:pending:profile-photos", "profile-photos/confirmed-user/confirmed-key.jpg");
    expect(mockZrem).toHaveBeenCalledWith("photos:pending:profile-photos", "profile-photos/orphan-user/orphan-key.jpg");

    // Fix de review (PR #96): toma y libera el lock por key para cada candidato --
    // mismo lock que usa `confirmPhoto()` para cerrar la ventana de TOCTOU entre el
    // chequeo de Postgres de arriba y el `deleteObject`/`zrem`.
    expect(mockRedisSet).toHaveBeenCalledWith(
      "locks:orphan-photo-sweep:key:profile-photos:profile-photos/orphan-user/orphan-key.jpg",
      "1",
      "PX",
      expect.any(Number),
      "NX"
    );
    expect(mockUnlink).toHaveBeenCalledWith(
      "locks:orphan-photo-sweep:key:profile-photos:profile-photos/orphan-user/orphan-key.jpg"
    );
    expect(mockUnlink).toHaveBeenCalledWith(
      "locks:orphan-photo-sweep:key:profile-photos:profile-photos/confirmed-user/confirmed-key.jpg"
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
    app.decorate("db", { user: { findFirst: vi.fn() } } as any);

    const mockZrangebyscore = vi.fn();
    app.decorate("redis", {
      set: vi.fn().mockResolvedValue(null),
      zrangebyscore: mockZrangebyscore,
      zrem: vi.fn(),
      unlink: vi.fn(),
    } as any);

    await app.register(orphanPhotoSweepPlugin, {
      storageProvider: {
        createUploadUrl: vi.fn(),
        headObject: vi.fn(),
        getPublicUrl: vi.fn(),
        getKeyFromUrl: vi.fn(),
        deleteObject: vi.fn(),
      },
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
    app.decorate("db", { user: { findFirst: mockFindFirst } } as any);

    const mockZrangebyscore = vi.fn().mockResolvedValue(["profile-photos/contested-user/contested-key.jpg"]);
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
      storageProvider: {
        createUploadUrl: vi.fn(),
        headObject: vi.fn(),
        getPublicUrl: vi.fn(),
        getKeyFromUrl: vi.fn(),
        deleteObject: mockDeleteObject,
      },
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
