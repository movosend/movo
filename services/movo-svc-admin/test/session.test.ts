import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
describe("GET /admin/session", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });
  it("sin identidad responde 401", async () => { expect((await app.inject({ method: "GET", url: "/admin/session" })).statusCode).toBe(401); });
  it("sin rol admin responde 403", async () => { expect((await app.inject({ method: "GET", url: "/admin/session", headers: { "x-user-id": randomUUID(), "x-user-roles": "sender" } })).statusCode).toBe(403); });
  it("confirma acceso sin tokens ni caché", async () => {
    const response = await app.inject({ method: "GET", url: "/admin/session", headers: { "x-user-id": randomUUID(), "x-user-roles": "admin" } });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ authenticated: true });
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});
