import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

describe("GET /users/count", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Aísla cada test: sin esto, el orden de ejecución hace que los tests fallen
    // de forma intermitente cuando comparten filas insertadas por otros tests.
    await app.db.query("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
  });

  it("devuelve 0 cuando no hay usuarios", async () => {
    const response = await app.inject({ method: "GET", url: "/users/count" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ count: 0 });
  });

  it("devuelve la cantidad real de usuarios en la base", async () => {
    await app.db.query("INSERT INTO users (email) VALUES ($1)", ["dev@movo.test"]);

    const response = await app.inject({ method: "GET", url: "/users/count" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ count: 1 });
  });
});
