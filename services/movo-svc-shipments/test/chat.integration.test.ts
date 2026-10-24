import { createChatRepository } from "../src/repositories/chat-repository";
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
  // Reloj del chat: sin fijar corre en tiempo real; los tests de borde de 24 h lo fijan a mano.
  let clock: Date | null = null;
  // Resúmenes de ráfaga agendados (MOVO-301): el test los dispara a mano en vez de esperar la ventana real.
  let scheduledFlushes: Array<() => void> = [];
  let scheduledDelays: number[] = [];
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

  function readChat(shipmentId: string, userId: string, roles = "sender") {
    return app.inject({
      method: "POST",
      url: `/shipments/${shipmentId}/chat/read`,
      headers: { "x-user-id": userId, "x-user-roles": roles },
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
      chatNow: () => clock ?? new Date(),
      chatSchedulePush: (run, delayMs) => {
        scheduledFlushes.push(run);
        scheduledDelays.push(delayMs);
      },
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
    clock = null;
    scheduledFlushes = [];
    scheduledDelays = [];
    blocks.length = 0;
    vi.mocked(notifications.sendPush).mockClear();
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
    const keys = [...(await app.redis.keys("notified:chat-push*")), ...(await app.redis.keys("chat-push-buffer:*"))];
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
      // Cada destinatario recibe su versión: sin los tildes, que son solo del autor.
      expect(chatMessagesOf(carrier)[0]).toEqual({ type: "chat_message", message: { ...response.json(), deliveryStatus: null } });

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

    it("un bloqueo NO impide escribir: a quien tiene el bloqueo le llega el contenido vacío y los demás lo ven normal", async () => {
      const p = await createShipment();
      blocks.push([p.carrierId, p.senderId]); // el transportista bloqueó al emisor
      const carrier = await connectedChat(p.shipmentId, p.carrierId);
      const receiver = await connectedChat(p.shipmentId, p.receiverId);

      const sent = await send(p.shipmentId, p.senderId, "Hola a todos");

      expect(sent.statusCode).toBe(201);
      await vi.waitFor(() => expect(chatMessagesOf(carrier)).toHaveLength(1));
      await vi.waitFor(() => expect(chatMessagesOf(receiver)).toHaveLength(1));
      expect(chatMessagesOf(carrier)[0].message).toMatchObject({ hidden: true, body: "" });
      expect(chatMessagesOf(receiver)[0].message).toMatchObject({ hidden: false, body: "Hola a todos" });
      // El historial aplica lo mismo, y quien bloqueó sigue pudiendo escribir.
      const carrierView = (await history(p.shipmentId, p.carrierId, "", "carrier")).json();
      expect(carrierView.items[0]).toMatchObject({ hidden: true, body: "" });
      const receiverView = (await history(p.shipmentId, p.receiverId)).json();
      expect(receiverView.items[0]).toMatchObject({ hidden: false, body: "Hola a todos" });
      expect((await send(p.shipmentId, p.carrierId, "Sigo acá", randomUUID(), "carrier")).statusCode).toBe(201);
      // El mensaje del bloqueado tampoco dispara una push al transportista.
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(vi.mocked(notifications.sendPush).mock.calls.every(([call]) => call.userId !== p.carrierId)).toBe(true);
      carrier.ws.close();
      receiver.ws.close();
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

    it("entregado: queda en solo lectura (no se escribe), y pasadas las 24 h figura archivado pero sigue legible", async () => {
      const p = await createShipment();
      await send(p.shipmentId, p.carrierId, "Ya te lo dejé", randomUUID(), "carrier");
      const deliveredAt = new Date("2026-10-14T12:00:00.000Z");
      await app.db.shipment.update({ where: { id: p.shipmentId }, data: { status: "delivered", deliveredAt } });

      clock = new Date(deliveredAt.getTime() + 23 * 60 * 60 * 1000);
      const early = await send(p.shipmentId, p.carrierId, "Una cosa más", randomUUID(), "carrier");
      expect(early.statusCode).toBe(403);
      expect(early.json().error.code).toBe("CHAT_READ_ONLY");
      const recent = (await history(p.shipmentId, p.senderId)).json();
      expect(recent).toMatchObject({ access: "read_only", archived: false });

      clock = new Date(deliveredAt.getTime() + 25 * 60 * 60 * 1000);
      const archived = await history(p.shipmentId, p.senderId);
      expect(archived.statusCode).toBe(200);
      expect(archived.json()).toMatchObject({ access: "read_only", archived: true });
      expect(archived.json().items).toHaveLength(1);
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
    it("avisa a quien no tiene el chat abierto, con el nombre, el rol y el texto del mensaje", async () => {
      const p = await createShipment();
      const carrier = await connectedChat(p.shipmentId, p.carrierId);

      await send(p.shipmentId, p.senderId, "Ya estoy en la puerta");

      // El transportista tiene el chat abierto: solo se avisa al receptor.
      await vi.waitFor(() => expect(notifications.sendPush).toHaveBeenCalledTimes(1));
      const input = vi.mocked(notifications.sendPush).mock.calls[0][0];
      expect(input).toMatchObject({
        userId: p.receiverId,
        category: "chat",
        data: { type: "chat_message", shipmentId: p.shipmentId },
      });
      expect(input.title).toBe("Ana · Emisor");
      expect(input.body).toBe("Ya estoy en la puerta");
      carrier.ws.close();
    });

    // El tiempo se simula borrando la marca de ventana (vence sola a los 30 s) y disparando el resumen agendado.
    const expirePushWindows = async () => {
      const keys = await app.redis.keys("notified:chat-push:*");
      if (keys.length > 0) await app.redis.del(...keys);
    };
    const toUser = (userId: string) => vi.mocked(notifications.sendPush).mock.calls.filter(([c]) => c.userId === userId);

    it("una ráfaga avisa enseguida el primero y después un único resumen con la cantidad y el último mensaje", async () => {
      const p = await createShipment();

      await send(p.shipmentId, p.senderId, "Primero");
      await send(p.shipmentId, p.senderId, "Segundo");
      await send(p.shipmentId, p.senderId, "Tercero");
      // Sin nadie conectado se avisa al transportista y al receptor: un resumen agendado por cada uno, una sola vez.
      await vi.waitFor(() => expect(scheduledFlushes).toHaveLength(2));

      // Dentro de la ventana solo salió la del primer mensaje, y el resumen se agenda para cuando ella cierra
      // (lo que le queda de vida, no otros 30 s desde el segundo mensaje).
      expect(toUser(p.receiverId)).toHaveLength(1);
      expect(toUser(p.receiverId)[0][0].body).toBe("Primero");
      expect(scheduledDelays.every((ms) => ms > 0 && ms <= 30_000)).toBe(true);

      await expirePushWindows();
      scheduledFlushes.forEach((run) => run());
      await vi.waitFor(() => expect(toUser(p.receiverId)).toHaveLength(2));
      expect(toUser(p.receiverId)[1][0].body).toBe("2 mensajes nuevos · Tercero");
    });

    it("los mensajes de una ráfaga larga salen en orden y ninguno queda sin avisar", async () => {
      const p = await createShipment();

      await send(p.shipmentId, p.senderId, "m1"); // t=0: push, abre la ventana
      await send(p.shipmentId, p.senderId, "m2"); // dentro de la ventana: cola + resumen agendado
      await vi.waitFor(() => expect(scheduledFlushes).toHaveLength(2));
      await expirePushWindows(); // t=30
      scheduledFlushes.splice(0).forEach((run) => run());
      await vi.waitFor(() => expect(toUser(p.receiverId)).toHaveLength(2)); // resumen de m2, abre ventana nueva

      await send(p.shipmentId, p.senderId, "m3"); // ventana tomada por el resumen: cola, no push inmediato
      await vi.waitFor(() => expect(scheduledFlushes.length).toBeGreaterThan(0));
      expect(toUser(p.receiverId)).toHaveLength(2);

      await expirePushWindows();
      scheduledFlushes.splice(0).forEach((run) => run());
      await vi.waitFor(() => expect(toUser(p.receiverId)).toHaveLength(3));
      expect(toUser(p.receiverId).map(([c]) => c.body)).toEqual(["m1", "m2", "m3"]);
    });

    it("si otro mensaje abrió la ventana justo antes del resumen, el resumen espera a que cierre en vez de salir antes", async () => {
      const p = await createShipment();

      await send(p.shipmentId, p.senderId, "Primero");
      await send(p.shipmentId, p.senderId, "Segundo");
      await vi.waitFor(() => expect(scheduledFlushes).toHaveLength(2));

      // La ventana sigue tomada: el resumen se reagenda y no manda nada todavía.
      const before = toUser(p.receiverId).length;
      scheduledFlushes.splice(0).forEach((run) => run());
      await vi.waitFor(() => expect(scheduledFlushes.length).toBeGreaterThan(0));
      expect(toUser(p.receiverId)).toHaveLength(before);
    });

    it("si el destinatario ya leyó la conversación antes de que cierre la ventana, no se manda el resumen", async () => {
      const p = await createShipment();

      await send(p.shipmentId, p.senderId, "Primero");
      await send(p.shipmentId, p.senderId, "Segundo");
      await vi.waitFor(() => expect(scheduledFlushes).toHaveLength(2));
      await readChat(p.shipmentId, p.receiverId, "receiver");

      const before = toUser(p.receiverId).length;
      await expirePushWindows();
      scheduledFlushes.forEach((run) => run());
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(toUser(p.receiverId)).toHaveLength(before);
    });

    it("si el destinatario bloquea al autor mientras el mensaje esperaba en la cola, el resumen no lo muestra (ADR-026)", async () => {
      const p = await createShipment();

      await send(p.shipmentId, p.senderId, "Primero");
      await send(p.shipmentId, p.senderId, "Segundo");
      await vi.waitFor(() => expect(scheduledFlushes).toHaveLength(2));
      blocks.push([p.receiverId, p.senderId]); // el receptor bloquea al emisor dentro de la ventana

      const before = toUser(p.receiverId).length;
      await expirePushWindows();
      scheduledFlushes.forEach((run) => run());
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(toUser(p.receiverId)).toHaveLength(before);
    });

    it("el texto largo se corta en la push", async () => {
      const p = await createShipment();

      await send(p.shipmentId, p.senderId, "a".repeat(600));

      await vi.waitFor(() => expect(notifications.sendPush).toHaveBeenCalled());
      const body = vi.mocked(notifications.sendPush).mock.calls[0][0].body;
      expect(body.length).toBeLessThanOrEqual(140);
      expect(body.endsWith("…")).toBe(true);
    });

    it("un fallo de la push no afecta el envío del mensaje", async () => {
      const p = await createShipment();
      vi.mocked(notifications.sendPush).mockRejectedValueOnce(new Error("svc-users caído"));

      const response = await send(p.shipmentId, p.senderId, "Hola");

      expect(response.statusCode).toBe(201);
      await vi.waitFor(() => expect(notifications.sendPush).toHaveBeenCalled());
    });
  });

  describe("tildes de entregado y leído", () => {
    it("pasa de enviado a entregado cuando todos lo recibieron y a leído cuando todos lo leyeron, con avisos en vivo", async () => {
      const p = await createShipment();
      const sender = await connectedChat(p.shipmentId, p.senderId);
      const carrier = await connectedChat(p.shipmentId, p.carrierId);

      // El receptor no está conectado: el transportista lo recibió pero falta uno.
      const sent = await send(p.shipmentId, p.senderId, "¿Todo bien?");
      expect(sent.json().deliveryStatus).toBe("sent");
      await vi.waitFor(() =>
        expect(sender.messages).toContainEqual(expect.objectContaining({ type: "chat_receipt", userId: p.carrierId, status: "delivered" }))
      );

      // El receptor abre el chat: lo recibe, y el emisor se entera en vivo.
      const receiverView = (await history(p.shipmentId, p.receiverId)).json();
      expect(receiverView.items[0].deliveryStatus).toBeNull();
      await vi.waitFor(() =>
        expect(sender.messages).toContainEqual(expect.objectContaining({ type: "chat_receipt", userId: p.receiverId, status: "delivered" }))
      );
      expect((await history(p.shipmentId, p.senderId)).json().items[0].deliveryStatus).toBe("delivered");

      // Lo leen los dos: "leído por todos".
      expect((await readChat(p.shipmentId, p.carrierId, "carrier")).statusCode).toBe(200);
      expect((await history(p.shipmentId, p.senderId)).json().items[0].deliveryStatus).toBe("delivered");
      expect((await readChat(p.shipmentId, p.receiverId)).statusCode).toBe(200);
      await vi.waitFor(() =>
        expect(sender.messages).toContainEqual(expect.objectContaining({ type: "chat_receipt", userId: p.receiverId, status: "read" }))
      );
      expect((await history(p.shipmentId, p.senderId)).json().items[0].deliveryStatus).toBe("read");
      sender.ws.close();
      carrier.ws.close();
    });

    it("conectarse al WebSocket cuenta como recibir lo pendiente", async () => {
      const p = await createShipment();
      const sender = await connectedChat(p.shipmentId, p.senderId);
      await send(p.shipmentId, p.senderId, "Hola");

      const receiver = await connectedChat(p.shipmentId, p.receiverId);
      const carrier = await connectedChat(p.shipmentId, p.carrierId);

      await vi.waitFor(() =>
        expect(sender.messages.filter((m) => m.type === "chat_receipt" && m.status === "delivered").map((m) => m.userId)).toEqual(
          expect.arrayContaining([p.receiverId, p.carrierId])
        )
      );
      expect((await history(p.shipmentId, p.senderId)).json().items[0].deliveryStatus).toBe("delivered");
      sender.ws.close();
      receiver.ws.close();
      carrier.ws.close();
    });

    it("quien tiene un bloqueo con el autor no cuenta para los tildes", async () => {
      const p = await createShipment();
      blocks.push([p.receiverId, p.senderId]); // el receptor bloqueó al emisor
      await send(p.shipmentId, p.senderId, "Hola");
      await readChat(p.shipmentId, p.carrierId, "carrier");

      // Solo el transportista cuenta: leyó, así que está leído aunque el receptor nunca lo vea.
      expect((await history(p.shipmentId, p.senderId)).json().items[0].deliveryStatus).toBe("read");
    });

    it("quien solo mira (el receptor original) también baja su contador, sin mover los tildes de los demás", async () => {
      const p = await createShipment();
      const formerReceiverId = randomUUID();
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
      await send(p.shipmentId, p.senderId, "Hola");
      const list = (userId: string) =>
        app.inject({ method: "GET", url: "/shipments/chats", headers: { "x-user-id": userId, "x-user-roles": "sender" } });
      expect((await list(formerReceiverId)).json().items[0].unreadCount).toBe(1);

      const read = await readChat(p.shipmentId, formerReceiverId);
      expect(read.statusCode).toBe(200);
      expect((await list(formerReceiverId)).json().items[0].unreadCount).toBe(0);
      // No cuenta como lectura de una parte: el emisor sigue sin ver "leído".
      expect((await history(p.shipmentId, p.senderId)).json().items[0].deliveryStatus).not.toBe("read");
    });

    it("un tercero ajeno no marca leído (403) y un envío cerrado da 409", async () => {
      const p = await createShipment("assigned");
      expect((await readChat(p.shipmentId, randomUUID())).statusCode).toBe(403);
      await repo.updateStatus(p.shipmentId, ShipmentStatus.CANCELLED, p.senderId);
      expect((await readChat(p.shipmentId, p.senderId)).statusCode).toBe(409);
    });
  });

  describe("correcciones de review", () => {
    it("un transportista anterior con el socket vivo no recibe la conversación de la nueva asignación", async () => {
      const p = await createShipment();
      const formerCarrier = await connectedChat(p.shipmentId, p.carrierId);
      // Se reasigna sin cambio de estado (el socket sigue abierto): otro transportista y conversación limpia.
      const newCarrierId = randomUUID();
      await app.db.shipment.update({ where: { id: p.shipmentId }, data: { carrierId: newCarrierId, chatStartedAt: new Date() } });

      expect((await send(p.shipmentId, p.senderId, "Hola, ¿cómo va?")).statusCode).toBe(201);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(chatMessagesOf(formerCarrier)).toHaveLength(0);
      formerCarrier.ws.close();
    });

    it("la lista no deja afuera un chat con actividad real por mensajes de una asignación anterior", async () => {
      const reassigned = await createShipment();
      const active = await createShipment();
      await app.db.shipment.update({ where: { id: active.shipmentId }, data: { senderId: reassigned.senderId } });
      // El mensaje de la asignación anterior es el más reciente de todos, pero queda antes del corte del hilo.
      await send(reassigned.shipmentId, reassigned.senderId, "Mensaje de la asignación anterior");
      await app.db.shipment.update({ where: { id: reassigned.shipmentId }, data: { chatStartedAt: new Date(Date.now() + 60_000) } });

      const rows = await createChatRepository(app.db).listShipmentsForUser(reassigned.senderId, [ShipmentStatus.IN_TRANSIT], 1);
      expect(rows.map((r) => r.id)).toEqual([active.shipmentId]);
    });

    it("un reintento de un mensaje ya guardado devuelve 200 aunque el chat haya pasado a solo lectura o cerrado", async () => {
      const p = await createShipment();
      const clientMessageId = randomUUID();
      const first = await send(p.shipmentId, p.carrierId, "Ya llegué", clientMessageId, "carrier");
      expect(first.statusCode).toBe(201);

      await app.db.shipment.update({ where: { id: p.shipmentId }, data: { status: "delivered", deliveredAt: new Date() } });
      const afterDelivery = await send(p.shipmentId, p.carrierId, "Ya llegué", clientMessageId, "carrier");
      expect(afterDelivery.statusCode).toBe(200);
      expect(afterDelivery.json().id).toBe(first.json().id);
      // Un mensaje NUEVO sigue sin poder enviarse.
      expect((await send(p.shipmentId, p.carrierId, "Otro", randomUUID(), "carrier")).statusCode).toBe(403);

      await app.db.shipment.update({ where: { id: p.shipmentId }, data: { status: "cancelled" } });
      const afterCancel = await send(p.shipmentId, p.carrierId, "Ya llegué", clientMessageId, "carrier");
      expect(afterCancel.statusCode).toBe(200);
      expect(afterCancel.json().id).toBe(first.json().id);
    });

    it("el receptor original y el admin conectados reciben los mensajes nuevos en vivo", async () => {
      const p = await createShipment();
      const formerReceiverId = randomUUID();
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
      const former = await connectedChat(p.shipmentId, formerReceiverId);
      const adminId = randomUUID();
      const admin = connectChat(p.shipmentId, token(adminId, [UserRole.ADMIN]));
      await vi.waitFor(() => expect(admin.messages).toContainEqual({ type: "connected", shipmentId: p.shipmentId }));

      await send(p.shipmentId, p.senderId, "Mensaje en vivo");

      await vi.waitFor(() => expect(chatMessagesOf(former)).toHaveLength(1));
      await vi.waitFor(() => expect(chatMessagesOf(admin)).toHaveLength(1));
      former.ws.close();
      admin.ws.close();
    });

    it("un socket que se cierra mientras se autoriza no queda registrado como conectado", async () => {
      const p = await createShipment();
      const client = connectChat(p.shipmentId, token(p.senderId));
      client.ws.on("error", () => undefined);
      // Se corta apenas se abre el socket: el servidor todavía está autorizando (consulta a la base).
      await new Promise((resolve) => client.ws.once("open", resolve));
      client.ws.terminate();
      await client.closed;
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(app.chatHub.isUserConnected(p.shipmentId, p.senderId)).toBe(false);
      expect(app.chatHub.activeConnections(p.shipmentId)).toBe(0);
    });

    it("un cursor que no tiene un uuid válido da 400 y no 500", async () => {
      const p = await createShipment();
      await send(p.shipmentId, p.senderId, "Hola");
      const cursor = Buffer.from("2026-01-01T00:00:00.000Z|abc").toString("base64");

      const response = await history(p.shipmentId, p.senderId, `?cursor=${encodeURIComponent(cursor)}`);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_FAILED");
    });

    it("la lista no deja afuera un chat activo de un envío viejo aunque haya más de 50 envíos", async () => {
      const carrierId = randomUUID();
      const shipments: Parties[] = [];
      for (let i = 0; i < 52; i++) {
        const p = await createShipment();
        await app.db.shipment.update({ where: { id: p.shipmentId }, data: { carrierId } });
        shipments.push({ ...p, carrierId });
      }
      // El primero que se creó (el más viejo por estado) recibe un mensaje: es el de actividad más reciente.
      const oldest = shipments[0];
      await send(oldest.shipmentId, oldest.senderId, "Seguimos hablando");

      const response = await app.inject({
        method: "GET",
        url: "/shipments/chats",
        headers: { "x-user-id": carrierId, "x-user-roles": "carrier" },
      });
      const items = response.json().items as Array<{ shipmentId: string }>;
      expect(items).toHaveLength(50);
      expect(items[0].shipmentId).toBe(oldest.shipmentId);
    }, 120_000);
  });

  describe("nueva asignación del envío", () => {
    /** Simula una reasignación: el envío vuelve a asignarse y `chatStartedAt` pasa a "ahora". */
    async function startNewAssignment(shipmentId: string): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 15));
      await app.db.shipment.update({ where: { id: shipmentId }, data: { chatStartedAt: new Date() } });
      await new Promise((resolve) => setTimeout(resolve, 15));
    }

    it("el historial no trae lo hablado antes de la asignación, y el admin sí lo ve todo", async () => {
      const p = await createShipment();
      await send(p.shipmentId, p.senderId, "Con el transportista anterior");
      await startNewAssignment(p.shipmentId);
      await send(p.shipmentId, p.senderId, "Con el transportista nuevo");

      const items = (await history(p.shipmentId, p.carrierId, "", "carrier")).json().items;
      expect(items.map((m: { body: string }) => m.body)).toEqual(["Con el transportista nuevo"]);
      expect((await history(p.shipmentId, p.senderId)).json().items).toHaveLength(1);

      const adminView = (await history(p.shipmentId, randomUUID(), "", "admin")).json().items;
      expect(adminView.map((m: { body: string }) => m.body)).toEqual(["Con el transportista nuevo", "Con el transportista anterior"]);
    });

    it("la lista ignora los mensajes anteriores: sin último mensaje y sin no leídos", async () => {
      const p = await createShipment();
      await send(p.shipmentId, p.carrierId, "Mensaje de la asignación anterior", randomUUID(), "carrier");
      const list = () =>
        app.inject({ method: "GET", url: "/shipments/chats", headers: { "x-user-id": p.senderId, "x-user-roles": "sender" } });
      expect((await list()).json().items[0]).toMatchObject({ unreadCount: 1, lastMessage: { body: "Mensaje de la asignación anterior" } });

      await startNewAssignment(p.shipmentId);

      expect((await list()).json().items[0]).toMatchObject({ unreadCount: 0, lastMessage: null });
    });

    it("un envío sin corte (anterior a este cambio) sigue mostrando todo", async () => {
      const p = await createShipment();
      await send(p.shipmentId, p.senderId, "Uno");
      await send(p.shipmentId, p.senderId, "Dos");

      expect((await history(p.shipmentId, p.carrierId, "", "carrier")).json().items).toHaveLength(2);
    });
  });

  describe("integrantes del chat", () => {
    it("devuelve emisor, transportista y receptor con nombre, foto y rol", async () => {
      const p = await createShipment();
      const response = await app.inject({
        method: "GET",
        url: `/shipments/${p.shipmentId}/chat/participants`,
        headers: { "x-user-id": p.receiverId, "x-user-roles": "sender" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().participants.map((x: { role: string; userId: string }) => [x.role, x.userId])).toEqual([
        ["sender", p.senderId],
        ["carrier", p.carrierId],
        ["receiver", p.receiverId],
      ]);
      expect(response.json().participants[0]).toMatchObject({ firstName: "Ana", fullName: "Ana Gómez", photoUrl: null });
    });

    it("un tercero ajeno no los ve (403)", async () => {
      const p = await createShipment();
      const response = await app.inject({
        method: "GET",
        url: `/shipments/${p.shipmentId}/chat/participants`,
        headers: { "x-user-id": randomUUID(), "x-user-roles": "sender" },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe("reportar conversación", () => {
    it("registra un reporte por persona, idempotente, y el historial lo refleja solo para quien reportó", async () => {
      const p = await createShipment();
      const report = () =>
        app.inject({
          method: "POST",
          url: `/shipments/${p.shipmentId}/chat/report`,
          headers: { "x-user-id": p.receiverId, "x-user-roles": "sender" },
        });

      expect((await history(p.shipmentId, p.receiverId)).json().reportedByMe).toBe(false);
      const first = await report();
      const second = await report();

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(200);
      expect(first.json()).toEqual({ reported: true });
      expect(await app.db.chatReport.count({ where: { shipmentId: p.shipmentId } })).toBe(1);
      expect((await history(p.shipmentId, p.receiverId)).json().reportedByMe).toBe(true);
      expect((await history(p.shipmentId, p.senderId)).json().reportedByMe).toBe(false);
    });

    it("un tercero ajeno no puede reportar (403)", async () => {
      const p = await createShipment();
      const response = await app.inject({
        method: "POST",
        url: `/shipments/${p.shipmentId}/chat/report`,
        headers: { "x-user-id": randomUUID(), "x-user-roles": "sender" },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe("lista de chats", () => {
    const list = (userId: string, roles = "sender") =>
      app.inject({ method: "GET", url: "/shipments/chats", headers: { "x-user-id": userId, "x-user-roles": roles } });

    it("trae un chat por envío con ruta, último mensaje y no leídos, y los baja al leer", async () => {
      const p = await createShipment();
      await send(p.shipmentId, p.carrierId, "Ya retiré el paquete", randomUUID(), "carrier");
      await send(p.shipmentId, p.carrierId, "Salgo ahora", randomUUID(), "carrier");

      const forSender = (await list(p.senderId)).json().items;
      expect(forSender).toHaveLength(1);
      expect(forSender[0]).toMatchObject({
        shipmentId: p.shipmentId,
        status: "in_transit",
        route: "Av. Colón 1234 → Bv. San Juan 500",
        access: "open",
        archived: false,
        unreadCount: 2,
        lastMessage: { authorId: p.carrierId, authorName: "Ana", body: "Salgo ahora", hidden: false },
      });
      // Lo propio no cuenta como no leído.
      expect((await list(p.carrierId, "carrier")).json().items[0].unreadCount).toBe(0);

      await readChat(p.shipmentId, p.senderId);
      expect((await list(p.senderId)).json().items[0].unreadCount).toBe(0);
      expect((await list(p.receiverId)).json().items[0].unreadCount).toBe(2);
    });

    it("cada chat trae a sus integrantes (emisor, transportista, receptor) para los avatares", async () => {
      const p = await createShipment();

      const item = (await list(p.senderId)).json().items[0];

      expect(item.participants.map((x: { role: string; userId: string }) => [x.role, x.userId])).toEqual([
        ["sender", p.senderId],
        ["carrier", p.carrierId],
        ["receiver", p.receiverId],
      ]);
      expect(item.participants[0]).toMatchObject({ firstName: "Ana", fullName: "Ana Gómez", photoUrl: null });
    });

    it("el último mensaje de alguien bloqueado llega oculto y no suma a los no leídos", async () => {
      const p = await createShipment();
      blocks.push([p.senderId, p.carrierId]); // el emisor bloqueó al transportista
      await send(p.shipmentId, p.carrierId, "Mensaje que no debería ver", randomUUID(), "carrier");

      const item = (await list(p.senderId)).json().items[0];
      expect(item.lastMessage).toMatchObject({ hidden: true, body: "" });
      expect(item.unreadCount).toBe(0);
    });

    it("incluye los entregados (atenuados, archivados pasadas las 24 h) y deja afuera cancelados y envíos sin transportista", async () => {
      const delivered = await createShipment();
      const deliveredAt = new Date("2026-10-10T12:00:00.000Z");
      await app.db.shipment.update({ where: { id: delivered.shipmentId }, data: { status: "delivered", deliveredAt } });
      clock = new Date("2026-10-14T12:00:00.000Z");
      const cancelled = await createShipment("assigned");
      await repo.updateStatus(cancelled.shipmentId, ShipmentStatus.CANCELLED, cancelled.senderId);

      const forDelivered = (await list(delivered.senderId)).json().items;
      expect(forDelivered).toHaveLength(1);
      expect(forDelivered[0]).toMatchObject({ shipmentId: delivered.shipmentId, access: "read_only", archived: true });
      expect((await list(cancelled.senderId)).json().items).toHaveLength(0);
      expect((await list(randomUUID())).json().items).toHaveLength(0);
    });

    it("ordena por la actividad más reciente primero", async () => {
      const older = await createShipment();
      const newer = await createShipment();
      await send(older.shipmentId, older.carrierId, "Primero", randomUUID(), "carrier");
      await new Promise((resolve) => setTimeout(resolve, 20));
      await send(newer.shipmentId, newer.carrierId, "Segundo", randomUUID(), "carrier");

      const forCarrier = async (carrierId: string) => (await list(carrierId, "carrier")).json().items.map((i: { shipmentId: string }) => i.shipmentId);
      expect(await forCarrier(older.carrierId)).toEqual([older.shipmentId]);
      expect(await forCarrier(newer.carrierId)).toEqual([newer.shipmentId]);
    });
  });

  describe("MOVO-340: transferencia de receptor completada", () => {
    const listChats = (userId: string) =>
      app.inject({ method: "GET", url: "/shipments/chats", headers: { "x-user-id": userId, "x-user-roles": "sender" } });
    const participants = (shipmentId: string, userId: string) =>
      app.inject({ method: "GET", url: `/shipments/${shipmentId}/chat/participants`, headers: { "x-user-id": userId, "x-user-roles": "sender" } });

    /** Transferencia real por la API: la pide el receptor y la acepta la persona invitada. */
    async function transferReceiver(p: Parties, newReceiverId: string): Promise<void> {
      const requested = await app.inject({
        method: "POST",
        url: `/shipments/${p.shipmentId}/receiver-transfer`,
        headers: { "x-user-id": p.receiverId },
        payload: { newReceiverId },
      });
      expect(requested.statusCode).toBe(201);
      const accepted = await app.inject({
        method: "POST",
        url: `/receiver-transfers/${requested.json().id}/accept`,
        headers: { "x-user-id": newReceiverId },
      });
      expect(accepted.statusCode).toBe(200);
    }

    it("el receptor nuevo entra al chat en el acto y el original queda en solo lectura, con el chat abierto por todos", async () => {
      const p = await createShipment();
      const newReceiverId = randomUUID();
      await send(p.shipmentId, p.senderId, "Dejalo en portería");
      const sender = await connectedChat(p.shipmentId, p.senderId);
      const carrier = await connectedChat(p.shipmentId, p.carrierId);
      const formerReceiver = await connectedChat(p.shipmentId, p.receiverId);

      await transferReceiver(p, newReceiverId);

      // Cada socket abierto se entera del cambio sin cerrarse.
      for (const client of [sender, carrier, formerReceiver]) {
        await vi.waitFor(() =>
          expect(client.messages).toContainEqual({ type: "chat_participants_changed", shipmentId: p.shipmentId })
        );
        expect(client.ws.readyState).toBe(WebSocket.OPEN);
      }

      const members = (await participants(p.shipmentId, p.senderId)).json().participants as Array<{ role: string; userId: string }>;
      expect(members.map((m) => [m.role, m.userId])).toEqual([
        ["sender", p.senderId],
        ["carrier", p.carrierId],
        ["receiver", newReceiverId],
      ]);
      expect((await listChats(newReceiverId)).json().items.map((i: { shipmentId: string }) => i.shipmentId)).toEqual([
        p.shipmentId,
      ]);

      // El nuevo lee el historial (ADR-038) y escribe; el original lee pero ya no escribe.
      const newHistory = await history(p.shipmentId, newReceiverId);
      expect(newHistory.json()).toMatchObject({ access: "open" });
      expect(newHistory.json().items).toHaveLength(1);
      expect((await send(p.shipmentId, newReceiverId, "Hola, ahora lo recibo yo")).statusCode).toBe(201);
      const formerWrite = await send(p.shipmentId, p.receiverId, "¿Sigo?");
      expect(formerWrite.statusCode).toBe(403);
      expect(formerWrite.json().error.code).toBe("CHAT_READ_ONLY");
      // El original sigue mirando por su socket abierto.
      await vi.waitFor(() =>
        expect(chatMessagesOf(formerReceiver).map((m) => (m.message as { body: string }).body)).toContain(
          "Hola, ahora lo recibo yo"
        )
      );

      sender.ws.close();
      carrier.ws.close();
      formerReceiver.ws.close();
    });

    it("los tildes de un mensaje previo no retroceden y al nuevo solo le cuentan los mensajes posteriores", async () => {
      const p = await createShipment();
      const newReceiverId = randomUUID();
      await send(p.shipmentId, p.senderId, "Antes de la transferencia");
      await readChat(p.shipmentId, p.carrierId, "carrier");
      await readChat(p.shipmentId, p.receiverId);
      const before = (await history(p.shipmentId, p.senderId)).json().items[0];
      expect(before.deliveryStatus).toBe("read");

      await transferReceiver(p, newReceiverId);

      expect((await history(p.shipmentId, p.senderId)).json().items[0].deliveryStatus).toBe("read");
      expect((await listChats(newReceiverId)).json().items[0].unreadCount).toBe(0);

      await send(p.shipmentId, p.senderId, "Después de la transferencia");
      expect((await listChats(newReceiverId)).json().items[0].unreadCount).toBe(1);
      // El mensaje nuevo se mide contra el receptor nuevo, que todavía no lo leyó.
      const after = (await history(p.shipmentId, p.senderId)).json().items[0];
      expect(after.body).toBe("Después de la transferencia");
      expect(after.deliveryStatus).not.toBe("read");
      await readChat(p.shipmentId, p.carrierId, "carrier");
      await readChat(p.shipmentId, newReceiverId);
      expect((await history(p.shipmentId, p.senderId)).json().items[0].deliveryStatus).toBe("read");
    });

    it("la push de chat le llega al receptor nuevo y deja de llegarle al original", async () => {
      const p = await createShipment();
      const newReceiverId = randomUUID();
      await transferReceiver(p, newReceiverId);
      vi.mocked(notifications.sendPush).mockClear();

      await send(p.shipmentId, p.senderId, "¿Estás en casa?");
      for (const flush of scheduledFlushes) flush();

      await vi.waitFor(() => {
        const chatPushTo = (userId: string) =>
          vi
            .mocked(notifications.sendPush)
            .mock.calls.filter(([input]) => input.userId === userId && input.data?.type === "chat_message");
        expect(chatPushTo(newReceiverId).length).toBeGreaterThan(0);
        expect(chatPushTo(p.receiverId)).toHaveLength(0);
      });
    });
  });
});
