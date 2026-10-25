import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { FastifyInstance } from "fastify";
import WebSocket from "ws";
import {
  KycStatus,
  ShipmentStatus,
  signAccessToken,
  SupportStreamEvent,
  SUPPORT_EVENTS_STREAM_FIELD,
  SUPPORT_EVENTS_STREAM_KEY,
  UserRole,
} from "@movo/shared";
import { buildApp } from "../src/app";
import { createMockStorageProvider, MockStorageProvider } from "../src/adapters/mock-storage-provider";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeNotificationsClient } from "./fake-notifications-client";

/**
 * MOVO-322: endpoints internos del lado del agente (`/internal/admin/support/*`, los llama solo svc-admin). Postgres y
 * Redis reales, storage mock. El lado del usuario se mira por sus propias rutas (`/support/*`) y su WebSocket, para
 * comprobar que una nota o un evento del equipo nunca le llegan.
 */
describe("Bandeja de soporte, lado del agente (MOVO-322)", () => {
  let app: FastifyInstance;
  let storage: MockStorageProvider;
  let shipments: ShipmentRepository;
  let baseUrl: string;
  const notifications = createFakeNotificationsClient();
  let clock = new Date("2026-10-25T12:00:00.000Z");

  const agent = { actorId: randomUUID(), actorFullName: "Lucía Bustos", actorFirstName: "Lucía" };
  const otherAgent = { actorId: randomUUID(), actorFullName: "Tomás Ferreyra", actorFirstName: "Tomás" };
  const actorOf = (a: typeof agent) => ({ actorId: a.actorId, actorFullName: a.actorFullName });

  const userHeaders = (userId: string) => ({ "x-user-id": userId, "x-user-roles": "sender" });
  const internal = (method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) =>
    app.inject({ method, url: `/internal/admin/support${url}`, ...(payload !== undefined ? { payload: payload as object } : {}) });

  /** El usuario abre una consulta; avanza el reloj para que el orden por espera sea determinista. */
  async function open(userId: string, body = "No puedo entrar a mi cuenta", topic = "account"): Promise<string> {
    clock = new Date(clock.getTime() + 60_000);
    const response = await app.inject({
      method: "POST",
      url: "/support/conversations",
      headers: userHeaders(userId),
      payload: { topic, body, clientMessageId: randomUUID() },
    });
    expect(response.statusCode).toBe(201);
    return response.json().conversation.id;
  }

  function userWrites(userId: string, id: string, body: string) {
    clock = new Date(clock.getTime() + 60_000);
    return app.inject({
      method: "POST",
      url: `/support/conversations/${id}/messages`,
      headers: userHeaders(userId),
      payload: { body, clientMessageId: randomUUID() },
    });
  }

  const send = (id: string, payload: Record<string, unknown>, who = agent) => {
    clock = new Date(clock.getTime() + 1000);
    return internal("POST", `/conversations/${id}/messages`, { ...who, body: "", clientMessageId: randomUUID(), ...payload });
  };

  const list = (query: string) => internal("GET", `/conversations?${query}`);
  const userHistory = (userId: string, id: string) =>
    app.inject({ method: "GET", url: `/support/conversations/${id}/messages`, headers: userHeaders(userId) });

  async function streamEvents(): Promise<SupportStreamEvent[]> {
    const entries = await app.redis.xrange(SUPPORT_EVENTS_STREAM_KEY, "-", "+");
    return entries.map(([, fields]) => JSON.parse(fields[fields.indexOf(SUPPORT_EVENTS_STREAM_FIELD) + 1]) as SupportStreamEvent);
  }

  const baseInput: CreateShipmentInput = {
    senderId: randomUUID(),
    receiverId: randomUUID(),
    packageType: PackageType.standard_package,
    weightKg: 2.5,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    description: "Caja con libros",
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4201,
    pickupLng: -64.1888,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.4135,
    deliveryLng: -64.1811,
    pickupDate: new Date("2026-08-20T00:00:00.000Z"),
    pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
    pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
    suggestedPriceArs: 4500,
  };

  async function shipmentOf(senderId: string) {
    const shipment = await shipments.create({ ...baseInput, senderId });
    await shipments.addPhoto(shipment.id, PhotoStage.creation, `shipments/${shipment.id}/creation/${randomUUID()}.jpg`);
    await shipments.addPhoto(shipment.id, PhotoStage.creation, `shipments/${shipment.id}/creation/${randomUUID()}.jpg`);
    await shipments.updateStatus(shipment.id, ShipmentStatus.PUBLISHED, senderId);
    return shipment.id;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    storage = createMockStorageProvider();
    app = buildApp({
      notificationsClient: notifications,
      storageProvider: storage,
      supportNow: () => clock,
      supportSchedulePush: () => undefined,
      sweepEnabled: false,
      supportAttachmentSweepEnabled: false,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("El servidor de test no devolvió una dirección TCP");
    baseUrl = `ws://127.0.0.1:${address.port}`;
    shipments = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    vi.mocked(notifications.sendPush).mockClear();
    await app.db.$executeRawUnsafe(
      "TRUNCATE TABLE shipments.support_attachments, shipments.support_conversations, shipments.shipments RESTART IDENTITY CASCADE"
    );
    await app.redis.del(SUPPORT_EVENTS_STREAM_KEY);
    const keys = await app.redis.keys("notified:support-push*");
    if (keys.length > 0) await app.redis.del(...keys);
  });

  describe("bandeja", () => {
    it("abiertas: prioridad (urgente primero) y después mayor espera; resueltas: última actividad", async () => {
      const oldest = await open(randomUUID(), "primera");
      const middle = await open(randomUUID(), "segunda");
      const urgent = await open(randomUUID(), "tercera");
      await internal("PATCH", `/conversations/${urgent}`, { ...actorOf(agent), priority: "urgent" });

      const page = (await list("status=open")).json();
      expect(page.items.map((r: { id: string }) => r.id)).toEqual([urgent, oldest, middle]);
      expect(page.items[1]).toMatchObject({ status: "open", unread: 1, waitMinutes: 2, lastMessage: { from: "user", body: "primera" } });

      await internal("POST", `/conversations/${oldest}/resolve`, actorOf(agent));
      clock = new Date(clock.getTime() + 60_000);
      await internal("POST", `/conversations/${middle}/resolve`, actorOf(agent));
      await send(middle, { body: "reabro escribiendo" }); // la respuesta la reabre y la pasa a awaiting_user
      const resolved = (await list("status=resolved")).json();
      expect(resolved.items.map((r: { id: string }) => r.id)).toEqual([oldest]);
    });

    it("pagina con cursor sin saltear ni repetir y rechaza un cursor inválido", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 32; i++) ids.push(await open(randomUUID(), `consulta ${i}`));
      const first = (await list("status=open")).json();
      expect(first.items).toHaveLength(30);
      const second = (await list(`status=open&cursor=${first.nextCursor}`)).json();
      expect([...first.items, ...second.items].map((r: { id: string }) => r.id)).toEqual(ids);
      expect(second.nextCursor).toBeNull();
      expect((await list("status=open&cursor=roto")).statusCode).toBe(400);
    });

    it("filtra por agente (uno, ninguno) y busca por código, código de envío, texto o usuario", async () => {
      const user = randomUUID();
      const a = await open(user, "el pago no se acreditó");
      const b = await open(randomUUID(), "otra cosa");
      const shipmentId = await shipmentOf(user);
      await internal("PATCH", `/conversations/${a}`, { ...actorOf(agent), assignedTo: agent.actorId, shipmentId });

      const ids = async (query: string) => (await list(query)).json().items.map((r: { id: string }) => r.id);
      expect(await ids(`status=open&assignee=${agent.actorId}`)).toEqual([a]);
      expect(await ids("status=open&assignee=none")).toEqual([b]);
      const code = (await internal("GET", `/conversations/${b}`)).json().code;
      expect(await ids(`status=open&q=${code}`)).toEqual([b]);
      const shipmentCode = (await internal("GET", `/conversations/${a}`)).json().shipment.code;
      expect(await ids(`status=open&q=${encodeURIComponent(shipmentCode)}`)).toEqual([a]);
      expect(await ids(`status=open&q=${encodeURIComponent("acreditó")}`)).toEqual([a]);
      expect(await ids(`status=open&q=Juana&userIds=${user}`)).toEqual([a]);
      expect(await ids(`status=open&q=${encodeURIComponent("100%")}`)).toEqual([]);
    });

    it("contadores por estado, por agente y no leídos totales", async () => {
      const a = await open(randomUUID());
      await open(randomUUID());
      const c = await open(randomUUID());
      await internal("PATCH", `/conversations/${a}`, { ...actorOf(agent), assignedTo: agent.actorId });
      await internal("POST", `/conversations/${c}/resolve`, actorOf(agent));

      const counts = (await internal("GET", `/counts?status=open&viewerId=${agent.actorId}`)).json();
      expect(counts).toEqual({ byStatus: { open: 2, awaiting_user: 0, resolved: 1 }, byOwner: { all: 2, mine: 1, none: 1 }, unreadTotal: 3 });
      const mine = (await internal("GET", `/counts?status=open&assignee=${agent.actorId}&viewerId=${agent.actorId}`)).json();
      expect(mine.byStatus).toEqual({ open: 1, awaiting_user: 0, resolved: 0 });
    });
  });

  describe("responder y notas", () => {
    it("responder la toma si estaba sin asignar, la pasa a awaiting_user y le llega al usuario con push", async () => {
      const user = randomUUID();
      const id = await open(user);

      const response = await send(id, { body: "Hola, ya lo vemos" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        message: { kind: "agent", authorId: agent.actorId, authorName: "Lucía", body: "Hola, ya lo vemos" },
        conversation: { status: "awaiting_user", assignedTo: agent.actorId, waitMinutes: 0 },
      });
      const all = (await internal("GET", `/conversations/${id}/messages`)).json().items;
      expect(all.map((m: { kind: string; body: string }) => [m.kind, m.body])).toEqual([
        ["agent", "Hola, ya lo vemos"],
        ["event", "Lucía Bustos tomó la conversación"],
        ["user", "No puedo entrar a mi cuenta"],
      ]);
      const pushes = vi.mocked(notifications.sendPush).mock.calls.map(([p]) => p);
      expect(pushes).toEqual([expect.objectContaining({ userId: user, body: "Lucía: Hola, ya lo vemos" })]);
      // El usuario ve la respuesta pero no el evento del equipo.
      const visible = (await userHistory(user, id)).json().items.map((m: { kind: string }) => m.kind);
      expect(visible).toEqual(["agent", "user"]);
    });

    it("una nota interna no cambia el estado ni le llega al usuario (API, WebSocket ni push)", async () => {
      const user = randomUUID();
      const id = await open(user);
      const ws = new WebSocket(`${baseUrl}/support/conversations/${id}`, {
        headers: { authorization: `Bearer ${signAccessToken({ sub: user, roles: [UserRole.SENDER], kycStatus: KycStatus.NOT_STARTED })}` },
      });
      const frames: Array<Record<string, unknown>> = [];
      ws.on("message", (data: Buffer) => frames.push(JSON.parse(data.toString())));
      await vi.waitFor(() => expect(frames).toContainEqual({ type: "connected", conversationId: id }));

      const response = await send(id, { body: "SECRETO: revisar al transportista", internal: true });

      expect(response.json()).toMatchObject({ message: { kind: "note" }, conversation: { status: "open", assignedTo: null } });
      await new Promise((r) => setTimeout(r, 100));
      expect(JSON.stringify(frames)).not.toContain("SECRETO");
      expect(notifications.sendPush).not.toHaveBeenCalled();
      expect((await userHistory(user, id)).body).not.toContain("SECRETO");
      ws.close();
    });

    it("responder sobre una resuelta la reabre con su evento", async () => {
      const id = await open(randomUUID());
      clock = new Date(clock.getTime() + 1000);
      await internal("POST", `/conversations/${id}/resolve`, actorOf(otherAgent));

      await send(id, { body: "Retomo" });

      const kinds = (await internal("GET", `/conversations/${id}/messages`)).json().items.map((m: { body: string }) => m.body);
      expect(kinds.slice(0, 3)).toEqual(["Retomo", "Lucía Bustos tomó la conversación", "Lucía Bustos reabrió la conversación"]);
      expect((await internal("GET", `/conversations/${id}`)).json()).toMatchObject({ status: "awaiting_user", resolvedAt: null });
    });

    it("es idempotente por clientMessageId y valida cuerpo vacío sin adjuntos", async () => {
      const id = await open(randomUUID());
      const clientMessageId = randomUUID();
      const first = await send(id, { body: "Hola", clientMessageId });
      const again = await send(id, { body: "Hola", clientMessageId });
      expect(again.json().message.id).toBe(first.json().message.id);
      expect(await app.db.supportMessage.count({ where: { conversationId: id, kind: "agent" } })).toBe(1);
      expect((await send(id, { body: "   " })).statusCode).toBe(400);
    });

    it("una respuesta con imágenes del agente (MOVO-321), y una del usuario no le sirve al agente", async () => {
      const user = randomUUID();
      const id = await open(user);
      const created = await internal("POST", `/conversations/${id}/attachments`, {
        ...actorOf(agent),
        contentType: "image/png",
        sizeBytes: 2000,
      });
      expect(created.statusCode).toBe(201);
      const { attachmentId } = created.json();
      const row = await app.db.supportAttachment.findUniqueOrThrow({ where: { id: attachmentId } });
      storage.__simulateUpload(row.s3Key, { contentType: "image/png", contentLength: 2000 });

      const reply = await send(id, { attachmentIds: [attachmentId] });
      expect(reply.json().message.attachments).toEqual([expect.objectContaining({ id: attachmentId, contentType: "image/png" })]);
      const pushes = vi.mocked(notifications.sendPush).mock.calls.map(([p]) => p.body);
      expect(pushes).toEqual(["Lucía: Te envió una imagen"]);

      const userPresign = await app.inject({
        method: "POST",
        url: "/support/attachments",
        headers: userHeaders(user),
        payload: { contentType: "image/jpeg", sizeBytes: 1000, conversationId: id },
      });
      const userAttachment = userPresign.json().attachmentId;
      const userRow = await app.db.supportAttachment.findUniqueOrThrow({ where: { id: userAttachment } });
      storage.__simulateUpload(userRow.s3Key, { contentType: "image/jpeg", contentLength: 1000 });
      expect((await send(id, { attachmentIds: [userAttachment] })).statusCode).toBe(422);
    });
  });

  describe("acciones con evento", () => {
    it("asignar, desasignar, prioridad y tema dejan eventos en tercera persona; las etiquetas no", async () => {
      const id = await open(randomUUID());
      const patch = (body: Record<string, unknown>) => {
        clock = new Date(clock.getTime() + 1000);
        return internal("PATCH", `/conversations/${id}`, { ...actorOf(agent), ...body });
      };

      await patch({ assignedTo: otherAgent.actorId, assigneeFullName: otherAgent.actorFullName });
      await patch({ assignedTo: null });
      await patch({ assignedTo: agent.actorId });
      await patch({ priority: "high", topic: "payments", tags: ["Cobro", "VIP"] });
      const unchanged = await patch({ priority: "high" });

      expect(unchanged.json()).toMatchObject({ priority: "high", topic: "payments", tags: ["Cobro", "VIP"], assignedTo: agent.actorId });
      const events = (await internal("GET", `/conversations/${id}/messages`)).json().items
        .filter((m: { kind: string }) => m.kind === "event")
        .map((m: { body: string; authorId: string }) => [m.body, m.authorId])
        .reverse();
      expect(events).toEqual([
        ["Lucía Bustos asignó la conversación a Tomás Ferreyra", agent.actorId],
        ["Lucía Bustos dejó la conversación sin asignar", agent.actorId],
        ["Lucía Bustos tomó la conversación", agent.actorId],
        ["Prioridad: alta", agent.actorId],
        ["Tema: pagos", agent.actorId],
      ]);
    });

    it("vincula un envío del usuario y lo desvincula; uno ajeno o inexistente responde 422", async () => {
      const user = randomUUID();
      const id = await open(user);
      const own = await shipmentOf(user);
      const foreign = await shipmentOf(randomUUID());

      const linked = await internal("PATCH", `/conversations/${id}`, { ...actorOf(agent), shipmentId: own });
      expect(linked.json().shipment.id).toBe(own);
      for (const shipmentId of [foreign, randomUUID()]) {
        const rejected = await internal("PATCH", `/conversations/${id}`, { ...actorOf(agent), shipmentId });
        expect(rejected.statusCode).toBe(422);
        expect(rejected.json().error.code).toBe("SUPPORT_SHIPMENT_NOT_PARTY");
      }
      const unlinked = await internal("PATCH", `/conversations/${id}`, { ...actorOf(agent), shipmentId: null });
      expect(unlinked.json().shipment).toBeNull();
      const bodies = (await internal("GET", `/conversations/${id}/messages`)).json().items.map((m: { body: string }) => m.body);
      expect(bodies).toContain("Envío desvinculado");
      expect(bodies.some((b: string) => b.startsWith("Vinculada a #MOVO-"))).toBe(true);
    });

    it("resolver y reabrir: eventos, el usuario ve el estado y repetirlos no hace nada", async () => {
      const user = randomUUID();
      const id = await open(user);
      clock = new Date(clock.getTime() + 1000);
      expect((await internal("POST", `/conversations/${id}/resolve`, actorOf(agent))).json()).toMatchObject({ status: "resolved" });
      await internal("POST", `/conversations/${id}/resolve`, actorOf(agent));
      clock = new Date(clock.getTime() + 1000);
      expect((await userHistory(user, id)).json().conversation.status).toBe("resolved");
      expect((await internal("POST", `/conversations/${id}/reopen`, actorOf(agent))).json()).toMatchObject({ status: "open", resolvedAt: null });

      const events = (await internal("GET", `/conversations/${id}/messages`)).json().items.filter((m: { kind: string }) => m.kind === "event");
      expect(events.map((m: { body: string }) => m.body)).toEqual(["Lucía Bustos reabrió la conversación", "Lucía Bustos resolvió la conversación"]);
      // El usuario no ve los eventos del equipo.
      expect((await userHistory(user, id)).json().items.map((m: { kind: string }) => m.kind)).toEqual(["user"]);
    });

    it("leer baja los no leídos compartidos y le pone el ✓✓ al usuario", async () => {
      const user = randomUUID();
      const id = await open(user);
      await userWrites(user, id, "¿Hay novedades?");
      expect((await internal("GET", `/conversations/${id}`)).json().unread).toBe(2);
      clock = new Date(clock.getTime() + 1000);

      expect((await internal("POST", `/conversations/${id}/read`)).statusCode).toBe(204);

      expect((await internal("GET", `/conversations/${id}`)).json().unread).toBe(0);
      const own = (await userHistory(user, id)).json().items;
      expect(own.every((m: { deliveryStatus: string }) => m.deliveryStatus === "read")).toBe(true);
    });
  });

  describe("contexto, partes y carga", () => {
    it("partes, demás consultas del usuario y carga por agente", async () => {
      const user = randomUUID();
      const a = await open(user);
      const b = await open(user, "otra", "payments");
      await internal("PATCH", `/conversations/${a}`, { ...actorOf(agent), assignedTo: agent.actorId });
      await internal("PATCH", `/conversations/${b}`, { ...actorOf(agent), assignedTo: agent.actorId });
      await internal("POST", `/conversations/${b}/resolve`, actorOf(agent));

      expect((await internal("GET", `/conversations/${a}/parties`)).json()).toEqual({ userId: user });
      expect((await internal("GET", `/conversations/${randomUUID()}/parties`)).statusCode).toBe(404);
      const others = (await internal("GET", `/conversations/${a}/user-conversations`)).json().items;
      expect(others).toEqual([expect.objectContaining({ conversationId: b, topic: "payments", status: "resolved" })]);
      expect((await internal("GET", "/agents/load")).json()).toEqual([{ agentId: agent.actorId, activeCount: 1 }]);
    });
  });

  describe("eventos para el panel (Redis Stream, ADR-056)", () => {
    it("consulta nueva, mensaje del usuario, respuesta, nota y acciones quedan en el stream con la fila", async () => {
      const user = randomUUID();
      const id = await open(user);
      await userWrites(user, id, "Sigo esperando");
      await send(id, { body: "Nota", internal: true });
      await internal("PATCH", `/conversations/${id}`, { ...actorOf(agent), priority: "urgent" });
      await internal("POST", `/conversations/${id}/read`);

      const events = await streamEvents();
      const types = events.map((e) => e.type);
      expect(types.filter((t) => t !== "counts_changed")).toEqual([
        "conversation_created",
        "support_message",
        "support_message",
        "support_message",
        "conversation_updated",
      ]);
      expect(types.filter((t) => t === "counts_changed")).toHaveLength(5);
      const note = events.find((e) => e.type === "support_message" && e.message.kind === "note");
      expect(note).toMatchObject({ conversation: { id }, message: { body: "Nota" } });
      const priority = events.find((e) => e.type === "support_message" && e.message.kind === "event");
      expect(priority).toMatchObject({ conversation: { priority: "urgent" }, message: { body: "Prioridad: urgente" } });
    });

    it("si el stream falla, la escritura responde igual", async () => {
      const id = await open(randomUUID());
      const spy = vi.spyOn(app.redis, "xadd").mockRejectedValueOnce(new Error("Redis caído"));
      expect((await send(id, { body: "Igual llega" })).statusCode).toBe(200);
      spy.mockRestore();
    });
  });
});
