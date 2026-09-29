import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createMockStorageProvider, MockStorageProvider } from "../src/adapters/mock-storage-provider";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput } from "../src/models/user";
import { isReportPhotoKeyConflict } from "../src/repositories/moderation-repository";
import {
  PENDING_REPORT_PHOTOS_REDIS_KEY,
  reportPhotoLockKey,
  reportRateLimitKey,
} from "../src/modules/moderation/moderation.service";

describe("Fotos de un reporte de usuario (MOVO-256)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;
  let storage: MockStorageProvider;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    storage = createMockStorageProvider();
    app = buildApp({ storageProvider: storage, orphanPhotoSweepEnabled: false });
    await app.ready();
    repo = createUserRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
    const keys = [
      ...(await app.redis.keys("user-report-attempts:*")),
      ...(await app.redis.keys("locks:orphan-photo-sweep:key:reports:*")),
    ];
    if (keys.length > 0) {
      await app.redis.del(...keys);
    }
    await app.redis.del(PENDING_REPORT_PHOTOS_REDIS_KEY);
  });

  function buildInput(overrides: Partial<CreateUserInput> = {}): CreateUserInput {
    return {
      email: `user-${randomUUID()}@movo.test`,
      phone: `+549351${Math.floor(1000000 + Math.random() * 8999999)}`,
      firstName: "Alena",
      lastName: "Ariza",
      passwordHash: "hashed_password",
      roles: [UserRole.SENDER, UserRole.CARRIER],
      phoneVerified: true,
      address: {
        street: "Av. Colón",
        number: "1234",
        city: "Córdoba",
        province: "Córdoba",
        zip: "5000",
        lat: -31.4201,
        long: -64.1888,
      },
      ...overrides,
    };
  }

  function presign(callerId: string, targetId: string, payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: `/users/${targetId}/report/photos/presign`,
      headers: { "x-user-id": callerId },
      payload,
    });
  }

  /** Presign + PUT simulado: devuelve una key lista para asociar. */
  async function uploadedKey(callerId: string, targetId: string): Promise<string> {
    const response = await presign(callerId, targetId, { contentType: "image/jpeg", contentLength: 1024 });
    const { s3Key } = JSON.parse(response.body) as { s3Key: string };
    storage.__simulateUpload(s3Key, { contentType: "image/jpeg", contentLength: 1024 });
    return s3Key;
  }

  function report(callerId: string, targetId: string, payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: `/users/${targetId}/report`,
      headers: { "x-user-id": callerId },
      payload,
    });
  }

  function addEntry(callerId: string, targetId: string, payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: `/users/${targetId}/report/entries`,
      headers: { "x-user-id": callerId },
      payload,
    });
  }

  function getReport(callerId: string, targetId: string) {
    return app.inject({ method: "GET", url: `/users/${targetId}/report`, headers: { "x-user-id": callerId } });
  }

  async function pair() {
    const a = await repo.create(buildInput());
    const b = await repo.create(buildInput());
    return { a, b };
  }

  describe("POST /users/:id/report/photos/presign", () => {
    it("firma una key bajo reports/{callerId}/ y la registra como pendiente para el sweep", async () => {
      const { a, b } = await pair();

      const response = await presign(a.id, b.id, { contentType: "image/jpeg", contentLength: 2048 });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.s3Key).toMatch(new RegExp(`^reports/${a.id}/[0-9a-f-]{36}\\.jpg$`));
      expect(body.uploadUrl).toContain(body.s3Key);
      expect(body.expiresIn).toBeGreaterThan(0);
      expect(await app.redis.zscore(PENDING_REPORT_PHOTOS_REDIS_KEY, body.s3Key)).not.toBeNull();
    });

    it("rechaza lo que no sea JPEG o pese más de 2 MB (400)", async () => {
      const { a, b } = await pair();

      const png = await presign(a.id, b.id, { contentType: "image/png", contentLength: 1024 });
      const heavy = await presign(a.id, b.id, { contentType: "image/jpeg", contentLength: 2 * 1024 * 1024 + 1 });

      expect(png.statusCode).toBe(400);
      expect(heavy.statusCode).toBe(400);
    });

    it("no consume cupo diario", async () => {
      const { a, b } = await pair();

      await presign(a.id, b.id, { contentType: "image/jpeg", contentLength: 1024 });

      expect(await app.redis.get(reportRateLimitKey(a.id))).toBeNull();
    });

    it("400 CANNOT_MODERATE_SELF sobre uno mismo", async () => {
      const { a } = await pair();

      const response = await presign(a.id, a.id, { contentType: "image/jpeg", contentLength: 1024 });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe("CANNOT_MODERATE_SELF");
    });
  });

  describe("asociar fotos al reporte y a las entradas", () => {
    it("el reporte original guarda sus fotos, las destrackea del sweep y el GET las devuelve con presigned GET", async () => {
      const { a, b } = await pair();
      const k1 = await uploadedKey(a.id, b.id);
      const k2 = await uploadedKey(a.id, b.id);

      const created = await report(a.id, b.id, { reason: "damaged_package", photoKeys: [k1, k2] });

      expect(created.statusCode).toBe(201);
      expect(JSON.parse(created.body).photos).toHaveLength(2);
      expect(await app.redis.zscore(PENDING_REPORT_PHOTOS_REDIS_KEY, k1)).toBeNull();
      expect(await app.redis.zscore(PENDING_REPORT_PHOTOS_REDIS_KEY, k2)).toBeNull();

      const fetched = JSON.parse((await getReport(a.id, b.id)).body);
      expect(fetched.photos).toHaveLength(2);
      for (const photo of fetched.photos) {
        // Prefijo privado: presigned GET, nunca la URL pública de `profile-photos/*`.
        expect(photo.url).toContain("mock-download=");
        expect(photo.url).not.toBe(storage.getPublicUrl(k1));
        expect(photo.expiresIn).toBeGreaterThan(0);
      }
      expect(fetched.entries).toEqual([]);
    });

    it("una entrada puede ser solo fotos; cada envío conserva las suyas", async () => {
      const { a, b } = await pair();
      const original = await uploadedKey(a.id, b.id);
      await report(a.id, b.id, { reason: "damaged_package", details: "llegó roto", photoKeys: [original] });
      const later = await uploadedKey(a.id, b.id);

      const response = await addEntry(a.id, b.id, { photoKeys: [later] });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.photos).toHaveLength(1);
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0]).toMatchObject({ details: null });
      expect(body.entries[0].photos).toHaveLength(1);

      const rows = await app.db.userReportPhoto.findMany({ orderBy: { createdAt: "asc" } });
      expect(rows.map((row) => row.s3Key)).toEqual([original, later]);
      expect(rows[0]!.entryId).toBeNull();
      expect(rows[1]!.entryId).toBe(body.entries[0].id);
    });

    it("una entrada con texto y fotos consume un solo cupo", async () => {
      const { a, b } = await pair();
      await report(a.id, b.id, { reason: "other" });
      const key = await uploadedKey(a.id, b.id);

      const response = await addEntry(a.id, b.id, { details: "otra cosa", photoKeys: [key] });

      expect(response.statusCode).toBe(201);
      expect(await app.redis.get(reportRateLimitKey(a.id))).toBe("2");
    });

    it("400 si la entrada no trae ni texto ni fotos", async () => {
      const { a, b } = await pair();
      await report(a.id, b.id, { reason: "other" });

      const empty = await addEntry(a.id, b.id, {});
      const blank = await addEntry(a.id, b.id, { details: "   ", photoKeys: [] });

      expect(empty.statusCode).toBe(400);
      expect(blank.statusCode).toBe(400);
      expect(await app.redis.get(reportRateLimitKey(a.id))).toBe("1");
    });
  });

  describe("rechazos", () => {
    it("403 PHOTO_FORBIDDEN_KEY con una key de otro usuario, sin crear el reporte ni consumir cupo", async () => {
      const { a, b } = await pair();
      const c = await repo.create(buildInput());
      const foreign = await uploadedKey(c.id, b.id);

      const response = await report(a.id, b.id, { reason: "other", photoKeys: [foreign] });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error.code).toBe("PHOTO_FORBIDDEN_KEY");
      expect(await app.db.userReport.count()).toBe(0);
      expect(await app.redis.get(reportRateLimitKey(a.id))).toBeNull();
    });

    it("422 PHOTO_OBJECT_NOT_FOUND si la foto nunca se subió", async () => {
      const { a, b } = await pair();
      const presigned = JSON.parse(
        (await presign(a.id, b.id, { contentType: "image/jpeg", contentLength: 1024 })).body,
      ) as { s3Key: string };

      const response = await report(a.id, b.id, { reason: "other", photoKeys: [presigned.s3Key] });

      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).error.code).toBe("PHOTO_OBJECT_NOT_FOUND");
      expect(await app.db.userReport.count()).toBe(0);
    });

    it("400 si el objeto subido no es JPEG o supera el tamaño (HEAD real, no lo declarado)", async () => {
      const { a, b } = await pair();
      const key = await uploadedKey(a.id, b.id);
      storage.__simulateUpload(key, { contentType: "image/png", contentLength: 1024 });

      const response = await report(a.id, b.id, { reason: "other", photoKeys: [key] });

      expect(response.statusCode).toBe(400);
    });

    it("409 REPORT_PHOTO_ALREADY_USED al reusar una foto ya asociada, sin consumir cupo", async () => {
      const { a, b } = await pair();
      const key = await uploadedKey(a.id, b.id);
      await report(a.id, b.id, { reason: "other", photoKeys: [key] });

      const response = await addEntry(a.id, b.id, { details: "de nuevo", photoKeys: [key] });

      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).error.code).toBe("REPORT_PHOTO_ALREADY_USED");
      expect(await app.db.userReportEntry.count()).toBe(0);
      expect(await app.redis.get(reportRateLimitKey(a.id))).toBe("1");
    });

    it("dos entradas concurrentes con la misma foto: una sola la asocia", async () => {
      const { a, b } = await pair();
      await report(a.id, b.id, { reason: "other" });
      const key = await uploadedKey(a.id, b.id);

      const responses = await Promise.all([
        addEntry(a.id, b.id, { photoKeys: [key] }),
        addEntry(a.id, b.id, { photoKeys: [key] }),
      ]);

      const codes = responses.map((r) => r.statusCode).sort();
      expect(codes[0]).toBe(201);
      expect(codes[1]).toBe(409);
      expect(await app.db.userReportPhoto.count()).toBe(1);
      expect(await app.db.userReportEntry.count()).toBe(1);
    });

    it("el P2002 del índice único de s3_key se distingue del de reporte pendiente duplicado", async () => {
      // Red de seguridad del service ante una carrera que pase el chequeo previo: la
      // forma de `meta` depende del driver adapter, así que se prueba contra Postgres real.
      const { a, b } = await pair();
      const created = JSON.parse((await report(a.id, b.id, { reason: "other" })).body) as { id: string };
      await app.db.userReportPhoto.create({ data: { reportId: created.id, s3Key: "reports/x/dup.jpg" } });

      const photoError = await app.db.userReportPhoto
        .create({ data: { reportId: created.id, s3Key: "reports/x/dup.jpg" } })
        .catch((error: unknown) => error);
      const pendingError = await app.db.userReport
        .create({ data: { reporterId: a.id, reportedId: b.id, reason: "other" } })
        .catch((error: unknown) => error);

      expect(isReportPhotoKeyConflict(photoError)).toBe(true);
      expect(isReportPhotoKeyConflict(pendingError)).toBe(false);
    });

    it("400 con más de 4 fotos por envío o con keys repetidas", async () => {
      const { a, b } = await pair();
      const keys = await Promise.all(Array.from({ length: 5 }, () => uploadedKey(a.id, b.id)));

      const tooMany = await report(a.id, b.id, { reason: "other", photoKeys: keys });
      const repeated = await report(a.id, b.id, { reason: "other", photoKeys: [keys[0], keys[0]] });

      expect(tooMany.statusCode).toBe(400);
      expect(repeated.statusCode).toBe(400);
      expect(await app.db.userReport.count()).toBe(0);
    });

    it("409 PHOTO_CONFIRMATION_IN_PROGRESS si el sweep tiene tomada la key, y suelta los locks propios", async () => {
      const { a, b } = await pair();
      const mine = await uploadedKey(a.id, b.id);
      const busy = await uploadedKey(a.id, b.id);
      await app.redis.set(reportPhotoLockKey(busy), "1", "PX", 5_000);

      const response = await report(a.id, b.id, { reason: "other", photoKeys: [mine, busy] });

      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).error.code).toBe("PHOTO_CONFIRMATION_IN_PROGRESS");
      expect(await app.redis.exists(reportPhotoLockKey(mine))).toBe(0);
    });
  });
});
