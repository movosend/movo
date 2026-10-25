import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import {
  AdminUserProfile,
  SupportInternalMessage,
  SupportInternalRow,
  SupportStreamEvent,
  SUPPORT_EVENTS_STREAM_FIELD,
  SUPPORT_EVENTS_STREAM_KEY,
  SUPPORT_QUICK_REPLIES,
} from "@movo/shared";
import { buildApp } from "../src/app";
import { createFakeShipmentsClient, createFakeSupportClient, createFakeUsersClient } from "./fake-clients";

const profile = (overrides: Partial<AdminUserProfile> = {}): AdminUserProfile => {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    firstName: "Ana",
    lastName: "Ariza",
    fullName: "Ana Ariza",
    email: `${id}@movo.test`,
    emailVerified: true,
    phone: "+5493511234567",
    phoneVerified: true,
    dni: "30111222",
    birthdate: "1995-04-01",
    photoUrl: null,
    createdAt: "2026-03-10T12:00:00.000Z",
    deletedAt: null,
    roles: [{ role: "sender", grantedAt: "2026-03-10T12:00:00.000Z" }],
    accountStatus: "active",
    bannedUntil: null,
    ...overrides,
  };
};

const adminGrant = [{ role: "admin" as const, grantedAt: "2026-10-01T00:00:00.000Z" }];

/**
 * MOVO-322: rutas del panel de la bandeja de soporte. La bitácora es real (schema `admin`) y el stream de eventos
 * también (Redis); svc-shipments y svc-users son fakes. Las reglas del modelo (orden, eventos, notas que no llegan al
 * usuario) las prueba `svc-shipments` (`test/admin-support.integration.test.ts`); acá, lo que agrega svc-admin.
 */
describe("Bandeja de soporte del panel (MOVO-322)", () => {
  const me = profile({ fullName: "Lucía Bustos", roles: adminGrant });
  const other = profile({ fullName: "Tomás Ferreyra", roles: adminGrant });
  const user = profile({ fullName: "Juana Pérez", roles: [{ role: "sender", grantedAt: "2026-03-10T12:00:00.000Z" }, { role: "carrier", grantedAt: "2026-04-01T00:00:00.000Z" }] });
  const admin = { "x-user-id": me.id, "x-user-roles": "admin" };
  const notAdmin = { "x-user-id": user.id, "x-user-roles": "sender" };

  const row = (overrides: Partial<SupportInternalRow> = {}): SupportInternalRow => ({
    id: randomUUID(),
    code: "SOP-1042",
    userId: user.id,
    topic: "payments",
    priority: "high",
    status: "open",
    assignedTo: other.id,
    unread: 2,
    lastMessage: { from: "user", authorId: null, body: "¿Y mi plata?", hasAttachments: false, createdAt: "2026-10-25T12:00:00.000Z" },
    waitMinutes: 12,
    shipment: null,
    tags: ["Cobro"],
    lastActivityAt: "2026-10-25T12:00:00.000Z",
    createdAt: "2026-10-25T11:00:00.000Z",
    resolvedAt: null,
    ...overrides,
  });

  const conversation = row();
  const own = row({ userId: me.id, code: "SOP-1043" });
  const messages: SupportInternalMessage[] = [
    { id: randomUUID(), conversationId: conversation.id, kind: "event", authorId: other.id, authorName: "Tomás Ferreyra", body: "Tomás Ferreyra tomó la conversación", clientMessageId: null, attachments: [], createdAt: "2026-10-25T12:02:00.000Z" },
    { id: randomUUID(), conversationId: conversation.id, kind: "note", authorId: other.id, authorName: "Tomás", body: "Revisar el hold", clientMessageId: randomUUID(), attachments: [], createdAt: "2026-10-25T12:01:00.000Z" },
    { id: randomUUID(), conversationId: conversation.id, kind: "user", authorId: user.id, authorName: null, body: "¿Y mi plata?", clientMessageId: randomUUID(), attachments: [], createdAt: "2026-10-25T12:00:00.000Z" },
  ];

  let app: FastifyInstance;
  let support: ReturnType<typeof createFakeSupportClient>;

  function build(opts: { usersDown?: boolean; namesDown?: boolean; kycDown?: boolean; supportDown?: boolean } = {}) {
    support = createFakeSupportClient({
      rows: { [conversation.id]: conversation, [own.id]: own },
      messages: { [conversation.id]: messages },
      userConversations: {
        [conversation.id]: { items: [{ conversationId: randomUUID(), code: "SOP-0990", topic: "account", status: "resolved", createdAt: "2026-09-01T00:00:00.000Z" }] },
      },
      loads: [{ agentId: other.id, activeCount: 3 }],
      counts: { byStatus: { open: 4, awaiting_user: 1, resolved: 9 }, byOwner: { all: 4, mine: 1, none: 2 }, unreadTotal: 5 },
      down: opts.supportDown ?? false,
    });
    return buildApp({
      usersClient: createFakeUsersClient({
        profiles: [me, other, user],
        admins: [me, other].map((p) => ({ id: p.id, fullName: p.fullName, email: p.email, status: "active" as never, photoUrl: null, grantedAt: p.createdAt })),
        down: opts.usersDown ?? false,
        namesDown: opts.namesDown ?? false,
        kycDown: opts.kycDown ?? false,
      }),
      shipmentsClient: createFakeShipmentsClient({
        userShipments: {
          [user.id]: {
            items: [
              { id: "11111111-2222-4333-8444-555555548176", shortId: "11111111", status: "in_transit", pickupAddress: "Güemes 100, Córdoba", deliveryAddress: "Cofico 200, Córdoba", priceArs: 4500, createdAt: "2026-10-20T00:00:00.000Z", userRole: "sender", senderId: user.id, carrierId: null, receiverId: randomUUID() },
            ],
            page: 1,
            pageSize: 5,
            total: 7,
            counts: { sender: 7, carrier: 0, receiver: 0 },
          },
        },
        userTrips: { [user.id]: { items: [], page: 1, pageSize: 1, total: 2 } },
        userRatings: { [user.id]: { average: 4.6, count: 11, items: [], page: 1, pageSize: 1 } },
      }),
      supportClient: support.client,
    });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.redis.del(SUPPORT_EVENTS_STREAM_KEY);
  });

  const rowsFor = (targetId: string) => app.db.auditLog.findMany({ where: { targetId }, orderBy: { createdAt: "asc" } });

  it("toda ruta exige rol admin", async () => {
    const id = conversation.id;
    const routes: Array<[string, string, object?]> = [
      ["GET", "/admin/support/conversations?status=open"],
      ["GET", "/admin/support/counts?status=open"],
      ["GET", `/admin/support/conversations/${id}`],
      ["GET", `/admin/support/conversations/${id}/messages`],
      ["POST", `/admin/support/conversations/${id}/messages`, { body: "hola", clientMessageId: randomUUID() }],
      ["PATCH", `/admin/support/conversations/${id}`, { priority: "low" }],
      ["POST", `/admin/support/conversations/${id}/resolve`],
      ["POST", `/admin/support/conversations/${id}/reopen`],
      ["POST", `/admin/support/conversations/${id}/read`],
      ["GET", `/admin/support/conversations/${id}/context`],
      ["GET", "/admin/support/agents"],
      ["GET", "/admin/support/quick-replies"],
      ["GET", "/admin/support/events"],
      ["POST", "/admin/support/attachments", { contentType: "image/png", sizeBytes: 10, conversationId: id }],
    ];
    for (const [method, url, payload] of routes) {
      const res = await app.inject({ method: method as "GET", url, headers: notAdmin, ...(payload ? { payload } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  describe("lecturas", () => {
    it("la bandeja completa nombres y rol, resuelve assignee=me y busca usuarios por nombre en svc-users", async () => {
      const res = await app.inject({ method: "GET", url: "/admin/support/conversations?status=open&assignee=me&q=Juana", headers: admin });

      expect(res.statusCode).toBe(200);
      expect(support.seen.list).toEqual({ status: "open", assignee: me.id, q: "Juana", userIds: [user.id] });
      expect(res.json().items[0]).toMatchObject({
        id: conversation.id,
        user: { id: user.id, fullName: "Juana Pérez", role: "carrier" },
        assignee: { id: other.id, fullName: "Tomás Ferreyra" },
        lastMessage: { from: "user", authorId: null, authorName: "Juana Pérez" },
        waitMinutes: 12,
      });
    });

    it("sin svc-users los nombres caen a \"Nombre no disponible\" y la búsqueda sigue por código y texto", async () => {
      const degraded = build({ usersDown: true });
      await degraded.ready();
      const res = await degraded.inject({ method: "GET", url: "/admin/support/conversations?status=open&q=SOP-1042", headers: admin });
      expect(res.statusCode).toBe(200);
      expect(support.seen.list).toEqual({ status: "open", q: "SOP-1042" });
      expect(res.json().items[0].user.fullName).toBe("Nombre no disponible");
      await degraded.close();
      app = build();
      await app.ready();
    });

    it("los contadores reciben los filtros y el admin que mira", async () => {
      const res = await app.inject({ method: "GET", url: "/admin/support/counts?status=resolved&assignee=none", headers: admin });
      expect(res.json()).toEqual({ byStatus: { open: 4, awaiting_user: 1, resolved: 9 }, byOwner: { all: 4, mine: 1, none: 2 }, unreadTotal: 5 });
      expect(support.seen.counts).toEqual({ status: "resolved", assignee: "none", viewerId: me.id });
    });

    it("el historial trae notas y eventos con los tipos del panel", async () => {
      const res = await app.inject({ method: "GET", url: `/admin/support/conversations/${conversation.id}/messages`, headers: admin });
      expect(res.json().items).toEqual([
        expect.objectContaining({ kind: "system", body: "Tomás Ferreyra tomó la conversación", actor: { id: other.id, fullName: "Tomás Ferreyra" } }),
        expect.objectContaining({ kind: "internal_note", body: "Revisar el hold", author: { id: other.id, fullName: "Tomás Ferreyra" } }),
        expect.objectContaining({ kind: "user", body: "¿Y mi plata?", attachments: [] }),
      ]);
    });

    it("una consulta inexistente es 404 y svc-shipments caído es 502", async () => {
      expect((await app.inject({ method: "GET", url: `/admin/support/conversations/${randomUUID()}`, headers: admin })).json().error.code).toBe(
        "SUPPORT_CONVERSATION_NOT_FOUND"
      );
      const down = build({ supportDown: true });
      await down.ready();
      const res = await down.inject({ method: "GET", url: `/admin/support/conversations/${conversation.id}`, headers: admin });
      expect(res.statusCode).toBe(502);
      expect(res.json().error.code).toBe("SUPPORT_SERVICE_UNAVAILABLE");
      await down.close();
      app = build();
      await app.ready();
    });

    it("agentes con su carga y respuestas rápidas", async () => {
      const agents = await app.inject({ method: "GET", url: "/admin/support/agents", headers: admin });
      expect(agents.json()).toEqual([
        { id: me.id, fullName: "Lucía Bustos", activeCount: 0 },
        { id: other.id, fullName: "Tomás Ferreyra", activeCount: 3 },
      ]);
      expect((await app.inject({ method: "GET", url: "/admin/support/quick-replies", headers: admin })).json()).toEqual(SUPPORT_QUICK_REPLIES);
    });
  });

  describe("contexto del usuario", () => {
    it("perfil, insignias, envíos recientes y demás consultas", async () => {
      const res = await app.inject({ method: "GET", url: `/admin/support/conversations/${conversation.id}/context`, headers: admin });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        profile: {
          id: user.id,
          fullName: "Juana Pérez",
          roles: ["sender", "carrier"],
          memberSince: "2026-03-10T12:00:00.000Z",
          email: user.email,
          phone: user.phone,
          ratingAverage: 4.6,
          ratingCount: 11,
          shipmentCount: 7,
          tripCount: 2,
        },
        badges: ["identity", "kyc_approved"],
        recentShipments: [
          {
            id: "11111111-2222-4333-8444-555555548176",
            code: "MOVO-48176",
            status: "in_transit",
            route: "Güemes 100 → Cofico 200",
            tone: "info",
            statusLabel: "En viaje",
            createdAt: "2026-10-20T00:00:00.000Z",
          },
        ],
        otherConversations: [expect.objectContaining({ code: "SOP-0990", status: "resolved" })],
      });
    });

    it("falla abierto: sin el KYC de svc-users, badges es null y el resto se devuelve igual", async () => {
      const degraded = build({ kycDown: true });
      await degraded.ready();
      const res = await degraded.inject({ method: "GET", url: `/admin/support/conversations/${conversation.id}/context`, headers: admin });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ badges: null, profile: { fullName: "Juana Pérez" }, recentShipments: [expect.any(Object)] });
      await degraded.close();
      app = build();
      await app.ready();
    });
  });

  describe("escrituras: bitácora y conflicto de interés", () => {
    it("responder manda el actor (nombre completo y de pila) y deja support.reply en la bitácora", async () => {
      const clientMessageId = randomUUID();
      const res = await app.inject({
        method: "POST",
        url: `/admin/support/conversations/${conversation.id}/messages`,
        headers: admin,
        payload: { body: "Ya lo vemos", clientMessageId },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ kind: "agent", body: "Ya lo vemos", author: { id: me.id, fullName: "Lucía Bustos" } });
      expect(support.seen.send).toMatchObject({ actorId: me.id, actorFullName: "Lucía Bustos", actorFirstName: "Lucía", clientMessageId });
      const rows = await rowsFor(conversation.id);
      expect(rows.at(-1)).toMatchObject({ adminId: me.id, action: "support.reply", targetType: "support_conversation", outcome: "succeeded" });
    });

    it("una nota es support.note; responder sobre la propia consulta es 403 y queda failed", async () => {
      await app.inject({
        method: "POST",
        url: `/admin/support/conversations/${conversation.id}/messages`,
        headers: admin,
        payload: { body: "Interno", clientMessageId: randomUUID(), internal: true },
      });
      expect((await rowsFor(conversation.id)).at(-1)).toMatchObject({ action: "support.note", outcome: "succeeded" });

      const res = await app.inject({
        method: "POST",
        url: `/admin/support/conversations/${own.id}/messages`,
        headers: admin,
        payload: { body: "Me respondo", clientMessageId: randomUUID() },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("ADMIN_CONFLICT_OF_INTEREST");
      expect((await rowsFor(own.id)).at(-1)).toMatchObject({ action: "support.reply", outcome: "failed", errorCode: "ADMIN_CONFLICT_OF_INTEREST" });
    });

    it("asignar a otro agente manda su nombre; asignar a alguien que no es admin es 400 y queda failed", async () => {
      const res = await app.inject({ method: "PATCH", url: `/admin/support/conversations/${conversation.id}`, headers: admin, payload: { assignedTo: other.id } });
      expect(res.statusCode).toBe(200);
      expect(support.seen.patch).toMatchObject({ assignedTo: other.id, assigneeFullName: "Tomás Ferreyra", actorFullName: "Lucía Bustos" });
      expect((await rowsFor(conversation.id)).at(-1)).toMatchObject({ action: "support.assign", outcome: "succeeded" });

      const bad = await app.inject({ method: "PATCH", url: `/admin/support/conversations/${conversation.id}`, headers: admin, payload: { assignedTo: user.id } });
      expect(bad.statusCode).toBe(400);
      expect((await rowsFor(conversation.id)).at(-1)).toMatchObject({ action: "support.assign", outcome: "failed" });
    });

    it("sin la resolución de nombres, el asignado sale de listAdmins y el autor de una nota, de su nombre de pila", async () => {
      const degraded = build({ namesDown: true });
      await degraded.ready();
      const res = await degraded.inject({ method: "PATCH", url: `/admin/support/conversations/${conversation.id}`, headers: admin, payload: { assignedTo: other.id } });
      expect(res.statusCode).toBe(200);
      expect(support.seen.patch).toMatchObject({ assignedTo: other.id, assigneeFullName: "Tomás Ferreyra" });

      const history = await degraded.inject({ method: "GET", url: `/admin/support/conversations/${conversation.id}/messages`, headers: admin });
      expect(history.json().items).toContainEqual(expect.objectContaining({ kind: "internal_note", author: { id: other.id, fullName: "Tomás" } }));
      await degraded.close();
      app = build();
      await app.ready();
    });

    it("varios cambios juntos son support.update; resolver y reabrir tienen su acción", async () => {
      await app.inject({ method: "PATCH", url: `/admin/support/conversations/${conversation.id}`, headers: admin, payload: { priority: "urgent", tags: ["VIP"] } });
      expect((await rowsFor(conversation.id)).at(-1)).toMatchObject({ action: "support.update" });
      await app.inject({ method: "POST", url: `/admin/support/conversations/${conversation.id}/resolve`, headers: admin });
      expect((await rowsFor(conversation.id)).at(-1)).toMatchObject({ action: "support.resolve" });
      expect(support.seen.actor).toEqual({ actorId: me.id, actorFullName: "Lucía Bustos" });
      await app.inject({ method: "POST", url: `/admin/support/conversations/${conversation.id}/reopen`, headers: admin });
      expect((await rowsFor(conversation.id)).at(-1)).toMatchObject({ action: "support.reopen" });
    });

    it("marcar como leída no pasa por la bitácora", async () => {
      const before = (await rowsFor(own.id)).length;
      const res = await app.inject({ method: "POST", url: `/admin/support/conversations/${own.id}/read`, headers: admin });
      expect(res.statusCode).toBe(204);
      expect(support.seen.read).toBe(own.id);
      expect(await rowsFor(own.id)).toHaveLength(before);
    });

    it("svc-shipments caído en una escritura deja la fila como unknown", async () => {
      const down = build({ supportDown: true });
      await down.ready();
      // La regla de conflicto también consulta svc-shipments: cae ahí, así que la fila es failed (es una lectura).
      const res = await down.inject({ method: "POST", url: `/admin/support/conversations/${conversation.id}/resolve`, headers: admin });
      expect(res.statusCode).toBe(502);
      expect((await rowsFor(conversation.id)).at(-1)).toMatchObject({ action: "support.resolve", outcome: "failed", errorCode: "SUPPORT_SERVICE_UNAVAILABLE" });
      await down.close();
      app = build();
      await app.ready();
    });

    it("pedir un adjunto pasa por la bitácora y manda el actor", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/support/attachments",
        headers: admin,
        payload: { contentType: "image/png", sizeBytes: 2000, conversationId: conversation.id },
      });
      expect(res.statusCode).toBe(201);
      expect(support.seen.attachment).toEqual({ actorId: me.id, actorFullName: "Lucía Bustos", contentType: "image/png", sizeBytes: 2000 });
      expect((await rowsFor(conversation.id)).at(-1)).toMatchObject({ action: "support.attachment_request", outcome: "succeeded" });
    });
  });

  describe("eventos (Redis Stream, ADR-024)", () => {
    const publish = (event: SupportStreamEvent) =>
      app.redis.xadd(SUPPORT_EVENTS_STREAM_KEY, "*", SUPPORT_EVENTS_STREAM_FIELD, JSON.stringify(event));
    const events = (since?: string) =>
      app.inject({ method: "GET", url: `/admin/support/events${since ? `?since=${encodeURIComponent(since)}` : ""}`, headers: admin });

    it("sin since arranca desde ahora; con since trae lo nuevo con nombres y un solo counts_updated", async () => {
      await publish({ type: "conversation_created", conversation });
      const start = (await events()).json();
      expect(start.events).toEqual([]);

      await publish({ type: "support_message", conversation, message: messages[1] });
      await publish({ type: "counts_changed" });
      await publish({ type: "conversation_updated", conversation });
      await publish({ type: "counts_changed" });

      const page = (await events(start.cursor)).json();
      expect(page.reset).toBe(false);
      expect(page.events.map((e: { type: string }) => e.type)).toEqual(["support_message", "conversation_updated", "counts_updated"]);
      expect(page.events[0]).toMatchObject({
        conversationId: conversation.id,
        message: { kind: "internal_note", author: { fullName: "Tomás Ferreyra" } },
        conversation: { user: { fullName: "Juana Pérez" } },
      });
      expect(page.events[2].counts.unreadTotal).toBe(5);
      expect(support.seen.counts).toEqual({ status: "open", viewerId: me.id });
      expect((await events(page.cursor)).json()).toEqual({ events: [], cursor: page.cursor, reset: false });
    });

    it("un cursor más viejo que lo que se guarda responde reset; uno mal formado, 400", async () => {
      await publish({ type: "counts_changed" });
      const page = (await events("1-0")).json();
      expect(page).toMatchObject({ events: [], reset: true });
      expect((await events("roto")).statusCode).toBe(400);
    });
  });
});
