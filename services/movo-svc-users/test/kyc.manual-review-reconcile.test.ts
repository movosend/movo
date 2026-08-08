import { createHmac, randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { canonicalizeJson } from "../src/adapters/didit-signature";
import { DiditClient, DiditSessionDecision } from "../src/adapters/didit-client";

const WEBHOOK_SECRET = "webhook_secret_test";

function signWebhook(payload: Record<string, unknown>) {
  const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(canonicalizeJson(payload)).digest("hex");
  const timestamp = String(Math.floor(Date.now() / 1000));
  return { rawBody, signature, timestamp };
}

/** Mismo criterio que `kyc.session.integration.test.ts`: `DiditClient` fake e
 * inyectable, para poder simular que Didit ya tiene una decisión tomada. */
function createFakeDiditClient() {
  let decision: DiditSessionDecision | null = null;

  const client: DiditClient = {
    async createSession() {
      throw new Error("no usado en este test");
    },
    async getSessionDecision(sessionId: string) {
      return decision;
    },
  };

  return {
    client,
    setDecision(next: DiditSessionDecision | null) {
      decision = next;
    },
  };
}

/**
 * Caso real reportado: un usuario queda en `manual_review` (webhook "In Review" ya
 * procesado), un operador lo aprueba manualmente en la consola de Didit, y aunque
 * Didit reporta el webhook de aprobación como "entregado", la app seguía mostrando
 * "en revisión" para siempre — sin ninguna acción que lo destrabara.
 *
 * Causa raíz: `applyTerminalDecision` (el único camino de escritura de una decisión,
 * usado tanto por el webhook como por la reconciliación por pull) exigía que la fila
 * siguiera en `pending` para aplicar la transición. Una vez que el primer webhook
 * (`In Review`) la dejó en `manual_review`, cualquier segundo webhook terminal
 * (`Approved`/`Declined`) dejaba de matchear ese gate y se ignoraba como si fuera un
 * duplicado — sin importar si realmente llegaba o no.
 */
describe("Reconciliación de manual_review → estado terminal (fix del caso reportado)", () => {
  let app: FastifyInstance;
  let didit: ReturnType<typeof createFakeDiditClient>;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    process.env.DIDIT_WEBHOOK_SECRET = WEBHOOK_SECRET;
    didit = createFakeDiditClient();
    app = buildApp({ diditClient: didit.client });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    didit.setDecision(null);
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
  });

  async function createManualReviewVerification(): Promise<{ userId: string; externalSessionId: string }> {
    const user = await app.db.user.create({
      data: {
        email: `${randomUUID()}@example.com`,
        phone: `+549351${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: "Juan",
        lastName: "Perez",
        passwordHash: "hash",
        phoneVerified: true,
        kycStatusIdentity: "manual_review",
      },
    });
    const externalSessionId = `sess-${randomUUID()}`;
    await app.db.kycVerification.create({
      data: {
        userId: user.id,
        verificationType: "identity",
        provider: "didit",
        externalSessionId,
        status: "manual_review",
        resolvedAt: new Date(),
      },
    });
    return { userId: user.id, externalSessionId };
  }

  async function postWebhook(payload: Record<string, unknown>) {
    const { rawBody, signature, timestamp } = signWebhook(payload);
    return app.inject({
      method: "POST",
      url: "/kyc/webhook",
      headers: { "content-type": "application/json", "x-signature-v2": signature, "x-timestamp": timestamp },
      payload: rawBody,
    });
  }

  it("un segundo webhook terminal (operador aprobó la revisión manual) transiciona manual_review → approved", async () => {
    const { userId, externalSessionId } = await createManualReviewVerification();

    const response = await postWebhook({ status: "Approved", session_id: externalSessionId });

    expect(response.statusCode).toBe(200);
    const user = await app.db.user.findUnique({ where: { id: userId } });
    expect(user?.kycStatusIdentity).toBe("approved");
    const verification = await app.db.kycVerification.findUnique({ where: { externalSessionId } });
    expect(verification?.status).toBe("approved");
  });

  it("un segundo webhook terminal también puede rechazar (manual_review → rejected)", async () => {
    const { userId, externalSessionId } = await createManualReviewVerification();

    const response = await postWebhook({ status: "Declined", session_id: externalSessionId });

    expect(response.statusCode).toBe(200);
    const user = await app.db.user.findUnique({ where: { id: userId } });
    expect(user?.kycStatusIdentity).toBe("rejected");
  });

  it("GET /kyc/status reconcilia contra Didit (pull) cuando el segundo webhook nunca llegó a nuestro backend", async () => {
    const { userId, externalSessionId } = await createManualReviewVerification();
    // Simula que Didit sí tiene la decisión (el operador ya aprobó), pero por lo que
    // sea (túnel de desarrollo caído, red) nuestro webhook nunca la recibió.
    didit.setDecision({ sessionId: externalSessionId, rawStatus: "Approved", decision: {} });

    const response = await app.inject({
      method: "GET",
      url: "/kyc/status",
      headers: { "x-user-id": userId },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "approved", manualReviewReason: null });

    const user = await app.db.user.findUnique({ where: { id: userId } });
    expect(user?.kycStatusIdentity).toBe("approved");
  });

  it("GET /kyc/status no cambia nada si Didit todavía no tiene una decisión terminal", async () => {
    const { userId } = await createManualReviewVerification();
    didit.setDecision(null);

    const response = await app.inject({
      method: "GET",
      url: "/kyc/status",
      headers: { "x-user-id": userId },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).status).toBe("manual_review");
  });
});
