import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";

describe("GET /internal/user-reports/:id/parties (MOVO-288)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp();
    await app.ready();
    repo = createUserRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  function createUser() {
    return repo.create({
      email: `user-${randomUUID()}@movo.test`,
      phone: `+549351${Math.floor(1000000 + Math.random() * 8999999)}`,
      firstName: "Alena",
      lastName: "Ariza",
      passwordHash: "hashed_password",
      roles: [UserRole.SENDER, UserRole.CARRIER],
      phoneVerified: true,
      address: { street: "Av. Colón", number: "1234", city: "Córdoba", province: "Córdoba", zip: "5000", lat: -31.4201, long: -64.1888 },
    });
  }

  it("devuelve quién reportó a quién", async () => {
    const reporter = await createUser();
    const reported = await createUser();
    const report = await app.db.userReport.create({
      data: { reporterId: reporter.id, reportedId: reported.id, reason: "harassment" },
    });

    const response = await app.inject({ method: "GET", url: `/internal/user-reports/${report.id}/parties` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ reportId: report.id, reporterId: reporter.id, reportedId: reported.id });
  });

  it("un reporte inexistente da 404 REPORT_NOT_FOUND", async () => {
    const response = await app.inject({ method: "GET", url: `/internal/user-reports/${randomUUID()}/parties` });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("REPORT_NOT_FOUND");
  });

  it("no se documenta en la Swagger pública", async () => {
    const paths = Object.keys((app.swagger() as { paths: Record<string, unknown> }).paths);

    expect(paths.some((p) => p.includes("/internal/user-reports"))).toBe(false);
  });
});
