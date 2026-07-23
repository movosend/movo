import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

describe("GET /health", () => {
  let app: FastifyInstance;

  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret";
    app = buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("responde status ok", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "ok" });
  });
});
