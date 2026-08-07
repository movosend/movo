import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import {
  createOtpRepository,
  OtpRepository,
  OTP_TTL_SECONDS,
} from "../src/repositories/otp-repository";

describe("Otp Repository (Redis)", () => {
  let redis: Redis;
  let otpRepo: OtpRepository;

  beforeAll(() => {
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    redis = new Redis(redisUrl, { lazyConnect: false });
    otpRepo = createOtpRepository(redis);
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "otp:*", "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  });

  it("crea un OTP con TTL de ~600s en la key primaria y en el índice por target", async () => {
    const target = "+5493511111111";
    const { otpId } = await otpRepo.create(target, "hash-abc");

    const record = await otpRepo.findById(otpId);
    expect(record).toMatchObject({ otpId, target, codeHash: "hash-abc", attempts: 0 });

    const primaryTtl = await redis.ttl(`otp:${otpId}`);
    const indexTtl = await redis.ttl(`otp:target:${target}`);
    expect(primaryTtl).toBeGreaterThan(OTP_TTL_SECONDS - 5);
    expect(primaryTtl).toBeLessThanOrEqual(OTP_TTL_SECONDS);
    expect(indexTtl).toBeGreaterThan(OTP_TTL_SECONDS - 5);
    expect(indexTtl).toBeLessThanOrEqual(OTP_TTL_SECONDS);
  });

  it("nunca persiste el código en claro — solo el hash pasado por el caller", async () => {
    const target = "+5493511111112";
    const plainCode = "482913";
    const codeHash = `hashed(${plainCode})`; // el hasheo real es responsabilidad de otp-service

    const { otpId } = await otpRepo.create(target, codeHash);
    const record = await otpRepo.findById(otpId);

    expect(record?.codeHash).not.toBe(plainCode);
    expect(record?.codeHash).toBe(codeHash);
  });

  it("un segundo create() para el mismo target invalida el otpId anterior (un solo OTP activo por target)", async () => {
    const target = "+5493511111113";
    const first = await otpRepo.create(target, "hash-1");
    const second = await otpRepo.create(target, "hash-2");

    expect(second.otpId).not.toBe(first.otpId);
    expect(await otpRepo.findById(first.otpId)).toBeNull();
    expect(await otpRepo.findById(second.otpId)).not.toBeNull();
    expect(await otpRepo.findActiveIdByTarget(target)).toBe(second.otpId);
  });

  it("findById devuelve null para un otpId inexistente", async () => {
    expect(await otpRepo.findById(randomUUID())).toBeNull();
  });

  it("findActiveIdByTarget devuelve null cuando no hay ningún OTP activo para el target", async () => {
    expect(await otpRepo.findActiveIdByTarget("+5493519999999")).toBeNull();
  });

  it("rotateCode reemplaza el hash, resetea attempts a 0 y refresca el TTL", async () => {
    const target = "+5493511111114";
    const { otpId } = await otpRepo.create(target, "hash-old");

    await otpRepo.incrementAttempts(otpId);
    await otpRepo.incrementAttempts(otpId);
    expect((await otpRepo.findById(otpId))?.attempts).toBe(2);

    await redis.expire(`otp:${otpId}`, 30);
    await redis.expire(`otp:target:${target}`, 30);

    await otpRepo.rotateCode(otpId, "hash-new");

    const record = await otpRepo.findById(otpId);
    expect(record?.codeHash).toBe("hash-new");
    expect(record?.attempts).toBe(0);

    const primaryTtl = await redis.ttl(`otp:${otpId}`);
    const indexTtl = await redis.ttl(`otp:target:${target}`);
    expect(primaryTtl).toBeGreaterThan(30);
    expect(indexTtl).toBeGreaterThan(30);
  });

  it("rotateCode sobre un otpId inexistente es no-op (no crea nada)", async () => {
    const otpId = randomUUID();
    await otpRepo.rotateCode(otpId, "hash-new");
    expect(await otpRepo.findById(otpId)).toBeNull();
  });

  it("incrementAttempts incrementa atómicamente en llamadas sucesivas", async () => {
    const { otpId } = await otpRepo.create("+5493511111115", "hash-x");

    expect(await otpRepo.incrementAttempts(otpId)).toBe(1);
    expect(await otpRepo.incrementAttempts(otpId)).toBe(2);
    expect(await otpRepo.incrementAttempts(otpId)).toBe(3);
  });

  it("incrementAttempts devuelve null si la key ya no existe, sin crear una key fantasma", async () => {
    const otpId = randomUUID();
    const result = await otpRepo.incrementAttempts(otpId);

    expect(result).toBeNull();
    expect(await redis.exists(`otp:${otpId}`)).toBe(0);
  });

  it("invalidate borra la key primaria y el índice por target juntos, y es idempotente", async () => {
    const target = "+5493511111116";
    const { otpId } = await otpRepo.create(target, "hash-y");

    await otpRepo.invalidate(otpId);

    expect(await otpRepo.findById(otpId)).toBeNull();
    expect(await otpRepo.findActiveIdByTarget(target)).toBeNull();

    await expect(otpRepo.invalidate(otpId)).resolves.not.toThrow();
  });

  it("un otpId con ':' se trata como no encontrado, nunca colisiona con otp:target:*", async () => {
    const target = "+5493511111117";
    await otpRepo.create(target, "hash-z");

    const maliciousId = `target:${target}`;
    expect(await otpRepo.findById(maliciousId)).toBeNull();
    expect(await otpRepo.incrementAttempts(maliciousId)).toBeNull();
    await expect(otpRepo.invalidate(maliciousId)).resolves.not.toThrow();

    // La key real de índice sigue intacta — no se tocó ni se rompió con WRONGTYPE.
    expect(await otpRepo.findActiveIdByTarget(target)).not.toBeNull();
  });
});
