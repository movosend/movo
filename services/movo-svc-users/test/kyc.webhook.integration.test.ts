import { createHmac, randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { canonicalizeJson } from "../src/adapters/didit-signature";

const WEBHOOK_SECRET = "webhook_secret_test";

function signWebhook(payload: Record<string, unknown>) {
  const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(canonicalizeJson(payload)).digest("hex");
  const timestamp = String(Math.floor(Date.now() / 1000));
  return { rawBody, signature, timestamp };
}

describe("POST /kyc/webhook (MOVO-72, AC4-AC7)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    process.env.DIDIT_WEBHOOK_SECRET = WEBHOOK_SECRET;
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
  });

  async function createPendingVerification(): Promise<{ userId: string; externalSessionId: string }> {
    const user = await app.db.user.create({
      data: {
        email: `${randomUUID()}@example.com`,
        phone: `+549351${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: "Juan",
        lastName: "Perez",
        passwordHash: "hash",
        phoneVerified: true,
        kycStatusIdentity: "pending",
      },
    });
    const externalSessionId = `sess-${randomUUID()}`;
    await app.db.kycVerification.create({
      data: {
        userId: user.id,
        verificationType: "identity",
        provider: "didit",
        externalSessionId,
        status: "pending",
      },
    });
    return { userId: user.id, externalSessionId };
  }

  async function postWebhook(payload: Record<string, unknown>, overrideSignature?: string, overrideTimestamp?: string) {
    const { rawBody, signature, timestamp } = signWebhook(payload);
    return app.inject({
      method: "POST",
      url: "/kyc/webhook",
      headers: {
        "content-type": "application/json",
        "x-signature-v2": overrideSignature ?? signature,
        "x-timestamp": overrideTimestamp ?? timestamp,
      },
      payload: rawBody,
    });
  }

  it.each([
    ["Approved", "approved"],
    ["Declined", "rejected"],
    ["In Review", "manual_review"],
  ])("resultado %s de Didit transiciona a %s, con resolvedAt y raw_decision redactado (AC6)", async (diditStatus, expectedStatus) => {
    const { userId, externalSessionId } = await createPendingVerification();

    // Shape confirmado contra el sandbox real (Paso 7 del plan): status/session_id/
    // vendor_data en el nivel superior — no hay `reason` de nivel superior, ver
    // comentario de DiditWebhookPayload en kyc.service.ts.
    const response = await postWebhook({
      status: diditStatus,
      session_id: externalSessionId,
      vendor_data: userId,
    });

    expect(response.statusCode).toBe(200);

    const user = await app.db.user.findUnique({ where: { id: userId } });
    expect(user?.kycStatusIdentity).toBe(expectedStatus);

    const verification = await app.db.kycVerification.findUnique({ where: { externalSessionId } });
    expect(verification?.status).toBe(expectedStatus);
    expect(verification?.resolvedAt).not.toBeNull();
    expect(verification?.rawDecision).toEqual({ status: diditStatus, session_id: externalSessionId, vendor_data: userId });
  });

  it("extrae warnings de decision.<feature>[].warnings[] y las persiste redactadas (shape real confirmado en sandbox, Paso 7)", async () => {
    const { userId, externalSessionId } = await createPendingVerification();

    // Recorte del payload real de Declined que devolvió "Probar Webhook" en la consola
    // de Didit — incluye campos sensibles (address, front_image, etc.) a propósito,
    // para probar que solo feature/risk/short_description sobreviven la redacción.
    const response = await postWebhook({
      status: "Declined",
      session_id: externalSessionId,
      decision: {
        id_verifications: [
          {
            address: "123 Main Street, Apt 4B, New York, NY 10001",
            front_image: "https://didit-public-assets.s3.eu-west-1.amazonaws.com/webhooks/id-front-pol.jpeg",
            full_name: "John Doe Smith",
            status: "Declined",
            warnings: [
              {
                feature: "ID_VERIFICATION",
                risk: "DOCUMENT_EXPIRED",
                short_description: "Document expired",
                long_description: "The document's expiration date has passed, rendering it no longer valid for use.",
              },
            ],
          },
        ],
        face_matches: [{ status: "Approved", warnings: [] }],
      },
    });

    expect(response.statusCode).toBe(200);

    const verification = await app.db.kycVerification.findUnique({ where: { externalSessionId } });
    expect(verification?.rawDecision).toEqual({
      status: "Declined",
      session_id: externalSessionId,
      warnings: [{ feature: "ID_VERIFICATION", risk: "DOCUMENT_EXPIRED", description: "Document expired" }],
    });
    // Ninguno de los campos sensibles del fixture (address/front_image/full_name/
    // long_description) sobrevive a la redacción — AC9.
    expect(JSON.stringify(verification?.rawDecision)).not.toContain("Main Street");
    expect(JSON.stringify(verification?.rawDecision)).not.toContain("front_image");
    expect(JSON.stringify(verification?.rawDecision)).not.toContain("expiration date has passed");
  });

  it("rechaza con 401 y no modifica nada si la firma es inválida (AC5)", async () => {
    const { userId, externalSessionId } = await createPendingVerification();

    const response = await postWebhook(
      { status: "Approved", session_id: externalSessionId },
      "0".repeat(64)
    );

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error.code).toBe("KYC_WEBHOOK_INVALID_SIGNATURE");

    const user = await app.db.user.findUnique({ where: { id: userId } });
    expect(user?.kycStatusIdentity).toBe("pending");
    const verification = await app.db.kycVerification.findUnique({ where: { externalSessionId } });
    expect(verification?.status).toBe("pending");
    expect(verification?.resolvedAt).toBeNull();
  });

  it("un webhook duplicado (mismo evento dos veces) es idempotente: la segunda vez no cambia nada (AC7)", async () => {
    const { userId, externalSessionId } = await createPendingVerification();
    const payload = { status: "Approved", session_id: externalSessionId };

    const first = await postWebhook(payload);
    expect(first.statusCode).toBe(200);

    const afterFirst = await app.db.kycVerification.findUnique({ where: { externalSessionId } });
    const resolvedAtAfterFirst = afterFirst?.resolvedAt?.getTime();

    const second = await postWebhook(payload);
    expect(second.statusCode).toBe(200);

    const afterSecond = await app.db.kycVerification.findUnique({ where: { externalSessionId } });
    expect(afterSecond?.resolvedAt?.getTime()).toBe(resolvedAtAfterFirst);

    const user = await app.db.user.findUnique({ where: { id: userId } });
    expect(user?.kycStatusIdentity).toBe("approved");
  });

  it("un estado intermedio no terminal (In Progress) no dispara ninguna transición y responde 200 igual", async () => {
    const { userId, externalSessionId } = await createPendingVerification();

    const response = await postWebhook({ status: "In Progress", session_id: externalSessionId });

    expect(response.statusCode).toBe(200);
    const user = await app.db.user.findUnique({ where: { id: userId } });
    expect(user?.kycStatusIdentity).toBe("pending");
    const verification = await app.db.kycVerification.findUnique({ where: { externalSessionId } });
    expect(verification?.status).toBe("pending");
  });

  it("un session_id desconocido no revienta y responde 200 (Didit no debe reintentar un evento que nunca se va a poder procesar)", async () => {
    const response = await postWebhook({ status: "Approved", session_id: `sess-${randomUUID()}` });

    expect(response.statusCode).toBe(200);
  });

  it("rechaza con 401 si el timestamp está fuera de la ventana anti-replay", async () => {
    const { externalSessionId } = await createPendingVerification();
    const payload = { status: "Approved", session_id: externalSessionId };
    const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
    const signature = createHmac("sha256", WEBHOOK_SECRET).update(canonicalizeJson(payload)).digest("hex");
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 400);

    const response = await app.inject({
      method: "POST",
      url: "/kyc/webhook",
      headers: { "content-type": "application/json", "x-signature-v2": signature, "x-timestamp": staleTimestamp },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(401);
  });
});
