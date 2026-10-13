import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { signAccessToken, ShipmentStatus, UserRole, KycStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";
import { createFakeNotificationsClient } from "./fake-notifications-client";

/**
 * MOVO-26: chat de un envío. Servidor TCP real (`app.listen`) y clientes `ws` reales, mismo
 * criterio que `tracking.integration.test.ts`; HTTP por `app.inject` con los headers que
 * inyecta el gateway. Postgres y Redis reales.
 */
describe("Chat del envío (MOVO-26)", () => {
  let app: FastifyInstance;
  let repo: ShipmentRepository;
  let baseUrl: string;
  let clock = new Date();
  const blocks: Array<[string, string]> = [];
  const notifications = createFakeNotificationsClient();

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

  interface Parties {
    shipmentId: string;
    senderId: string;
    receiverId: string;
    carrierId: string;
  }

  /** Envío con transportista asignado y en el estado pedido, recorriendo transiciones reales. */
  async function createShipment(target: "assigned" | "in_transit" = "in_transit"): Promise<Parties> {
    const senderId = randomUUID();
    const receiverId = randomUUID();
    const carrierId = randomUUID();
    const shipment = await repo.create({ ...baseInput, senderId, receiverId });
    await repo.addPhoto(shipment.id, PhotoStage.creation, `shipments/${shipment.id}/creation/${randomUUID()}.jpg`);
    await repo.addPhoto(shipment.id, PhotoStage.creation, `shipments/${shipment.id}/creation/${randomUUID()}.jpg`);
    await repo.updateStatus(shipment.id, ShipmentStatus.PUBLISHED, senderId);
    await app.db.shipment.update({ where: { id: shipment.id }, data: { carrierId } });
    await repo.updateStatus(shipment.id, ShipmentStatus.ASSIGNMENT_PENDING, carrierId);
    await repo.updateStatus(shipment.id, ShipmentStatus.ASSIGNED, carrierId);
    if (target === "in_transit") await repo.updateStatus(shipment.id, ShipmentStatus.IN_TRANSIT, carrierId);
    return { shipmentId: shipment.id, senderId, receiverId, carrierId };
  }

  function token(sub: string, roles: UserRole[] = [UserRole.SENDER]): string {
    return signAccessToken({ sub, roles, kycStatus: KycStatus.NOT_STARTED });
  }

  function send(shipmentId: string, userId: string, body: string, clientMessageId: string = randomUUID(), roles = "sender") {
    return app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/chat/messages`,
      headers: { "x-user-id": userId, "x-user-roles": roles },
      payload: { body, clientMessageId },
    });
  }

  function history(shipmentId: string, userId: string, query = "", roles = "sender") {
    return app.inject({
      method: "GET",
      url: `/shipments/${shipmentId}/chat/messages${query}`,
      headers: { "x-user-id": userId, "x-user-roles": roles },
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

  const connectChat = (shipmentId: string, bearer?: string) => connect(`/shipments/${shipmentId}/chat`, bearer);

  async function connectedChat(shipmentId: string, userId: string): Promise<Client> {
    const client = connectChat(shipmentId, token(userId));
    await vi.waitFor(() => expect(client.messages).toContainEqual({ type: "connected", shipmentId }));
    return client;
  }

  const chatMessagesOf = (client: Client) => client.messages.filter((m) => m.type === "chat_message");

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    app = buildApp({
      usersClient: createFakeUsersClient(
        new Proxy({}, { get: (_target, id: string) => fakePublicProfile({ id, fullName: "Ana Gómez" }) }),
        {},
        blocks
      ),
      notificationsClient: notifications,
      chatNow: () => clock,
      sweepEnabled: false,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("El servidor de test no devolvió una dirección TCP");
    baseUrl = `ws://127.0.0.1:${address.port}`;
    repo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    clock = new Date();
    blocks.length = 0;
    vi.mocked(notifications.sendPush).mockClear();
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
    const keys = await app.redis.keys("notified:chat-push:*");
    if (keys.length > 0) await app.redis.del(...keys);
  });

  describe("envío y entrega en tiempo real", () => {
    it("el mensaje del emisor le llega por WebSocket al transportista y al propio emisor", async () => {
      const p = await createShipment();
      const carrier = await connectedChat(p.shipmentId, p.carrierId);
      const sender = await connectedChat(p.shipmentId, p.senderId);

      const clientMessageId = randomUUID();
      const response = await send(p.shipmentId, p.senderId, "  Ya salgo para allá  ", clientMessageId);

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        shipmentId: p.shipmentId,
        authorId: p.senderId,
        body: "Ya salgo para allá",
        clientMessageId,
      });
      await vi.waitFor(() => expect(chatMessagesOf(carrier)).toHaveLength(1));
      await vi.waitFor(() => expect(chatMessagesOf(sender)).toHaveLength(1));
      expect(chatMessagesOf(carrier)[0]).toEqual({ type: "chat_message", message: response.json() });

      carrier.ws.close();
      sender.ws.close();
    });

    it("el receptor también participa: escribe y lo ve el transportista", async () => {
      const p = await createShipment();
      const carrier = await connectedChat(p.shipmentId, p.carrierId);

      const response = await send(p.shipmentId, p.receiverId, "¿A qué hora llegás?");

      expect(response.statusCode).toBe(201);
      await vi.waitFor(() => expect(chatMessagesOf(carrier)).toHaveLength(1));
      carrier.ws.close();
    });

    it("también hay chat con el transportista recién asignado (assigned)", async () => {
      const p = await createShipment("assigned");
      const response = await send(p.shipmentId, p.carrierId, "Hola, soy tu transportista", randomUUID(), "carrier");
      expect(response.statusCode).toBe(201);
    });

    it("un reenvío con el mismo clientMessageId no duplica: 200, una sola fila y una sola difusión", async () => {
      const p = await createShipment();
      const carrier = await connectedChat(p.shipmentId, p.carrierId);
      const clientMessageId = randomUUID();

      const first = await send(p.shipmentId, p.senderId, "Hola", clientMessageId);
      const second = await send(p.shipmentId, p.senderId, "Hola", clientMessageId);

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(200);
      expect(second.json().id).toBe(first.json().id);
      expect(await app.db.chatMessage.count({ where: { shipmentId: p.shipmentId } })).toBe(1);
      await vi.waitFor(() => expect(chatMessagesOf(carrier)).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(chatMessagesOf(carrier)).toHaveLength(1);
      carrier.ws.close();
    });

    it("el chat no se mezcla con el canal de tracking del mismo envío", async () => {
      const p = await createShipment();
      const tracking = connect(`/shipments/${p.shipmentId}/track`, token(p.senderId));
      await vi.waitFor(() => expect(tracking.messages).toContainEqual({ type: "connected", shipmentId: p.shipmentId }));

      await send(p.shipmentId, p.carrierId, "Estoy en camino", randomUUID(), "carrier");
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(tracking.messages.filter((m) => m.type === "chat_message")).toHaveLength(0);
      tracking.ws.close();
    });
  });

  describe("filtro de lenguaje", () => {
    it("tapa la palabra ofensiva antes de guardar y de difundir, y marca el mensaje como moderado", async () => {
      const p = await createShipment();
      const carrier = await connectedChat(p.shipmentId, p.carrierId);

      const response = await send(p.shipmentId, p.senderId, "Sos un pelotudo, llegá a horario");

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ body: "Sos un ********, llegá a horario", moderated: true });
      await vi.waitFor(() => expect(chatMessagesOf(carrier)).toHaveLength(1));
      expect(JSON.stringify(chatMessagesOf(carrier))).not.toContain("pelotudo");
      const stored = await app.db.chatMessage.findFirstOrThrow({ where: { shipmentId: p.shipmentId } });
      expect(stored.body).toBe("Sos un ********, llegá a horario");
      expect(stored.moderated).toBe(true);
      const page = (await history(p.shipmentId, p.receiverId)).json();
      expect(page.items[0]).toMatchObject({ body: "Sos un ********, llegá a horario", moderated: true });
      carrier.ws.close();
    });

    it("un mensaje limpio sale igual y sin marcar", async () => {
      const p = await createShipment();
      const response = await send(p.shipmentId, p.senderId, "Ya estoy en la puerta");
      expect(response.json()).toMatchObject({ body: "Ya estoy en la puerta", moderated: false });
    });

    it("un reenvío del mismo mensaje devuelve el mismo texto ya tapado", async () => {
      const p = await createShipment();
      const clientMessageId = randomUUID();
      await send(p.shipmentId, p.senderId, "forro", clientMessageId);
      const replay = await send(p.shipmentId, p.senderId, "forro", clientMessageId);
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ body: "*****", moderated: true });
    });
  });

  describe("autorización y validación", () => {
    it("un tercero ajeno al envío recibe 403 al enviar y al leer, y 4003 al conectarse", async () => {
      const p = await createShipment();
      const stranger = randomUUID();

      expect((await send(p.shipmentId, stranger, "Hola")).statusCode).toBe(403);
      expect((await history(p.shipmentId, stranger)).statusCode).toBe(403);
      const ws = connectChat(p.shipmentId, token(stranger));
      expect((await ws.closed).code).toBe(4003);
    });

    it("sin token el WebSocket se rechaza con 4001 y un envío inexistente con 4004", async () => {
      const p = await createShipment();
      expect((await connectChat(p.shipmentId).closed).code).toBe(4001);
      expect((await connectChat(randomUUID(), token(p.senderId)).closed).code).toBe(4004);
    });

    it("rechaza mensajes vacíos, solo espacios o de más de 1000 caracteres", async () => {
      const p = await createShipment();
      expect((await send(p.shipmentId, p.senderId, "     ")).statusCode).toBe(400);
      expect((await send(p.shipmentId, p.senderId, "a".repeat(1001))).statusCode).toBe(400);
      expect((await send(p.shipmentId, p.senderId, "a".repeat(1000))).statusCode).toBe(201);
    });

    it("con un bloqueo entre el escritor y otra de las partes, enviar da 403 USER_BLOCKED pero leer sigue andando", async () => {
      const p = await createShipment();
      await send(p.shipmentId, p.senderId, "Antes del bloqueo");
      blocks.push([p.carrierId, p.senderId]);

      const blocked = await send(p.shipmentId, p.senderId, "Después");
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error.code).toBe("USER_BLOCKED");
      expect((await history(p.shipmentId, p.senderId)).statusCode).toBe(200);
    });
  });

  describe("historial", () => {
    it("lo pagina por cursor del más reciente al más antiguo, sin repetir ni saltear", async () => {
      const p = await createShipment();
      const bodies = ["uno", "dos", "tres", "cuatro", "cinco"];
      for (const body of bodies) await send(p.shipmentId, p.senderId, body);

      const page1 = (await history(p.shipmentId, p.carrierId, "?limit=2", "carrier")).json();
      expect(page1.items.map((m: { body: string }) => m.body)).toEqual(["cinco", "cuatro"]);
      expect(page1.access).toBe("open");

      const page2 = (await history(p.shipmentId, p.carrierId, `?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`, "carrier")).json();
      expect(page2.items.map((m: { body: string }) => m.body)).toEqual(["tres", "dos"]);

      const page3 = (await history(p.shipmentId, p.carrierId, `?limit=2&cursor=${encodeURIComponent(page2.nextCursor)}`, "carrier")).json();
      expect(page3.items.map((m: { body: string }) => m.body)).toEqual(["uno"]);
      expect(page3.nextCursor).toBeNull();
    });

    it("un cursor inválido responde 400", async () => {
      const p = await createShipment();
      expect((await history(p.shipmentId, p.senderId, "?cursor=basura")).statusCode).toBe(400);
    });
  });

  describe("ventana del chat", () => {
    it("cancelar el envío cierra el chat: 409 CHAT_CLOSED y se corta el socket abierto (4009)", async () => {
      const p = await createShipment("assigned");
      const sender = await connectedChat(p.shipmentId, p.senderId);

      await repo.updateStatus(p.shipmentId, ShipmentStatus.CANCELLED, p.senderId);

      expect((await sender.closed).code).toBe(4009);
      const response = await send(p.shipmentId, p.senderId, "¿Seguís ahí?");
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("CHAT_CLOSED");
      expect((await history(p.shipmentId, p.senderId)).statusCode).toBe(409);
      expect((await connectChat(p.shipmentId, token(p.senderId)).closed).code).toBe(4009);
    });

    it("entregado: sigue abierto hasta 24 h después y se cierra pasado ese plazo", async () => {
      const p = await createShipment();
      const deliveredAt = new Date("2026-10-14T12:00:00.000Z");
      await app.db.shipment.update({ where: { id: p.shipmentId }, data: { status: "delivered", deliveredAt } });

      clock = new Date(deliveredAt.getTime() + 23 * 60 * 60 * 1000);
      expect((await send(p.shipmentId, p.carrierId, "Entregado, gracias", randomUUID(), "carrier")).statusCode).toBe(201);

      clock = new Date(deliveredAt.getTime() + 25 * 60 * 60 * 1000);
      const late = await send(p.shipmentId, p.carrierId, "Una cosa más", randomUUID(), "carrier");
      expect(late.statusCode).toBe(409);
      expect(late.json().error.code).toBe("CHAT_CLOSED");
    });

    it("el receptor original (ADR-038) lee pero no escribe: 403 CHAT_READ_ONLY", async () => {
      const p = await createShipment();
      const formerReceiverId = randomUUID();
      await send(p.shipmentId, p.senderId, "Mensaje previo");
      await app.db.receiverTransferRequest.create({
        data: {
          shipmentId: p.shipmentId,
          requestedBy: formerReceiverId,
          newReceiverId: p.receiverId,
          status: "completed",
          newReceiverDeadline: new Date(Date.now() + 3600_000),
          resolvedAt: new Date(),
        },
      });

      const write = await send(p.shipmentId, formerReceiverId, "¿Puedo escribir?");
      expect(write.statusCode).toBe(403);
      expect(write.json().error.code).toBe("CHAT_READ_ONLY");
      const read = await history(p.shipmentId, formerReceiverId);
      expect(read.statusCode).toBe(200);
      expect(read.json().access).toBe("read_only");
      expect(read.json().items).toHaveLength(1);
    });

    it("el admin lee el historial aunque el chat esté cerrado, pero no escribe", async () => {
      const p = await createShipment("assigned");
      await send(p.shipmentId, p.senderId, "Evidencia");
      await repo.updateStatus(p.shipmentId, ShipmentStatus.CANCELLED, p.senderId);
      const adminId = randomUUID();

      const read = await history(p.shipmentId, adminId, "", "admin");
      expect(read.statusCode).toBe(200);
      expect(read.json().access).toBe("read_only");
      expect(read.json().items).toHaveLength(1);
      const write = await send(p.shipmentId, adminId, "Hola", randomUUID(), "admin");
      expect(write.statusCode).toBe(403);
      expect(write.json().error.code).toBe("CHAT_READ_ONLY");
    });
  });

  describe("notificaciones push", () => {
    it("avisa a quien no tiene el chat abierto, sin el texto del mensaje, y una sola vez por ráfaga", async () => {
      const p = await createShipment();
      const carrier = await connectedChat(p.shipmentId, p.carrierId);

      await send(p.shipmentId, p.senderId, "Mi clave de la puerta es 4321");
      await send(p.shipmentId, p.senderId, "Segundo mensaje enseguida");

      // El transportista tiene el chat abierto: solo se avisa al receptor, y una vez.
      await vi.waitFor(() => expect(notifications.sendPush).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(notifications.sendPush).toHaveBeenCalledTimes(1);
      const input = vi.mocked(notifications.sendPush).mock.calls[0][0];
      expect(input).toMatchObject({
        userId: p.receiverId,
        category: "chat",
        data: { type: "chat_message", shipmentId: p.shipmentId },
      });
      expect(`${input.title} ${input.body}`).not.toContain("4321");
      expect(input.title).toContain("Ana Gómez");
      carrier.ws.close();
    });

    it("un fallo de la push no afecta el envío del mensaje", async () => {
      const p = await createShipment();
      vi.mocked(notifications.sendPush).mockRejectedValueOnce(new Error("svc-users caído"));

      const response = await send(p.shipmentId, p.senderId, "Hola");

      expect(response.statusCode).toBe(201);
      await vi.waitFor(() => expect(notifications.sendPush).toHaveBeenCalled());
    });
  });
});
