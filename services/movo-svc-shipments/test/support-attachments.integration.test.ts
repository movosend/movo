import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { signAccessToken, UserRole, KycStatus, SUPPORT_ATTACHMENT_MAX_BYTES } from "@movo/shared";
import { buildApp } from "../src/app";
import { createMockStorageProvider, MockStorageProvider } from "../src/adapters/mock-storage-provider";
import { createSupportRepository, SupportRepository } from "../src/repositories/support-repository";
import { createSupportAttachmentRepository } from "../src/repositories/support-attachment-repository";
import { buildSupportService } from "../src/modules/support/support.routes";
import { createSupportAttachmentsService } from "../src/modules/support/support-attachments.service";
import { sweepSupportAttachments } from "../src/plugins/support-attachment-sweep";
import { createFakeNotificationsClient } from "./fake-notifications-client";

/**
 * MOVO-321: adjuntos de imágenes en soporte. Postgres y Redis reales, storage mock: `__simulateUpload` hace de
 * `PUT` del cliente a la presigned URL. Lo que va a hacer el lado del agente (MOVO-322) se simula con el servicio de
 * adjuntos (`uploaderKind: "staff"`), `appendStaffMessage` y `publishStaffMessage`.
 */
describe("Adjuntos de soporte (MOVO-321)", () => {
  let app: FastifyInstance;
  let storage: MockStorageProvider;
  let supportRepo: SupportRepository;
  let staffService: ReturnType<typeof buildSupportService>;
  let baseUrl: string;
  const notifications = createFakeNotificationsClient();

  const headers = (userId: string) => ({ "x-user-id": userId, "x-user-roles": "sender" });
  const token = (sub: string) => signAccessToken({ sub, roles: [UserRole.SENDER], kycStatus: KycStatus.NOT_STARTED });

  function presign(userId: string, payload: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/support/attachments", headers: headers(userId), payload });
  }

  /** Pide la URL y "sube" el objeto como lo haría la app. Devuelve el id. */
  async function upload(
    userId: string,
    opts: { conversationId?: string; contentType?: string; sizeBytes?: number; width?: number; height?: number } = {}
  ): Promise<string> {
    const contentType = opts.contentType ?? "image/jpeg";
    const sizeBytes = opts.sizeBytes ?? 300_000;
    const response = await presign(userId, {
      contentType,
      sizeBytes,
      ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
      ...(opts.width ? { width: opts.width } : {}),
      ...(opts.height ? { height: opts.height } : {}),
    });
    expect(response.statusCode).toBe(201);
    const { attachmentId } = response.json();
    const row = await app.db.supportAttachment.findUniqueOrThrow({ where: { id: attachmentId } });
    storage.__simulateUpload(row.s3Key, { contentType, contentLength: sizeBytes });
    return attachmentId;
  }

  function open(userId: string, payload: Record<string, unknown> = {}) {
    return app.inject({
      method: "POST",
      url: "/support/conversations",
      headers: headers(userId),
      payload: { topic: "account", body: "No puedo entrar", clientMessageId: randomUUID(), ...payload },
    });
  }

  async function openConversation(userId: string): Promise<string> {
    const response = await open(userId);
    expect(response.statusCode).toBe(201);
    return response.json().conversation.id;
  }

  function write(userId: string, conversationId: string, payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: `/support/conversations/${conversationId}/messages`,
      headers: headers(userId),
      payload: { body: "", clientMessageId: randomUUID(), ...payload },
    });
  }

  const history = (userId: string, conversationId: string) =>
    app.inject({ method: "GET", url: `/support/conversations/${conversationId}/messages`, headers: headers(userId) });

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    storage = createMockStorageProvider();
    app = buildApp({
      notificationsClient: notifications,
      storageProvider: storage,
      supportSchedulePush: () => undefined,
      sweepEnabled: false,
      supportAttachmentSweepEnabled: false,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("El servidor de test no devolvió una dirección TCP");
    baseUrl = `ws://127.0.0.1:${address.port}`;
    supportRepo = createSupportRepository(app.db);
    staffService = buildSupportService(app, { notificationsClient: notifications, storageProvider: storage });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    vi.mocked(notifications.sendPush).mockClear();
    await app.db.$executeRawUnsafe(
      "TRUNCATE TABLE shipments.support_attachments, shipments.support_conversations RESTART IDENTITY CASCADE"
    );
    const keys = await app.redis.keys("notified:support-push*");
    if (keys.length > 0) await app.redis.del(...keys);
  });

  describe("pedir la URL de subida", () => {
    it("devuelve attachmentId, uploadUrl y expiresAt, con la key en el prefijo privado de la consulta", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);

      const response = await presign(userId, { contentType: "image/png", sizeBytes: 1000, conversationId });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toEqual({ attachmentId: expect.any(String), uploadUrl: expect.any(String), expiresAt: expect.any(String) });
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
      const row = await app.db.supportAttachment.findUniqueOrThrow({ where: { id: body.attachmentId } });
      expect(row.s3Key).toBe(`support/${conversationId}/${body.attachmentId}.png`);
      expect(row.s3Key).not.toMatch(/^profile-photos\//);
      expect(row.messageId).toBeNull();
    });

    it("sin conversación va al prefijo privado pending del usuario", async () => {
      const userId = randomUUID();
      const response = await presign(userId, { contentType: "image/webp", sizeBytes: 1000 });
      const row = await app.db.supportAttachment.findUniqueOrThrow({ where: { id: response.json().attachmentId } });
      expect(row.s3Key).toBe(`support/pending/${userId}/${row.id}.webp`);
      expect(row.conversationId).toBeNull();
    });

    it("tipo no permitido o tamaño fuera de rango responden 422 SUPPORT_ATTACHMENT_INVALID y no crean nada", async () => {
      const userId = randomUUID();
      for (const payload of [
        { contentType: "application/pdf", sizeBytes: 1000 },
        { contentType: "image/gif", sizeBytes: 1000 },
        { contentType: "image/jpeg", sizeBytes: SUPPORT_ATTACHMENT_MAX_BYTES + 1 },
        { contentType: "image/jpeg", sizeBytes: 0 },
      ]) {
        const response = await presign(userId, payload);
        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe("SUPPORT_ATTACHMENT_INVALID");
      }
      expect(await app.db.supportAttachment.count()).toBe(0);
    });

    it("5 MB justos se aceptan", async () => {
      const response = await presign(randomUUID(), { contentType: "image/jpeg", sizeBytes: SUPPORT_ATTACHMENT_MAX_BYTES });
      expect(response.statusCode).toBe(201);
    });

    it("sobre una consulta ajena o inexistente responde 404", async () => {
      const owner = randomUUID();
      const conversationId = await openConversation(owner);
      expect((await presign(randomUUID(), { contentType: "image/jpeg", sizeBytes: 1000, conversationId })).statusCode).toBe(404);
      expect(
        (await presign(owner, { contentType: "image/jpeg", sizeBytes: 1000, conversationId: randomUUID() })).statusCode
      ).toBe(404);
    });
  });

  describe("asociar a un mensaje", () => {
    it("un mensaje solo con imágenes (cuerpo vacío) se acepta y las devuelve en orden, con URL firmada", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);
      const first = await upload(userId, { conversationId, width: 1600, height: 1200 });
      const second = await upload(userId, { conversationId, contentType: "image/png" });

      const response = await write(userId, conversationId, { attachmentIds: [second, first] });

      expect(response.statusCode).toBe(201);
      const message = response.json();
      expect(message.body).toBe("");
      expect(message.attachments).toEqual([
        { id: second, contentType: "image/png", url: expect.stringContaining(`support/${conversationId}/${second}.png`) },
        {
          id: first,
          contentType: "image/jpeg",
          width: 1600,
          height: 1200,
          url: expect.stringContaining(`support/${conversationId}/${first}.jpg`),
        },
      ]);
    });

    it("texto e imágenes juntos también", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);
      const id = await upload(userId, { conversationId });
      const response = await write(userId, conversationId, { body: "Mirá la foto", attachmentIds: [id] });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ body: "Mirá la foto", attachments: [{ id }] });
    });

    it("cuerpo vacío sin imágenes sigue siendo 400", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);
      expect((await write(userId, conversationId, { body: "   " })).statusCode).toBe(400);
    });

    it("más de 4 imágenes o una repetida responden 422", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);
      const ids = await Promise.all(Array.from({ length: 5 }, () => upload(userId, { conversationId })));

      const tooMany = await write(userId, conversationId, { attachmentIds: ids });
      expect(tooMany.statusCode).toBe(422);
      expect(tooMany.json().error.code).toBe("SUPPORT_ATTACHMENT_INVALID");
      expect((await write(userId, conversationId, { attachmentIds: [ids[0], ids[0]] })).statusCode).toBe(422);
      // Nada quedó asociado: las 5 siguen libres.
      expect(await app.db.supportAttachment.count({ where: { messageId: null } })).toBe(5);
      expect((await write(userId, conversationId, { attachmentIds: ids.slice(0, 4) })).statusCode).toBe(201);
    });

    it("un adjunto ajeno responde 422 y no crea el mensaje", async () => {
      const owner = randomUUID();
      const other = randomUUID();
      const conversationId = await openConversation(owner);
      const foreign = await upload(other);

      const response = await write(owner, conversationId, { body: "hola", attachmentIds: [foreign] });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("SUPPORT_ATTACHMENT_INVALID");
      expect(await app.db.supportMessage.count({ where: { conversationId } })).toBe(1);
    });

    it("un adjunto ya usado no se puede reusar, ni en la misma ni en otra consulta", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);
      const id = await upload(userId, { conversationId });
      expect((await write(userId, conversationId, { attachmentIds: [id] })).statusCode).toBe(201);

      expect((await write(userId, conversationId, { attachmentIds: [id] })).statusCode).toBe(422);
      const other = await openConversation(userId);
      expect((await write(userId, other, { attachmentIds: [id] })).statusCode).toBe(422);
    });

    it("dos mensajes simultáneos con el mismo adjunto: solo uno lo gana", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);
      const id = await upload(userId, { conversationId });

      const codes = (
        await Promise.all([write(userId, conversationId, { attachmentIds: [id] }), write(userId, conversationId, { attachmentIds: [id] })])
      ).map((r) => r.statusCode);

      expect(codes.sort()).toEqual([201, 422]);
      expect(await app.db.supportMessage.count({ where: { conversationId, attachmentCount: 1 } })).toBe(1);
    });

    it("un adjunto subido para otra consulta propia no sirve en esta", async () => {
      const userId = randomUUID();
      const a = await openConversation(userId);
      const b = await openConversation(userId);
      const forA = await upload(userId, { conversationId: a });
      expect((await write(userId, b, { attachmentIds: [forA] })).statusCode).toBe(422);
    });

    it("si el objeto no está en el bucket, o no coincide con lo declarado, responde 422", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);
      const notUploaded = (await presign(userId, { contentType: "image/jpeg", sizeBytes: 1000, conversationId })).json().attachmentId;
      expect((await write(userId, conversationId, { attachmentIds: [notUploaded] })).statusCode).toBe(422);

      const mismatched = (await presign(userId, { contentType: "image/jpeg", sizeBytes: 1000, conversationId })).json().attachmentId;
      const row = await app.db.supportAttachment.findUniqueOrThrow({ where: { id: mismatched } });
      storage.__simulateUpload(row.s3Key, { contentType: "image/png", contentLength: 1000 });
      expect((await write(userId, conversationId, { attachmentIds: [mismatched] })).statusCode).toBe(422);
    });

    it("un adjunto inexistente responde 422", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);
      expect((await write(userId, conversationId, { attachmentIds: [randomUUID()] })).statusCode).toBe(422);
    });

    it("el reenvío idempotente devuelve el mensaje con sus adjuntos, sin volver a asociarlos", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);
      const id = await upload(userId, { conversationId });
      const clientMessageId = randomUUID();

      expect((await write(userId, conversationId, { attachmentIds: [id], clientMessageId })).statusCode).toBe(201);
      const replay = await write(userId, conversationId, { attachmentIds: [id], clientMessageId });

      expect(replay.statusCode).toBe(200);
      expect(replay.json().attachments).toEqual([expect.objectContaining({ id })]);
    });

    it("la primera consulta lleva las fotos subidas sin conversación (pending), que quedan en esa consulta", async () => {
      const userId = randomUUID();
      const id = await upload(userId);

      const response = await open(userId, { body: "", attachmentIds: [id] });

      expect(response.statusCode).toBe(201);
      const { conversation, message } = response.json();
      expect(message.attachments).toEqual([expect.objectContaining({ id, url: expect.stringContaining(`support/pending/${userId}/`) })]);
      expect(conversation.lastMessage).toMatchObject({ body: "", hasAttachments: true });
      const row = await app.db.supportAttachment.findUniqueOrThrow({ where: { id } });
      expect(row.conversationId).toBe(conversation.id);
    });

    it("la primera consulta no acepta una foto subida para otra consulta", async () => {
      const userId = randomUUID();
      const existing = await openConversation(userId);
      const id = await upload(userId, { conversationId: existing });
      const response = await open(userId, { attachmentIds: [id] });
      expect(response.statusCode).toBe(422);
      expect(await app.db.supportConversation.count()).toBe(1);
    });

    it("un adjunto del usuario no lo puede usar un agente (y viceversa)", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);
      const userAttachment = await upload(userId, { conversationId });
      await expect(
        supportRepo.appendStaffMessage({
          conversationId,
          kind: "agent",
          authorId: userId,
          authorName: "Lucía",
          body: "",
          clientMessageId: randomUUID(),
          attachmentIds: [userAttachment],
          now: new Date(),
        })
      ).rejects.toThrow();
      expect(await app.db.supportMessage.count({ where: { conversationId } })).toBe(1);
    });
  });

  describe("lectura con URL firmada", () => {
    it("el historial firma una URL nueva en cada pedido (vida corta, nunca persistida)", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);
      const id = await upload(userId, { conversationId });
      await write(userId, conversationId, { attachmentIds: [id] });

      const first = (await history(userId, conversationId)).json().items[0].attachments[0].url;
      const second = (await history(userId, conversationId)).json().items[0].attachments[0].url;

      expect(first).not.toBe(second);
      const row = await app.db.supportAttachment.findUniqueOrThrow({ where: { id } });
      expect(JSON.stringify(row)).not.toContain("mock-download");
    });

    it("firma por 15 minutos", async () => {
      const spy = vi.spyOn(storage, "createDownloadUrl");
      const userId = randomUUID();
      const conversationId = await openConversation(userId);
      const id = await upload(userId, { conversationId });
      await write(userId, conversationId, { attachmentIds: [id] });
      expect(spy).toHaveBeenCalledWith(expect.stringContaining(id), { expiresIn: 15 * 60 });
      spy.mockRestore();
    });

    it("otro usuario no obtiene la URL: la consulta ajena responde 404", async () => {
      const owner = randomUUID();
      const conversationId = await openConversation(owner);
      const id = await upload(owner, { conversationId });
      await write(owner, conversationId, { attachmentIds: [id] });

      const response = await history(randomUUID(), conversationId);
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain(id);
    });

    it("la lista marca hasAttachments del último mensaje", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);
      const id = await upload(userId, { conversationId });
      await write(userId, conversationId, { attachmentIds: [id] });

      const list = await app.inject({ method: "GET", url: "/support/conversations", headers: headers(userId) });
      expect(list.json().items[0].lastMessage).toMatchObject({ body: "", hasAttachments: true });
    });
  });

  describe("tiempo real y push", () => {
    async function agentSendsImage(conversationId: string, body: string) {
      const agentId = randomUUID();
      const attachments = createSupportAttachmentsService({ repository: createSupportAttachmentRepository(app.db), storage });
      const { attachmentId } = await attachments.create({
        uploaderId: agentId,
        uploaderKind: "staff",
        conversationId,
        contentType: "image/jpeg",
        sizeBytes: 2000,
      });
      const row = await app.db.supportAttachment.findUniqueOrThrow({ where: { id: attachmentId } });
      storage.__simulateUpload(row.s3Key, { contentType: "image/jpeg", contentLength: 2000 });
      await attachments.assertUsable({ ids: [attachmentId], uploaderId: agentId, uploaderKind: "staff", conversationId });
      const { message, conversation } = await supportRepo.appendStaffMessage({
        conversationId,
        kind: "agent",
        authorId: agentId,
        authorName: "Lucía",
        body,
        clientMessageId: randomUUID(),
        attachmentIds: [attachmentId],
        now: new Date(),
        nextStatus: "awaiting_user",
      });
      await staffService.publishStaffMessage(conversation, message);
      return attachmentId;
    }

    it("el evento support_message incluye los adjuntos", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);
      const ws = new WebSocket(`${baseUrl}/support/conversations/${conversationId}`, {
        headers: { authorization: `Bearer ${token(userId)}` },
      });
      const events: Array<Record<string, unknown>> = [];
      ws.on("message", (data: Buffer) => events.push(JSON.parse(data.toString())));
      await vi.waitFor(() => expect(events).toContainEqual({ type: "connected", conversationId }));

      const attachmentId = await agentSendsImage(conversationId, "");

      await vi.waitFor(() => expect(events.filter((e) => e.type === "support_message")).toHaveLength(1));
      expect(events.find((e) => e.type === "support_message")).toMatchObject({
        message: { kind: "agent", body: "", attachments: [{ id: attachmentId, contentType: "image/jpeg", url: expect.any(String) }] },
      });
      ws.close();
    });

    it("la push de un mensaje sin texto dice \"Te envió una imagen\"", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);

      await agentSendsImage(conversationId, "");

      const pushes = vi.mocked(notifications.sendPush).mock.calls.map(([input]) => input).filter((p) => p.userId === userId);
      expect(pushes).toHaveLength(1);
      expect(pushes[0].body).toBe("Lucía: Te envió una imagen");
    });
  });

  describe("huérfanos", () => {
    it("el sweep borra los nunca asociados más viejos que el corte (fila y objeto) y no toca los usados", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);
      const used = await upload(userId, { conversationId });
      await write(userId, conversationId, { attachmentIds: [used] });
      const orphan = await upload(userId, { conversationId });
      const orphanKey = (await app.db.supportAttachment.findUniqueOrThrow({ where: { id: orphan } })).s3Key;
      const fresh = await upload(userId, { conversationId });
      await app.db.supportAttachment.update({ where: { id: orphan }, data: { createdAt: new Date(Date.now() - 48 * 3600_000) } });
      await app.db.supportAttachment.update({ where: { id: used }, data: { createdAt: new Date(Date.now() - 48 * 3600_000) } });

      const removed = await sweepSupportAttachments({
        repository: createSupportAttachmentRepository(app.db),
        storage,
        cutoff: new Date(Date.now() - 24 * 3600_000),
        logger: app.log,
      });

      expect(removed).toBe(1);
      const left = (await app.db.supportAttachment.findMany()).map((r) => r.id).sort();
      expect(left).toEqual([used, fresh].sort());
      expect((await storage.headObject(orphanKey)).exists).toBe(false);
      // Ya no se puede asociar: la fila no existe.
      expect((await write(userId, conversationId, { attachmentIds: [orphan] })).statusCode).toBe(422);
    });

    it("si S3 falla al borrar, la fila queda marcada (no se puede usar) y la próxima corrida reintenta", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);
      const orphan = await upload(userId, { conversationId });
      const key = (await app.db.supportAttachment.findUniqueOrThrow({ where: { id: orphan } })).s3Key;
      await app.db.supportAttachment.update({ where: { id: orphan }, data: { createdAt: new Date(Date.now() - 48 * 3600_000) } });
      const sweep = () =>
        sweepSupportAttachments({
          repository: createSupportAttachmentRepository(app.db),
          storage,
          cutoff: new Date(Date.now() - 24 * 3600_000),
          logger: app.log,
        });
      const spy = vi.spyOn(storage, "deleteObject").mockRejectedValueOnce(new Error("AccessDenied"));

      expect(await sweep()).toBe(0);
      const marked = await app.db.supportAttachment.findUniqueOrThrow({ where: { id: orphan } });
      expect(marked.deletingAt).not.toBeNull();
      expect((await storage.headObject(key)).exists).toBe(true);
      expect((await write(userId, conversationId, { attachmentIds: [orphan] })).statusCode).toBe(422);

      expect(await sweep()).toBe(1);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(await app.db.supportAttachment.findUnique({ where: { id: orphan } })).toBeNull();
      expect((await storage.headObject(key)).exists).toBe(false);
      spy.mockRestore();
    });
  });

  describe("review de la PR #299", () => {
    it("con 20 adjuntos pedidos sin usar, el siguiente responde 429; usarlos libera el cupo", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) ids.push(await upload(userId, { conversationId }));

      const blocked = await presign(userId, { contentType: "image/jpeg", sizeBytes: 1000 });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error.code).toBe("SUPPORT_ATTACHMENT_PENDING_LIMIT");

      expect((await write(userId, conversationId, { attachmentIds: ids.slice(0, 4) })).statusCode).toBe(201);
      expect((await presign(userId, { contentType: "image/jpeg", sizeBytes: 1000 })).statusCode).toBe(201);
    });

    it("el claim rechaza más de 4 o repetidos aunque el camino del agente no pase por assertUsable", async () => {
      const userId = randomUUID();
      const agentId = randomUUID();
      const conversationId = await openConversation(userId);
      const attachments = createSupportAttachmentsService({ repository: createSupportAttachmentRepository(app.db), storage });
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const { attachmentId } = await attachments.create({
          uploaderId: agentId,
          uploaderKind: "staff",
          conversationId,
          contentType: "image/jpeg",
          sizeBytes: 1000,
        });
        ids.push(attachmentId);
      }
      const staffMessage = (attachmentIds: string[]) =>
        supportRepo.appendStaffMessage({
          conversationId,
          kind: "agent",
          authorId: agentId,
          authorName: "Lucía",
          body: "",
          clientMessageId: randomUUID(),
          attachmentIds,
          now: new Date(),
        });

      await expect(staffMessage(ids)).rejects.toThrow();
      await expect(staffMessage([ids[0], ids[0]])).rejects.toThrow();
      expect(await app.db.supportMessage.count({ where: { conversationId } })).toBe(1);
      await expect(staffMessage(ids.slice(0, 4))).resolves.toBeDefined();
    });

    it("si firmar las URLs falla después de guardar, el mensaje se responde y difunde sin adjuntos y no se corta la reapertura", async () => {
      const userId = randomUUID();
      const conversationId = await openConversation(userId);
      await app.db.supportConversation.update({ where: { id: conversationId }, data: { status: "resolved", resolvedAt: new Date() } });
      const id = await upload(userId, { conversationId });
      const spy = vi.spyOn(storage, "createDownloadUrl").mockRejectedValueOnce(new Error("S3 caído"));

      const response = await write(userId, conversationId, { body: "Otra foto", attachmentIds: [id] });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ body: "Otra foto", attachments: [] });
      spy.mockRestore();
      const page = (await history(userId, conversationId)).json();
      expect(page.conversation.status).toBe("open");
      expect(page.items.map((m: { kind: string }) => m.kind)).toContain("system");
      expect(page.items.find((m: { id: string }) => m.id === response.json().id).attachments).toEqual([expect.objectContaining({ id })]);
    });
  });
});
