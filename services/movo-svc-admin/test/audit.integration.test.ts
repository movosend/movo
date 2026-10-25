import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { ApiError } from "@movo/shared";
import { buildApp } from "../src/app";
import { createFakeShipmentsClient, createFakeUsersClient, shipmentsDown } from "./fake-clients";

describe("Bitácora del panel (Postgres) — MOVO-288", () => {
  let app: FastifyInstance;
  const otherUser = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({
      usersClient: createFakeUsersClient(),
      shipmentsClient: createFakeShipmentsClient({
        shipments: {
          "s-ajeno": { shipmentId: "s-ajeno", senderId: otherUser, carrierId: null, receiverId: otherUser, formerReceiverIds: [] },
        },
      }),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const rowsOf = (adminId: string) => app.db.auditLog.findMany({ where: { adminId }, orderBy: { createdAt: "asc" } });

  describe("runAdminAction", () => {
    it("una acción exitosa queda registrada como succeeded, con motivo y contexto", async () => {
      const adminId = randomUUID();

      const result = await app.audit.runAdminAction(
        {
          adminId,
          action: "user.suspend",
          target: { type: "user", id: otherUser },
          reason: "Fraude reiterado",
          context: { previousStatus: "active" },
          requestId: "req-ok",
        },
        async () => "hecho",
      );

      expect(result).toBe("hecho");
      const rows = await rowsOf(adminId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "user.suspend",
        targetType: "user",
        targetId: otherUser,
        reason: "Fraude reiterado",
        context: { previousStatus: "active" },
        outcome: "succeeded",
        errorCode: null,
        requestId: "req-ok",
      });
    });

    it("si el servicio dueño no responde, queda como unknown (pudo aplicarse) y nunca como succeeded", async () => {
      const adminId = randomUUID();

      await expect(
        app.audit.runAdminAction(
          { adminId, action: "user.suspend", target: { type: "user", id: otherUser }, requestId: "req-fail" },
          async () => {
            throw shipmentsDown();
          },
        ),
      ).rejects.toMatchObject({ code: "SHIPMENTS_SERVICE_UNAVAILABLE" });

      const rows = await rowsOf(adminId);
      expect(rows.map((r) => r.outcome)).toEqual(["unknown"]);
      expect(rows[0].errorCode).toBe("SHIPMENTS_SERVICE_UNAVAILABLE");
    });

    it("si el servicio dueño rechaza la acción con un error de negocio, queda como failed", async () => {
      const adminId = randomUUID();

      await expect(
        app.audit.runAdminAction(
          { adminId, action: "user.suspend", target: { type: "user", id: otherUser }, requestId: "req-409" },
          async () => {
            throw new ApiError(409, "ADMIN_LAST_ADMIN", "Es el último admin.");
          },
        ),
      ).rejects.toMatchObject({ code: "ADMIN_LAST_ADMIN" });

      expect((await rowsOf(adminId))[0]).toMatchObject({ outcome: "failed", errorCode: "ADMIN_LAST_ADMIN" });
    });

    it("un error inesperado queda como failed con INTERNAL_ERROR", async () => {
      const adminId = randomUUID();

      await expect(
        app.audit.runAdminAction(
          { adminId, action: "user.suspend", target: { type: "user", id: otherUser }, requestId: "r" },
          async () => {
            throw new Error("boom");
          },
        ),
      ).rejects.toThrow("boom");

      expect((await rowsOf(adminId))[0]).toMatchObject({ outcome: "failed", errorCode: "INTERNAL_ERROR" });
    });

    it("con conflicto de interés no ejecuta la acción y deja el intento como failed", async () => {
      const adminId = randomUUID();
      const action = vi.fn();

      const error = await app.audit
        .runAdminAction({ adminId, action: "admin_role.revoke", target: { type: "admin_role", id: adminId }, requestId: "r" }, action)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode).toBe(403);
      expect(action).not.toHaveBeenCalled();
      expect((await rowsOf(adminId))[0]).toMatchObject({ outcome: "failed", errorCode: "ADMIN_CONFLICT_OF_INTEREST" });
    });

    it("sobre un envío ajeno pasa la regla y ejecuta la acción", async () => {
      const adminId = randomUUID();

      await app.audit.runAdminAction(
        { adminId, action: "shipment.cancel", target: { type: "shipment", id: "s-ajeno" }, requestId: "r" },
        async () => undefined,
      );

      expect((await rowsOf(adminId))[0].outcome).toBe("succeeded");
    });
  });

  it("la tabla es de solo agregar filas: UPDATE y DELETE fallan", async () => {
    const adminId = randomUUID();
    await app.audit.runAdminAction(
      { adminId, action: "user.suspend", target: { type: "user", id: otherUser }, requestId: "r" },
      async () => undefined,
    );

    await expect(app.db.auditLog.updateMany({ where: { adminId }, data: { outcome: "failed" } })).rejects.toThrow(
      /solo agregar filas/,
    );
    await expect(app.db.auditLog.deleteMany({ where: { adminId } })).rejects.toThrow(/solo agregar filas/);
    expect(await rowsOf(adminId)).toHaveLength(1);
  });

  describe("GET /admin/audit-log", () => {
    const viewer = randomUUID();
    const adminHeaders = { "x-user-id": viewer, "x-user-roles": "sender,carrier,admin", "x-request-id": "req-read" };

    function list(query: string, headers: Record<string, string> = adminHeaders) {
      return app.inject({ method: "GET", url: `/admin/audit-log${query}`, headers });
    }

    async function seed(adminId: string, count: number, action = "user.suspend", targetId = otherUser) {
      for (let i = 0; i < count; i++) {
        await app.audit.runAdminAction(
          { adminId, action, target: { type: "user", id: targetId }, requestId: `seed-${i}` },
          async () => undefined,
        );
      }
    }

    it("sin x-user-id responde 401", async () => {
      const response = await list("", {});
      expect(response.statusCode).toBe(401);
    });

    it("sin el rol admin responde 403", async () => {
      const response = await list("", { "x-user-id": viewer, "x-user-roles": "sender,carrier" });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("AUTH_FORBIDDEN");
    });

    it("filtra por admin, acción y objetivo", async () => {
      const adminId = randomUUID();
      const target = randomUUID();
      await seed(adminId, 2, "user.suspend");
      await seed(adminId, 1, "user.reinstate", target);

      const byAdmin = await list(`?adminId=${adminId}`);
      expect(byAdmin.statusCode).toBe(200);
      expect(byAdmin.json().items).toHaveLength(3);

      const byAction = (await list(`?adminId=${adminId}&action=user.reinstate`)).json();
      expect(byAction.items.map((i: { action: string }) => i.action)).toEqual(["user.reinstate"]);

      const byTarget = (await list(`?targetType=user&targetId=${target}`)).json();
      expect(byTarget.items).toHaveLength(1);
      expect(byTarget.items[0]).toMatchObject({ adminId, targetId: target, outcome: "succeeded" });
    });

    it("filtra por una consulta de soporte como objetivo (MOVO-322)", async () => {
      const res = await list(`?targetType=support_conversation&targetId=${randomUUID()}`);
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toEqual([]);
    });

    it("pagina por cursor, del más reciente al más viejo, sin repetir ni saltear", async () => {
      const adminId = randomUUID();
      await seed(adminId, 5);

      const first = (await list(`?adminId=${adminId}&limit=2`)).json();
      const second = (await list(`?adminId=${adminId}&limit=2&cursor=${first.nextCursor}`)).json();
      const third = (await list(`?adminId=${adminId}&limit=2&cursor=${second.nextCursor}`)).json();

      const ids = [...first.items, ...second.items, ...third.items].map((i: { id: string }) => i.id);
      expect(new Set(ids).size).toBe(5);
      expect(third.nextCursor).toBeNull();
      const dates = [...first.items, ...second.items, ...third.items].map((i: { createdAt: string }) => i.createdAt);
      expect([...dates].sort().reverse()).toEqual(dates);
    });

    it("un cursor inválido responde 400", async () => {
      const response = await list("?cursor=no-es-un-cursor");
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_FAILED");
    });

    it("aparece en la Swagger del servicio", async () => {
      const paths = Object.keys((app.swagger() as { paths: Record<string, unknown> }).paths);
      expect(paths).toContain("/admin/audit-log");
    });
  });
});
