import { createHmac } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FastifyBaseLogger } from "fastify";
import { KycStatus } from "@movo/shared";
import { PrismaClient } from "../src/generated/prisma/client";
import { createKycService, DiditWebhookPayload } from "../src/modules/kyc/kyc.service";
import { canonicalizeJson } from "../src/adapters/didit-signature";
import { DiditClient } from "../src/adapters/didit-client";

/**
 * MOVO-274: push del resultado de KYC. Unitario, sin base ni red: los repositorios se
 * reemplazan por fakes (`vi.mock`) para poder decidir qué devuelve la compuerta de
 * idempotencia de `applyTerminalDecision` (`resolveByExternalSessionId`), que es lo que
 * gobierna si se avisa o no. Los tests de integración de KYC (webhook/sesión/estado)
 * cubren la persistencia contra Postgres real.
 */
const mocks = vi.hoisted(() => ({
  resolveByExternalSessionId: vi.fn(),
  findLatestByUserId: vi.fn(),
  findById: vi.fn(),
  updateKycStatusIdentity: vi.fn(),
  updateKycStatusLicense: vi.fn(),
  upsertVerified: vi.fn(),
}));

vi.mock("../src/repositories/kyc-verification-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/repositories/kyc-verification-repository")>()),
  createKycVerificationRepository: () => ({
    resolveByExternalSessionId: mocks.resolveByExternalSessionId,
    findLatestByUserId: mocks.findLatestByUserId,
  }),
}));
vi.mock("../src/repositories/user-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/repositories/user-repository")>()),
  createUserRepository: () => ({
    findById: mocks.findById,
    updateKycStatusIdentity: mocks.updateKycStatusIdentity,
    updateKycStatusLicense: mocks.updateKycStatusLicense,
  }),
}));
vi.mock("../src/repositories/drivers-license-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/repositories/drivers-license-repository")>()),
  createDriversLicenseRepository: () => ({ upsertVerified: mocks.upsertVerified }),
}));

const WEBHOOK_SECRET = "webhook_secret_test";
const USER_ID = "user-1";
const SESSION_ID = "sess-1";

function signedWebhook(payload: DiditWebhookPayload) {
  const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(canonicalizeJson(payload)).digest("hex");
  const timestamp = String(Math.floor(Date.now() / 1000));
  return { rawBody, signature, timestamp };
}

function fakeVerification(verificationType: "identity" | "license", status: KycStatus) {
  return {
    id: "ver-1",
    userId: USER_ID,
    verificationType,
    provider: "didit",
    externalSessionId: SESSION_ID,
    status,
    requestedAt: new Date(),
    resolvedAt: new Date(),
    rawDecision: {},
  };
}

function fakeUser(kycStatusIdentity: KycStatus) {
  return { id: USER_ID, kycStatusIdentity, kycStatusLicense: KycStatus.NOT_STARTED };
}

function buildService(overrides: { getSessionDecision?: DiditClient["getSessionDecision"] } = {}) {
  const logger = { info: vi.fn(), warn: vi.fn() };
  const notifications = { sendPushToUser: vi.fn().mockResolvedValue(undefined) };
  const didit: DiditClient = {
    async createSession() {
      throw new Error("no usado en este test");
    },
    getSessionDecision: overrides.getSessionDecision ?? (async () => null),
  };
  const db = { $transaction: (callback: (tx: unknown) => unknown) => callback({}) } as unknown as PrismaClient;
  const service = createKycService(db, didit, WEBHOOK_SECRET, logger as unknown as FastifyBaseLogger, notifications);
  return { service, logger, notifications };
}

async function postWebhook(service: ReturnType<typeof buildService>["service"], payload: DiditWebhookPayload) {
  const { rawBody, signature, timestamp } = signedWebhook(payload);
  await service.handleWebhook(rawBody, signature, timestamp, payload);
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
  mocks.updateKycStatusIdentity.mockResolvedValue(null);
  mocks.updateKycStatusLicense.mockResolvedValue(null);
  mocks.upsertVerified.mockResolvedValue(undefined);
});

describe("Push del resultado de KYC (MOVO-274)", () => {
  describe("por webhook", () => {
    it.each([
      {
        type: "identity" as const,
        rawStatus: "Approved",
        status: KycStatus.APPROVED,
        title: "Identidad verificada",
        body: "Tu identidad fue verificada de manera exitosa.",
      },
      {
        type: "identity" as const,
        rawStatus: "Declined",
        status: KycStatus.REJECTED,
        title: "No pudimos verificar tu identidad",
        body: "Tu verificación de identidad falló. Podés volver a intentarlo desde la app.",
      },
      {
        type: "identity" as const,
        rawStatus: "In Review",
        status: KycStatus.MANUAL_REVIEW,
        title: "Tu identidad está en revisión",
        body: "Estamos revisando tu verificación de identidad. Te avisamos cuando tengamos el resultado.",
      },
      {
        type: "license" as const,
        rawStatus: "Approved",
        status: KycStatus.APPROVED,
        title: "Licencia verificada",
        body: "Verificamos tu licencia de conducir correctamente.",
      },
      {
        type: "license" as const,
        rawStatus: "Declined",
        status: KycStatus.REJECTED,
        title: "No pudimos verificar tu licencia",
        body: "Tu verificación de licencia de conducir falló. Podés volver a intentarlo desde la app.",
      },
      {
        type: "license" as const,
        rawStatus: "In Review",
        status: KycStatus.MANUAL_REVIEW,
        title: "Tu licencia está en revisión",
        body: "Estamos revisando tu licencia de conducir. Te avisamos cuando tengamos el resultado.",
      },
    ])("$type / $rawStatus: avisa una vez, con su copy y categoría 'kyc'", async ({ type, rawStatus, status, title, body }) => {
      mocks.resolveByExternalSessionId.mockResolvedValue(fakeVerification(type, status));
      const { service, notifications } = buildService();

      await postWebhook(service, { status: rawStatus, session_id: SESSION_ID });

      expect(notifications.sendPushToUser).toHaveBeenCalledTimes(1);
      expect(notifications.sendPushToUser).toHaveBeenCalledWith(USER_ID, {
        title,
        body,
        category: "kyc",
        data: { type: "kyc_result", verificationType: type, status },
      });
    });

    it("un webhook duplicado o de una sesión desconocida (la compuerta devuelve null) no manda ningún push", async () => {
      mocks.resolveByExternalSessionId.mockResolvedValue(null);
      const { service, notifications } = buildService();

      await postWebhook(service, { status: "Approved", session_id: SESSION_ID });

      expect(notifications.sendPushToUser).not.toHaveBeenCalled();
    });

    it("un estado no terminal ('In Progress') no aplica nada y no manda push", async () => {
      const { service, notifications } = buildService();

      await postWebhook(service, { status: "In Progress", session_id: SESSION_ID });

      expect(mocks.resolveByExternalSessionId).not.toHaveBeenCalled();
      expect(notifications.sendPushToUser).not.toHaveBeenCalled();
    });

    it("'Expired' sí aplica la transición pero no es un resultado: no manda push", async () => {
      mocks.resolveByExternalSessionId.mockResolvedValue(fakeVerification("identity", KycStatus.EXPIRED));
      const { service, notifications } = buildService();

      await postWebhook(service, { status: "Expired", session_id: SESSION_ID });

      expect(mocks.resolveByExternalSessionId).toHaveBeenCalledTimes(1);
      expect(notifications.sendPushToUser).not.toHaveBeenCalled();
    });

    it("el push sale DESPUÉS de aplicar la decisión", async () => {
      mocks.resolveByExternalSessionId.mockResolvedValue(fakeVerification("identity", KycStatus.APPROVED));
      const { service, notifications } = buildService();

      await postWebhook(service, { status: "Approved", session_id: SESSION_ID });

      const applied = mocks.resolveByExternalSessionId.mock.invocationCallOrder[0] ?? Infinity;
      const pushed = notifications.sendPushToUser.mock.invocationCallOrder[0] ?? -Infinity;
      expect(pushed).toBeGreaterThan(applied);
    });

    it("un fallo del push no hace fallar el webhook (Didit reintentaría un evento ya aplicado) y se loguea", async () => {
      mocks.resolveByExternalSessionId.mockResolvedValue(fakeVerification("identity", KycStatus.APPROVED));
      const { service, notifications, logger } = buildService();
      notifications.sendPushToUser.mockRejectedValue(new Error("expo caído"));

      await expect(postWebhook(service, { status: "Approved", session_id: SESSION_ID })).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "kyc_push_failed", userId: USER_ID, verificationType: "identity" }),
        expect.any(String)
      );
    });
  });

  describe("por pull (GET /kyc/status, reconciliación)", () => {
    it("si Didit ya tenía la decisión y se aplica por pull, avisa una vez", async () => {
      mocks.findById.mockResolvedValue(fakeUser(KycStatus.PENDING));
      mocks.findLatestByUserId.mockResolvedValue({ status: KycStatus.PENDING, externalSessionId: SESSION_ID });
      mocks.resolveByExternalSessionId.mockResolvedValue(fakeVerification("identity", KycStatus.APPROVED));
      const { service, notifications } = buildService({
        getSessionDecision: async () => ({ sessionId: SESSION_ID, rawStatus: "Approved", decision: {} }),
      });

      const result = await service.getStatus(USER_ID, "identity");

      expect(result.status).toBe(KycStatus.APPROVED);
      expect(notifications.sendPushToUser).toHaveBeenCalledTimes(1);
      expect(notifications.sendPushToUser).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ title: "Identidad verificada", category: "kyc" })
      );
    });

    it("si el webhook ganó la carrera (la compuerta devuelve null), el pull no vuelve a avisar", async () => {
      mocks.findById
        .mockResolvedValueOnce(fakeUser(KycStatus.PENDING))
        .mockResolvedValueOnce(fakeUser(KycStatus.APPROVED));
      mocks.findLatestByUserId.mockResolvedValue({ status: KycStatus.PENDING, externalSessionId: SESSION_ID });
      mocks.resolveByExternalSessionId.mockResolvedValue(null);
      const { service, notifications } = buildService({
        getSessionDecision: async () => ({ sessionId: SESSION_ID, rawStatus: "Approved", decision: {} }),
      });

      const result = await service.getStatus(USER_ID, "identity");

      expect(result.status).toBe(KycStatus.APPROVED);
      expect(notifications.sendPushToUser).not.toHaveBeenCalled();
    });

    it("consultar el estado cuando no hay nada en curso no manda push", async () => {
      mocks.findById.mockResolvedValue(fakeUser(KycStatus.APPROVED));
      const { service, notifications } = buildService();

      await service.getStatus(USER_ID, "identity");

      expect(notifications.sendPushToUser).not.toHaveBeenCalled();
    });
  });
});
