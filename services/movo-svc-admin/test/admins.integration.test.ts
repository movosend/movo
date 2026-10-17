import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { AdminSummary } from "@movo/shared";
import { buildApp } from "../src/app";
import { createFakeShipmentsClient, createFakeUsersClient } from "./fake-clients";

const summary = (overrides: Partial<AdminSummary> = {}): AdminSummary => ({
  id: randomUUID(),
  fullName: "Ada Admin",
  email: `${randomUUID()}@movo.test`,
  status: "active",
  grantedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

describe("Gestión de admins (MOVO-292)", () => {
  let app: FastifyInstance;
  const me = summary();
  const other = summary();
  const admins = [me, other];

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({ usersClient: createFakeUsersClient({ admins }), shipmentsClient: createFakeShipmentsClient() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const headers = (userId: string) => ({ "x-user-id": userId, "x-user-roles": "admin" });
  const rowsOf = (adminId: string) => app.db.auditLog.findMany({ where: { adminId }, orderBy: { createdAt: "asc" } });

  it("sin rol admin responde 403", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/admins", headers: { "x-user-id": randomUUID(), "x-user-roles": "sender" } });
    expect(res.statusCode).toBe(403);
  });

  it("lista los admins", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/admins", headers: headers(me.id) });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((a: AdminSummary) => a.id)).toEqual([me.id, other.id]);
  });

  it("revocarse a uno mismo es 403 y no queda como exitoso", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/admins/${me.id}`,
      headers: headers(me.id),
      payload: { reason: "Prueba" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("ADMIN_CONFLICT_OF_INTEREST");
    expect(admins.some((a) => a.id === me.id)).toBe(true);
    const rows = await rowsOf(me.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "admin_role.revoke", outcome: "failed", errorCode: "ADMIN_CONFLICT_OF_INTEREST" });
  });

  it("revocar exige motivo", async () => {
    const res = await app.inject({ method: "DELETE", url: `/admin/admins/${other.id}`, headers: headers(me.id), payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("otorgar y revocar dejan sus filas en la bitácora", async () => {
    const actor = summary();
    admins.push(actor);
    const target = summary();

    const missing = await app.inject({ method: "POST", url: "/admin/admins", headers: headers(actor.id), payload: { email: "nadie@movo.test" } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("USER_NOT_FOUND");

    admins.push(target); // el fake solo "otorga" a quien ya figura
    const grant = await app.inject({ method: "POST", url: "/admin/admins", headers: headers(actor.id), payload: { email: target.email.toUpperCase() } });
    expect(grant.statusCode).toBe(200);
    expect(grant.json().id).toBe(target.id);

    const revoke = await app.inject({
      method: "DELETE",
      url: `/admin/admins/${target.id}`,
      headers: headers(actor.id),
      payload: { reason: "Dejó el equipo" },
    });
    expect(revoke.statusCode).toBe(204);

    const rows = await rowsOf(actor.id);
    expect(rows.map((r) => [r.action, r.outcome])).toEqual([
      ["admin_role.grant", "failed"],
      ["admin_role.grant", "succeeded"],
      ["admin_role.revoke", "succeeded"],
    ]);
    expect(rows[1]).toMatchObject({ targetType: "admin_role", targetId: target.email });
    expect(rows[2]).toMatchObject({ targetId: target.id, reason: "Dejó el equipo" });
  });

  it("propaga el motivo concreto de svc-users (último admin)", async () => {
    const solo = summary();
    const lone = buildApp({ usersClient: createFakeUsersClient({ admins: [solo] }), shipmentsClient: createFakeShipmentsClient() });
    await lone.ready();
    const res = await lone.inject({
      method: "DELETE",
      url: `/admin/admins/${solo.id}`,
      headers: headers(randomUUID()),
      payload: { reason: "Prueba" },
    });
    await lone.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("ADMIN_LAST_ADMIN");
  });
});
