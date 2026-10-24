import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { signAccessToken, ShipmentStatus, UserRole, KycStatus, SupportTopic, SupportStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createSupportRepository, SupportRepository } from "../src/repositories/support-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { buildSupportService } from "../src/modules/support/support.routes";
import { createFakeNotificationsClient } from "./fake-notifications-client";

/**
 * MOVO-320 (ADR-051): conversaciones de soporte del lado del usuario. Servidor TCP real (`app.listen`) y clientes
 * `ws` reales, mismo criterio que `chat.integration.test.ts`; HTTP por `app.inject` con los headers que inyecta el
 * gateway. Postgres y Redis reales. Lo que escribe el lado del agente (MOVO-322, todavía no existe) se simula
 * con el repositorio y `publishStaffMessage`, que es lo que va a llamar ese ticket.
 */
describe("Soporte al usuario (MOVO-320)", () => {
  let app: FastifyInstance;
  let shipments: ShipmentRepository;
  let supportRepo: SupportRepository;
  let baseUrl: string;
  // Resúmenes de ráfaga agendados (ADR-046): el test los dispara a mano en vez de esperar la ventana real.
  let scheduledFlushes: Array<() => void> = [];
  const notifications = createFakeNotificationsClient();
  // Servicio "del agente": el que va a usar MOVO-322 para difundir y avisar. Comparte hub y Redis con la app.
  let staffService: ReturnType<typeof buildSupportService>;

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

  /** Envío con transportista asignado, recorriendo transiciones reales. */
  async function createShipment() {
    const senderId = randomUUID();
    const receiverId = randomUUID();
    const carrierId = randomUUID();
    const shipment = await shipments.create({ ...baseInput, senderId, receiverId });
    await shipments.addPhoto(shipment.id, PhotoStage.creation, `shipments/${shipment.id}/creation/${randomUUID()}.jpg`);
    await shipments.addPhoto(shipment.id, PhotoStage.creation, `shipments/${shipment.id}/creation/${randomUUID()}.jpg`);
    await shipments.updateStatus(shipment.id, ShipmentStatus.PUBLISHED, senderId);
    await app.db.shipment.update({ where: { id: shipment.id }, data: { carrierId } });
    await shipments.updateStatus(shipment.id, ShipmentStatus.ASSIGNMENT_PENDING, carrierId);
    await shipments.updateStatus(shipment.id, ShipmentStatus.ASSIGNED, carrierId);
    return { shipmentId: shipment.id, senderId, receiverId, carrierId };
  }

  function token(sub: string, roles: UserRole[] = [UserRole.SENDER]): string {
    return signAccessToken({ sub, roles, kycStatus: KycStatus.NOT_STARTED });
  }

  const headers = (userId: string) => ({ "x-user-id": userId, "x-user-roles": "sender" });

  function open(
    userId: string,
    overrides: Partial<{ topic: SupportTopic; body: string; clientMessageId: string; shipmentId: string; attachmentIds: string[] }> = {}
  ) {
    return app.inject({
      method: "POST",
      url: "/support/conversations",
      headers: headers(userId),
      payload: { topic: "account", body: "No puedo entrar a mi cuenta", clientMessageId: randomUUID(), ...overrides },
    });
  }

  const list = (userId: string) => app.inject({ method: "GET", url: "/support/conversations", headers: headers(userId) });

  const history = (userId: string, conversationId: string, query = "") =>
    app.inject({ method: "GET", url: `/support/conversations/${conversationId}/messages${query}`, headers: headers(userId) });

  function write(userId: string, conversationId: string, body: string, clientMessageId: string = randomUUID()) {
    return app.inject({
      method: "POST",
      url: `/support/conversations/${conversationId}/messages`,
      headers: headers(userId),
      payload: { body, clientMessageId },
    });
  }

  const readConversation = (userId: string, conversationId: string) =>
    app.inject({ method: "POST", url: `/support/conversations/${conversationId}/read`, headers: headers(userId) });

  /** El usuario abre una consulta y devuelve sus ids. */
  async function openConversation(userId: string, body = "No puedo entrar a mi cuenta") {
    const response = await open(userId, { body });
    expect(response.statusCode).toBe(201);
    return response.json().conversation.id as string;
  }

  /** Lo que haría el lado del agente (MOVO-322) al responder: guarda, pasa a `awaiting_user` y difunde. */
  async function agentReplies(conversationId: string, body: string, agentName = "Lucía") {
    const { message, conversation } = await supportRepo.appendStaffMessage({
      conversationId,
      kind: "agent",
      authorId: randomUUID(),
      authorName: agentName,
      body,
      clientMessageId: randomUUID(),
      now: new Date(),
      nextStatus: "awaiting_user",
    });
    await staffService.publishStaffMessage(conversation, message);
    return message;
  }

  async function internalNote(conversationId: string, body: string) {
    const { message, conversation } = await supportRepo.appendStaffMessage({
      conversationId,
      kind: "note",
      authorId: randomUUID(),
      authorName: "Lucía",
      body,
      clientMessageId: randomUUID(),
      now: new Date(),
    });
    await staffService.publishStaffMessage(conversation, message);
    return message;
  }

  async function setStatus(conversationId: string, status: SupportStatus) {
    await app.db.supportConversation.update({
      where: { id: conversationId },
      data: { status, resolvedAt: status === "resolved" ? new Date() : null },
    });
  }

  interface Client {
    ws: WebSocket;
    messages: Array<Record<string, unknown>>;
    closed: Promise<{ code: number; reason: string }>;
  }

  /** Recoge los mensajes desde que se crea, para no perder los que llegan antes de esperar. */
  function connect(path: string, bearer?: string): Client {
    const ws = new WebSocket(`${baseUrl}${path}`, { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });
    const messages: Array<Record<string, unknown>> = [];
    ws.on("message", (data: Buffer) => messages.push(JSON.parse(data.toString())));
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on("close", (code: number, reason: Buffer) => resolve({ code, reason: reason.toString() }));
    });
    return { ws, messages, closed };
  }

  async function connectedSupport(conversationId: string, userId: string): Promise<Client> {
    const client = connect(`/support/conversations/${conversationId}`, token(userId));
    await vi.waitFor(() => expect(client.messages).toContainEqual({ type: "connected", conversationId }));
    return client;
  }

  /** Simula que se cerró la ventana de avisos (30 s): borra la marca de Redis, no la del resumen ya agendado. */
  async function expirePushWindows() {
    const keys = await app.redis.keys("notified:support-push:*");
    if (keys.length > 0) await app.redis.del(...keys);
  }

  const eventsOf = (client: Client, type: string) => client.messages.filter((m) => m.type === type);
  const toUser = (userId: string) =>
    vi.mocked(notifications.sendPush).mock.calls.filter(([input]) => input.userId === userId).map(([input]) => input);

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    const schedulePush = (run: () => void) => {
      scheduledFlushes.push(run);
    };
    app = buildApp({ notificationsClient: notifications, supportSchedulePush: schedulePush, sweepEnabled: false });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("El servidor de test no devolvió una dirección TCP");
    baseUrl = `ws://127.0.0.1:${address.port}`;
    shipments = createShipmentRepository(app.db);
    supportRepo = createSupportRepository(app.db);
    staffService = buildSupportService(app, { notificationsClient: notifications, schedulePush });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    scheduledFlushes = [];
    vi.mocked(notifications.sendPush).mockClear();
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.support_conversations, shipments.shipments RESTART IDENTITY CASCADE");
    const keys = [...(await app.redis.keys("notified:support-push*")), ...(await app.redis.keys("chat-push-buffer:support:*"))];
    if (keys.length > 0) await app.redis.del(...keys);
  });

  describe("crear una consulta", () => {
    it("sin envío es una consulta libre: 201 con su código SOP, estado open y el primer mensaje", async () => {
      const userId = randomUUID();
      const clientMessageId = randomUUID();
      const response = await open(userId, { topic: "payments", body: "  Me cobraron dos veces  ", clientMessageId });

      expect(response.statusCode).toBe(201);
      const { conversation, message } = response.json();
      expect(conversation).toMatchObject({
        topic: "payments",
        status: "open",
        shipment: null,
        unreadCount: 0,
        lastMessage: { from: "user", authorName: null, body: "Me cobraron dos veces", hasAttachments: false },
      });
      expect(conversation.code).toMatch(/^SOP-\d{4,}$/);
      expect(message).toMatchObject({
        conversationId: conversation.id,
        kind: "user",
        body: "Me cobraron dos veces",
        clientMessageId,
        moderated: false,
        deliveryStatus: "sent",
        attachments: [],
      });
      const stored = await app.db.supportConversation.findUniqueOrThrow({ where: { id: conversation.id } });
      expect(stored).toMatchObject({ userId, priority: "normal", assignedTo: null, tags: [] });
    });

    it.each(["sender", "carrier", "receiver"] as const)("con un envío del que el usuario es %s vincula el envío", async (role) => {
      const p = await createShipment();
      const userId = { sender: p.senderId, carrier: p.carrierId, receiver: p.receiverId }[role];

      const response = await open(userId, { topic: "shipment", shipmentId: p.shipmentId });

      expect(response.statusCode).toBe(201);
      const { shipment } = response.json().conversation;
      expect(shipment.id).toBe(p.shipmentId);
      expect(shipment.code).toMatch(/^MOVO-\d{5}$/);
    });

    it("un envío del que el usuario no es parte responde 422 SUPPORT_SHIPMENT_NOT_PARTY y no crea nada", async () => {
      const p = await createShipment();
      const stranger = randomUUID();

      const response = await open(stranger, { topic: "shipment", shipmentId: p.shipmentId });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("SUPPORT_SHIPMENT_NOT_PARTY");
      expect(await app.db.supportConversation.count()).toBe(0);
    });

    it("un envío inexistente da la misma respuesta que uno ajeno (no se filtra qué ids existen)", async () => {
      const response = await open(randomUUID(), { topic: "shipment", shipmentId: randomUUID() });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("SUPPORT_SHIPMENT_NOT_PARTY");
    });

    it("un admin que no es parte tampoco puede vincular un envío ajeno", async () => {
      const p = await createShipment();
      const response = await app.inject({
        method: "POST",
        url: "/support/conversations",
        headers: { "x-user-id": randomUUID(), "x-user-roles": "admin" },
        payload: { topic: "shipment", body: "Hola", clientMessageId: randomUUID(), shipmentId: p.shipmentId },
      });
      expect(response.statusCode).toBe(422);
    });

    it("es idempotente por clientMessageId: el reenvío da 200 con lo ya creado y no duplica", async () => {
      const userId = randomUUID();
      const clientMessageId = randomUUID();
      const first = await open(userId, { clientMessageId });
      const replay = await open(userId, { clientMessageId });

      expect(first.statusCode).toBe(201);
      expect(replay.statusCode).toBe(200);
      expect(replay.json().conversation.id).toBe(first.json().conversation.id);
      expect(replay.json().message.id).toBe(first.json().message.id);
      expect(await app.db.supportConversation.count()).toBe(1);
      expect(await app.db.supportMessage.count()).toBe(1);
    });

    it("dos pedidos simultáneos con el mismo clientMessageId crean una sola consulta", async () => {
      const userId = randomUUID();
      const clientMessageId = randomUUID();

      const [a, b] = await Promise.all([open(userId, { clientMessageId }), open(userId, { clientMessageId })]);

      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
      expect(a.json().conversation.id).toBe(b.json().conversation.id);
      expect(await app.db.supportConversation.count()).toBe(1);
      expect(await app.db.supportMessage.count()).toBe(1);
    });

    it("rechaza un texto vacío, un tema inválido y un adjunto inexistente", async () => {
      const userId = randomUUID();
      expect((await open(userId, { body: "   " })).statusCode).toBe(400);
      expect((await open(userId, { topic: "otro" as SupportTopic })).statusCode).toBe(400);
      const withAttachments = await open(userId, { attachmentIds: [randomUUID()] });
      expect(withAttachments.statusCode).toBe(422);
      expect(withAttachments.json().error.code).toBe("SUPPORT_ATTACHMENT_INVALID");
      expect(await app.db.supportConversation.count()).toBe(0);
    });

    it("el filtro de lenguaje tapa las palabras ofensivas del usuario y marca moderated", async () => {
      const response = await open(randomUUID(), { body: "Son unos pelotudos" });
      expect(response.json().message).toMatchObject({ body: "Son unos *********", moderated: true });
      const stored = await app.db.supportMessage.findFirstOrThrow();
      expect(stored).toMatchObject({ body: "Son unos *********", moderated: true });
    });
  });

  describe("listar", () => {
    it("devuelve solo las consultas del usuario, la de actividad más reciente primero", async () => {
      const userId = randomUUID();
      const other = randomUUID();
      const first = await openConversation(userId, "Primera");
      const second = await openConversation(userId, "Segunda");
      await openConversation(other, "De otra persona");
      await write(userId, first, "Sigo sin respuesta");

      const response = await list(userId);

      expect(response.statusCode).toBe(200);
      const items = response.json().items;
      expect(items.map((i: { id: string }) => i.id)).toEqual([first, second]);
      expect(items[0].lastMessage.body).toBe("Sigo sin respuesta");
      expect(JSON.stringify(items)).not.toContain("De otra persona");
    });

    it("cuenta como no leídas las respuestas del equipo, y leer baja el contador a cero", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);
      await agentReplies(id, "Hola, ya lo revisamos");
      await agentReplies(id, "¿Podés mandarnos tu DNI?");

      const before = (await list(userId)).json().items[0];
      expect(before).toMatchObject({ unreadCount: 2, status: "awaiting_user" });
      expect(before.lastMessage).toMatchObject({ from: "agent", authorName: "Lucía", body: "¿Podés mandarnos tu DNI?" });

      const read = await readConversation(userId, id);
      expect(read.statusCode).toBe(200);
      expect(read.json().readAt).toEqual(expect.any(String));
      expect((await list(userId)).json().items[0].unreadCount).toBe(0);
    });

    it("sin consultas devuelve una lista vacía", async () => {
      const response = await list(randomUUID());
      expect(response.json()).toEqual({ items: [] });
    });
  });

  describe("leer el historial", () => {
    it("trae los mensajes del más reciente al más antiguo, con la conversación para el encabezado", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId, "Uno");
      await write(userId, id, "Dos");
      await agentReplies(id, "Tres");

      const response = await history(userId, id);

      expect(response.statusCode).toBe(200);
      const page = response.json();
      expect(page.items.map((m: { body: string }) => m.body)).toEqual(["Tres", "Dos", "Uno"]);
      expect(page.items[0]).toMatchObject({ kind: "agent", authorName: "Lucía", deliveryStatus: null });
      expect(page.items[1]).toMatchObject({ kind: "user", authorName: null, deliveryStatus: "sent" });
      expect(page.nextCursor).toBeNull();
      expect(page.conversation).toMatchObject({ id, status: "awaiting_user" });
    });

    it("pagina con un cursor opaco sin saltear ni repetir mensajes", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId, "m1");
      for (const n of [2, 3, 4, 5]) await write(userId, id, `m${n}`);

      const first = (await history(userId, id, "?limit=2")).json();
      expect(first.items.map((m: { body: string }) => m.body)).toEqual(["m5", "m4"]);
      expect(first.nextCursor).toEqual(expect.any(String));
      const second = (await history(userId, id, `?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
      expect(second.items.map((m: { body: string }) => m.body)).toEqual(["m3", "m2"]);
      const third = (await history(userId, id, `?limit=2&cursor=${encodeURIComponent(second.nextCursor)}`)).json();
      expect(third.items.map((m: { body: string }) => m.body)).toEqual(["m1"]);
      expect(third.nextCursor).toBeNull();
    });

    it("un cursor inválido responde 400", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);
      const response = await history(userId, id, "?cursor=basura");
      expect(response.statusCode).toBe(400);
    });

    it("una consulta ajena responde 404, igual que una inexistente (no filtra existencia)", async () => {
      const owner = randomUUID();
      const id = await openConversation(owner);

      const foreign = await history(randomUUID(), id);
      const missing = await history(owner, randomUUID());

      expect(foreign.statusCode).toBe(404);
      expect(missing.statusCode).toBe(404);
      expect(foreign.json().error.code).toBe("SUPPORT_CONVERSATION_NOT_FOUND");
      expect(foreign.json().error).toEqual(missing.json().error);
    });

    it("no se puede escribir ni marcar como leída una consulta ajena", async () => {
      const id = await openConversation(randomUUID());
      const stranger = randomUUID();
      expect((await write(stranger, id, "Hola")).statusCode).toBe(404);
      expect((await readConversation(stranger, id)).statusCode).toBe(404);
      expect(await app.db.supportMessage.count()).toBe(1);
    });

    it("el ✓✓ leído aparece cuando un agente abrió la conversación", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);
      expect((await history(userId, id)).json().items[0].deliveryStatus).toBe("sent");

      await staffService.publishAgentRead(id, userId, new Date());

      expect((await history(userId, id)).json().items[0].deliveryStatus).toBe("read");
    });
  });

  describe("escribir", () => {
    it("es idempotente por clientMessageId: 201 la primera vez, 200 el reenvío, sin duplicar", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);
      const clientMessageId = randomUUID();

      const first = await write(userId, id, "Agrego un dato", clientMessageId);
      const replay = await write(userId, id, "Agrego un dato", clientMessageId);

      expect(first.statusCode).toBe(201);
      expect(replay.statusCode).toBe(200);
      expect(replay.json().id).toBe(first.json().id);
      expect(await app.db.supportMessage.count({ where: { conversationId: id } })).toBe(2);
    });

    it("reusar un clientMessageId de otra consulta propia responde 400", async () => {
      const userId = randomUUID();
      const a = await openConversation(userId);
      const b = await openConversation(userId);
      const clientMessageId = randomUUID();
      await write(userId, a, "Hola", clientMessageId);

      const response = await write(userId, b, "Hola", clientMessageId);

      expect(response.statusCode).toBe(400);
    });

    it("crear con un clientMessageId ya usado en un mensaje posterior de otra consulta responde 400 y no la devuelve", async () => {
      const userId = randomUUID();
      const a = await openConversation(userId);
      const clientMessageId = randomUUID();
      await write(userId, a, "Agrego un dato", clientMessageId);

      const response = await open(userId, { clientMessageId });

      expect(response.statusCode).toBe(400);
      expect(await app.db.supportConversation.count({ where: { userId } })).toBe(1);
    });

    it("una consulta awaiting_user vuelve a open cuando el usuario responde", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);
      await agentReplies(id, "¿Me das más datos?");
      expect((await history(userId, id)).json().conversation.status).toBe("awaiting_user");

      await write(userId, id, "Sí, claro");

      expect((await history(userId, id)).json().conversation.status).toBe("open");
      // No se agrega ningún evento de sistema: no estaba resuelta.
      expect(await app.db.supportMessage.count({ where: { kind: "system" } })).toBe(0);
    });

    it("una consulta resuelta se reabre y deja el mensaje de sistema, y sigue en la lista", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);
      await setStatus(id, "resolved");

      const response = await write(userId, id, "Volvió a pasar");

      expect(response.statusCode).toBe(201);
      const page = (await history(userId, id)).json();
      expect(page.conversation.status).toBe("open");
      expect(page.items.map((m: { kind: string; body: string }) => [m.kind, m.body])).toEqual([
        ["system", "Se reabrió la conversación"],
        ["user", "Volvió a pasar"],
        ["user", "No puedo entrar a mi cuenta"],
      ]);
      expect(page.items[0]).toMatchObject({ authorName: null, clientMessageId: null, deliveryStatus: null });
      const stored = await app.db.supportConversation.findUniqueOrThrow({ where: { id } });
      expect(stored.resolvedAt).toBeNull();
      // El último mensaje de la lista es el del usuario, nunca el evento del sistema.
      expect((await list(userId)).json().items[0].lastMessage.body).toBe("Volvió a pasar");
    });

    it("dos mensajes simultáneos sobre una resuelta la reabren una sola vez", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);
      await setStatus(id, "resolved");

      await Promise.all([write(userId, id, "Uno"), write(userId, id, "Dos")]);

      expect(await app.db.supportMessage.count({ where: { kind: "system" } })).toBe(1);
    });

    it("una nota interna no mueve lastActivityAt ni el orden de la lista", async () => {
      const userId = randomUUID();
      const first = await openConversation(userId, "Primera");
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await openConversation(userId, "Segunda");
      const before = (await list(userId)).json().items;
      expect(before.map((i: { id: string }) => i.id)).toEqual([second, first]);

      await internalNote(first, "NOTA-INTERNA-no-mostrar");

      const after = (await list(userId)).json().items;
      expect(after.map((i: { id: string }) => i.id)).toEqual([second, first]);
      expect(after[1].lastActivityAt).toBe(before[1].lastActivityAt);
    });

    it("las conversaciones resueltas no se borran ni se archivan (sin purga)", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);
      await setStatus(id, "resolved");
      await app.db.supportConversation.update({ where: { id }, data: { lastMessageAt: new Date("2024-01-01T00:00:00Z") } });

      const items = (await list(userId)).json().items;

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ id, status: "resolved" });
      expect((await history(userId, id)).statusCode).toBe(200);
    });
  });

  describe("las notas internas nunca llegan al usuario", () => {
    const SECRET = "NOTA-INTERNA-no-mostrar";

    it("historial: la query no las devuelve", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);
      await internalNote(id, SECRET);
      await agentReplies(id, "Respuesta pública");

      // La nota existe de verdad en la base: el filtro es de la query, no de que nunca se haya guardado.
      expect(await app.db.supportMessage.count({ where: { kind: "note" } })).toBe(1);
      const response = await history(userId, id);
      expect(JSON.stringify(response.json())).not.toContain(SECRET);
      expect(response.json().items.map((m: { kind: string }) => m.kind)).toEqual(["agent", "user"]);
      // Tampoco por una página más chica que deje la nota "en el medio".
      const small = (await history(userId, id, "?limit=1")).json();
      expect(JSON.stringify(small)).not.toContain(SECRET);
    });

    it("lista: ni como último mensaje ni como no leído", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId, "Mi consulta");
      await agentReplies(id, "Respuesta pública");
      await readConversation(userId, id);
      await internalNote(id, SECRET);

      const item = (await list(userId)).json().items[0];

      expect(item.lastMessage.body).toBe("Respuesta pública");
      expect(item.unreadCount).toBe(0);
      expect(JSON.stringify(item)).not.toContain(SECRET);
    });

    it("WebSocket: la nota no se emite, y el resto sí", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);
      const client = await connectedSupport(id, userId);

      await internalNote(id, SECRET);
      await agentReplies(id, "Respuesta pública");

      await vi.waitFor(() => expect(eventsOf(client, "support_message")).toHaveLength(1));
      expect(JSON.stringify(client.messages)).not.toContain(SECRET);
      client.ws.close();
    });

    it("push: una nota no avisa al usuario", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);

      await internalNote(id, SECRET);

      expect(toUser(userId)).toHaveLength(0);
      expect(scheduledFlushes).toHaveLength(0);
      expect(JSON.stringify(vi.mocked(notifications.sendPush).mock.calls)).not.toContain(SECRET);
    });
  });

  describe("tiempo real (WebSocket)", () => {
    it("rechaza sin token (4001), una consulta ajena o inexistente (4004) y a un admin que no es el dueño (4003)", async () => {
      const owner = randomUUID();
      const id = await openConversation(owner);

      expect((await connect(`/support/conversations/${id}`).closed).code).toBe(4001);
      expect((await connect(`/support/conversations/${id}`, "token-roto").closed).code).toBe(4001);
      expect((await connect(`/support/conversations/${id}`, token(randomUUID())).closed).code).toBe(4004);
      expect((await connect(`/support/conversations/${randomUUID()}`, token(owner)).closed).code).toBe(4004);
      expect((await connect(`/support/conversations/${id}`, token(randomUUID(), [UserRole.ADMIN])).closed).code).toBe(4003);
    });

    it("el dueño recibe la respuesta del agente en tiempo real", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);
      const client = await connectedSupport(id, userId);

      const message = await agentReplies(id, "Hola, ya lo vemos");

      await vi.waitFor(() => expect(eventsOf(client, "support_message")).toHaveLength(1));
      expect(eventsOf(client, "support_message")[0]).toMatchObject({
        message: { id: message.id, conversationId: id, kind: "agent", authorName: "Lucía", body: "Hola, ya lo vemos" },
      });
      client.ws.close();
    });

    it("escribir sobre una resuelta emite el evento de sistema y el cambio de estado", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);
      await setStatus(id, "resolved");
      const client = await connectedSupport(id, userId);

      await write(userId, id, "Volvió a pasar");

      await vi.waitFor(() => expect(eventsOf(client, "support_status")).toHaveLength(1));
      expect(eventsOf(client, "support_status")[0]).toEqual({ type: "support_status", conversationId: id, status: "open" });
      const bodies = eventsOf(client, "support_message").map((e) => (e.message as { body: string }).body);
      expect(bodies).toEqual(["Volvió a pasar", "Se reabrió la conversación"]);
      client.ws.close();
    });

    it("un agente que lee la conversación manda el recibo para actualizar los tildes", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);
      const client = await connectedSupport(id, userId);
      const upTo = new Date();

      await staffService.publishAgentRead(id, userId, upTo);

      await vi.waitFor(() => expect(eventsOf(client, "support_receipt")).toHaveLength(1));
      expect(eventsOf(client, "support_receipt")[0]).toEqual({ type: "support_receipt", conversationId: id, upTo: upTo.toISOString() });
      client.ws.close();
    });

    it("no mezcla tráfico con el chat del envío: la sala de soporte es distinta", async () => {
      const p = await createShipment();
      const id = await openConversation(p.senderId);
      const support = await connectedSupport(id, p.senderId);
      const shipmentChat = connect(`/shipments/${p.shipmentId}/chat`, token(p.senderId));
      await vi.waitFor(() => expect(shipmentChat.messages).toContainEqual({ type: "connected", shipmentId: p.shipmentId }));

      await agentReplies(id, "Respuesta de soporte");
      await app.inject({
        method: "POST",
        url: `/shipments/${p.shipmentId}/chat/messages`,
        headers: { "x-user-id": p.carrierId, "x-user-roles": "carrier" },
        payload: { body: "Mensaje del chat del envío", clientMessageId: randomUUID() },
      });

      await vi.waitFor(() => expect(eventsOf(support, "support_message")).toHaveLength(1));
      await vi.waitFor(() => expect(eventsOf(shipmentChat, "chat_message")).toHaveLength(1));
      expect(JSON.stringify(support.messages)).not.toContain("Mensaje del chat del envío");
      expect(JSON.stringify(shipmentChat.messages)).not.toContain("Respuesta de soporte");
      support.ws.close();
      shipmentChat.ws.close();
    });

    it("conectarse cuenta como recibir lo que había", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);
      await connectedSupport(id, userId).then((c) => c.ws.close());

      await vi.waitFor(async () => {
        const state = await app.db.supportParticipantState.findUnique({
          where: { conversationId_userId: { conversationId: id, userId } },
        });
        expect(state?.lastDeliveredAt).toBeTruthy();
      });
    });
  });

  describe("push de la respuesta del equipo (ADR-046)", () => {
    it("avisa con el nombre del agente y el texto, en la categoría support, y apunta a la consulta", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);

      await agentReplies(id, "Ya revisamos tu caso");

      expect(toUser(userId)).toEqual([
        {
          userId,
          title: "Soporte de Movo",
          body: "Lucía: Ya revisamos tu caso",
          category: "support",
          data: { type: "support_message", conversationId: id },
        },
      ]);
    });

    it("no avisa si el usuario tiene la conversación abierta por WebSocket", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);
      const client = await connectedSupport(id, userId);

      await agentReplies(id, "Te respondo acá");

      await vi.waitFor(() => expect(eventsOf(client, "support_message")).toHaveLength(1));
      expect(toUser(userId)).toHaveLength(0);
      client.ws.close();
    });

    it("un evento de sistema no avisa", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);
      const { message, conversation } = await supportRepo.appendStaffMessage({
        conversationId: id,
        kind: "system",
        authorId: null,
        authorName: null,
        body: "Lucía Ferreyra tomó la conversación",
        clientMessageId: null,
        now: new Date(),
      });

      await staffService.publishStaffMessage(conversation, message);

      expect(toUser(userId)).toHaveLength(0);
    });

    it("una ráfaga se junta: avisa la primera y, al cerrar la ventana, un único resumen", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);

      await agentReplies(id, "Primero");
      await agentReplies(id, "Segundo");
      await agentReplies(id, "Tercero");

      // Dentro de la ventana solo salió la del primer mensaje; el resumen se agenda una sola vez.
      expect(toUser(userId)).toHaveLength(1);
      expect(toUser(userId)[0].body).toBe("Lucía: Primero");
      expect(scheduledFlushes).toHaveLength(1);

      await expirePushWindows();
      scheduledFlushes.splice(0).forEach((run) => run());
      await vi.waitFor(() => expect(toUser(userId)).toHaveLength(2));
      expect(toUser(userId)[1]).toMatchObject({ title: "Soporte de Movo", body: "2 mensajes nuevos · Lucía: Tercero", category: "support" });
    });

    it("el resumen no sale si el usuario ya leyó la conversación", async () => {
      const userId = randomUUID();
      const id = await openConversation(userId);
      await agentReplies(id, "Primero");
      await agentReplies(id, "Segundo");
      await readConversation(userId, id);

      await expirePushWindows();
      scheduledFlushes.splice(0).forEach((run) => run());

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(toUser(userId)).toHaveLength(1);
    });

    it("el bloqueo de usuarios (ADR-026) no aplica: la otra parte es Movo", async () => {
      // No hay chequeo de bloqueo en ningún camino de soporte: quien tiene bloqueos igual recibe las respuestas.
      const userId = randomUUID();
      const id = await openConversation(userId);
      await agentReplies(id, "Hola");
      expect(toUser(userId)).toHaveLength(1);
      expect((await history(userId, id)).json().items.map((m: { body: string }) => m.body)).toEqual(["Hola", "No puedo entrar a mi cuenta"]);
    });
  });
});
