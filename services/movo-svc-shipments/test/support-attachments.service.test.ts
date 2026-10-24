import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import { ApiError, SUPPORT_ATTACHMENT_MAX_BYTES } from "@movo/shared";
import { createMockStorageProvider, MockStorageProvider } from "../src/adapters/mock-storage-provider";
import {
  SupportAttachmentRecord,
  SupportAttachmentRepository,
} from "../src/repositories/support-attachment-repository";
import {
  createSupportAttachmentsService,
  SupportAttachmentsService,
  supportAttachmentKey,
  SUPPORT_ATTACHMENT_URL_TTL_SECONDS,
} from "../src/modules/support/support-attachments.service";

/** Repositorio en memoria: lo atómico (uso único en la transacción) lo prueba la suite de integración. */
function createMemoryRepository(): SupportAttachmentRepository & { rows: Map<string, SupportAttachmentRecord> } {
  const rows = new Map<string, SupportAttachmentRecord>();
  return {
    rows,
    async create(input) {
      const record: SupportAttachmentRecord = {
        id: input.id,
        uploaderId: input.uploaderId,
        uploaderKind: input.uploaderKind,
        conversationId: input.conversationId,
        messageId: null,
        position: null,
        s3Key: input.s3Key,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        width: input.width,
        height: input.height,
        createdAt: input.now,
        deletingAt: null,
      };
      rows.set(record.id, record);
      return record;
    },
    // Copia en JS de `usablePredicate` solo para el fake: la regla real (SQL) la prueba la suite de integración.
    async findUsable(ids, use) {
      return ids.flatMap((id) => {
        const r = rows.get(id);
        const ok =
          r &&
          r.uploaderId === use.uploaderId &&
          r.uploaderKind === use.uploaderKind &&
          r.messageId === null &&
          r.deletingAt === null &&
          (r.conversationId === null || (use.conversationId !== null && r.conversationId === use.conversationId));
        return ok ? [r] : [];
      });
    },
    async countPending(uploaderId) {
      return [...rows.values()].filter((r) => r.uploaderId === uploaderId && r.messageId === null && r.deletingAt === null).length;
    },
    async listForMessages(messageIds) {
      return [...rows.values()]
        .filter((r) => r.messageId !== null && messageIds.includes(r.messageId))
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    },
    async markOrphansForDeletion() {
      return [];
    },
    async deleteMarked() {},
  };
}

async function expectInvalid(promise: Promise<unknown>) {
  const err = await promise.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).statusCode).toBe(422);
  expect((err as ApiError).code).toBe("SUPPORT_ATTACHMENT_INVALID");
}

describe("servicio de adjuntos de soporte (MOVO-321)", () => {
  let storage: MockStorageProvider;
  let repository: ReturnType<typeof createMemoryRepository>;
  let service: SupportAttachmentsService;
  const userId = randomUUID();
  const conversationId = randomUUID();
  const now = new Date("2026-10-24T12:00:00.000Z");

  beforeEach(() => {
    storage = createMockStorageProvider();
    repository = createMemoryRepository();
    service = createSupportAttachmentsService({ repository, storage, now: () => now });
  });

  const create = (overrides: Partial<Parameters<SupportAttachmentsService["create"]>[0]> = {}) =>
    service.create({ uploaderId: userId, uploaderKind: "user", conversationId, contentType: "image/jpeg", sizeBytes: 1000, ...overrides });

  async function uploaded(overrides: Partial<Parameters<SupportAttachmentsService["create"]>[0]> = {}) {
    const { attachmentId } = await create(overrides);
    const row = repository.rows.get(attachmentId)!;
    storage.__simulateUpload(row.s3Key, { contentType: row.contentType, contentLength: row.sizeBytes });
    return attachmentId;
  }

  describe("supportAttachmentKey", () => {
    it("usa el prefijo de la consulta o el pending del usuario, con la extensión del tipo", () => {
      expect(supportAttachmentKey({ attachmentId: "x", contentType: "image/png", conversationId: "c", uploaderId: "u" })).toBe(
        "support/c/x.png"
      );
      expect(supportAttachmentKey({ attachmentId: "x", contentType: "image/webp", conversationId: null, uploaderId: "u" })).toBe(
        "support/pending/u/x.webp"
      );
    });
  });

  describe("create", () => {
    it("firma el PUT y calcula expiresAt con el TTL del storage", async () => {
      const result = await create({ width: 800, height: 600 });
      expect(result.uploadUrl).toContain(`support/${conversationId}/${result.attachmentId}.jpg`);
      expect(result.expiresAt).toBe(new Date(now.getTime() + 300_000).toISOString());
      expect(repository.rows.get(result.attachmentId)).toMatchObject({ width: 800, height: 600, messageId: null });
    });

    it("con 20 pendientes sin usar responde 429 SUPPORT_ATTACHMENT_PENDING_LIMIT", async () => {
      for (let i = 0; i < 20; i++) await create();
      const err = await create().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(429);
      expect((err as ApiError).code).toBe("SUPPORT_ATTACHMENT_PENDING_LIMIT");
      // Los de otro usuario no cuentan.
      await expect(create({ uploaderId: randomUUID() })).resolves.toBeDefined();
    });

    it("rechaza tipos y tamaños fuera del contrato", async () => {
      await expectInvalid(create({ contentType: "image/gif" }));
      await expectInvalid(create({ sizeBytes: SUPPORT_ATTACHMENT_MAX_BYTES + 1 }));
      await expectInvalid(create({ sizeBytes: -1 }));
      await expectInvalid(create({ sizeBytes: 1.5 }));
      expect(repository.rows.size).toBe(0);
    });
  });

  describe("assertUsable", () => {
    const assert = (ids: string[], overrides: Partial<Parameters<SupportAttachmentsService["assertUsable"]>[0]> = {}) =>
      service.assertUsable({ ids, uploaderId: userId, uploaderKind: "user", conversationId, ...overrides });

    it("acepta adjuntos propios, subidos y libres", async () => {
      await expect(assert([await uploaded(), await uploaded({ conversationId: null })])).resolves.toBeUndefined();
    });

    it("sin ids no consulta nada", async () => {
      await expect(assert([])).resolves.toBeUndefined();
    });

    it("rechaza más de 4, repetidos, ajenos, de otra conversación, del otro tipo de autor y ya usados", async () => {
      const ids = await Promise.all(Array.from({ length: 5 }, () => uploaded()));
      await expectInvalid(assert(ids));
      await expectInvalid(assert([ids[0], ids[0]]));
      await expectInvalid(assert([ids[0]], { uploaderId: randomUUID() }));
      await expectInvalid(assert([ids[0]], { conversationId: randomUUID() }));
      await expectInvalid(assert([ids[0]], { uploaderKind: "staff" }));
      await expectInvalid(assert([randomUUID()]));
      repository.rows.get(ids[1])!.messageId = randomUUID();
      await expectInvalid(assert([ids[1]]));
    });

    it("rechaza si el objeto no se subió o no coincide con lo declarado", async () => {
      const { attachmentId } = await create();
      await expectInvalid(assert([attachmentId]));
      storage.__simulateUpload(repository.rows.get(attachmentId)!.s3Key, { contentType: "image/jpeg", contentLength: 999 });
      await expectInvalid(assert([attachmentId]));
    });

    it("la primera consulta (sin conversación) solo acepta los pending", async () => {
      await expectInvalid(assert([await uploaded()], { conversationId: null }));
      await expect(assert([await uploaded({ conversationId: null })], { conversationId: null })).resolves.toBeUndefined();
    });
  });

  describe("viewsFor", () => {
    it("agrupa por mensaje, en orden, con URL de 15 min y width/height solo si se conocen", async () => {
      const messageId = randomUUID();
      const a = await uploaded({ width: 10, height: 20 });
      const b = await uploaded({ contentType: "image/png" });
      Object.assign(repository.rows.get(a)!, { messageId, position: 2 });
      Object.assign(repository.rows.get(b)!, { messageId, position: 1 });

      const views = await service.viewsFor([
        { id: messageId, attachmentCount: 2 },
        { id: randomUUID(), attachmentCount: 0 },
      ]);

      expect(views.get(messageId)).toEqual([
        { id: b, contentType: "image/png", url: expect.any(String) },
        { id: a, contentType: "image/jpeg", width: 10, height: 20, url: expect.any(String) },
      ]);
      expect(views.size).toBe(1);
      expect(SUPPORT_ATTACHMENT_URL_TTL_SECONDS).toBe(900);
    });

    it("sin mensajes con adjuntos no firma nada", async () => {
      expect((await service.viewsFor([{ id: randomUUID(), attachmentCount: 0 }])).size).toBe(0);
    });
  });
});
