import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { AdminKycEvidence, AdminKycReviewDetail, AdminUserProfile, ApiError } from "@movo/shared";
import { buildApp } from "../src/app";
import { createFakeUsersClient } from "./fake-clients";

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
    createdAt: "2026-10-01T00:00:00.000Z",
    deletedAt: null,
    roles: [{ role: "sender", grantedAt: "2026-10-01T00:00:00.000Z" }],
    accountStatus: "active",
    bannedUntil: null,
    ...overrides,
  };
};

const review = (userId: string, overrides: Partial<AdminKycReviewDetail> = {}): AdminKycReviewDetail => ({
  sessionId: `sess-${randomUUID()}`,
  userId,
  fullName: "Ana Ariza",
  photoUrl: null,
  verificationType: "identity",
  reason: "Documento borroso",
  requestedAt: "2026-11-01T10:00:00.000Z",
  inReviewSince: "2026-11-01T12:00:00.000Z",
  status: "manual_review",
  resolvedAt: null,
  email: `${userId}@movo.test`,
  phone: "+5493511234567",
  firstName: "Julia María",
  lastName: "Pérez Gómez",
  expirationDate: null,
  decidable: true,
  history: [],
  ...overrides,
});

const evidence = (): AdminKycEvidence => ({
  fetchedAt: "2026-11-09T12:00:00.000Z",
  imagesExpireAt: "2026-11-09T13:00:00.000Z",
  sessionStatus: "In Review",
  images: { selfie: "https://didit.test/selfie.jpg?sig=1", documentPortrait: null, documentFront: "https://didit.test/front.jpg?sig=1", documentBack: null, livenessVideo: null },
  document: {
    status: "In Review", type: "Driver's License", number: "45346504", personalNumber: null, firstName: "Lucas", lastName: "Dalmagro",
    fullName: "Lucas Dalmagro", dateOfBirth: "2004-02-26", age: 22, gender: "M", nationality: "ARG", issuingCountry: "Argentina",
    issueDate: "2024-12-02", expirationDate: "2029-12-02", address: null, placeOfBirth: null, maritalStatus: null,
  },
  faceMatch: { status: "Approved", score: 97 },
  liveness: { status: "Approved", method: "PASSIVE", score: 100 },
  ip: null,
  aml: null,
  phone: null,
  email: null,
  warnings: [{ feature: "ID_VERIFICATION", risk: "X", description: "Documento borroso" }],
  reviews: [],
});

/** La bitácora es real (schema `admin`); `svc-users` es un fake. Cada caso usa ids nuevos, sin limpiar tablas. */
describe("Cola de revisión manual de KYC", { timeout: 15_000 }, () => {
  let app: FastifyInstance | undefined;

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function setup(
    opts: { reviews?: (userId: string) => AdminKycReviewDetail[]; decideError?: ApiError; evidenceFor?: boolean; evidenceError?: ApiError } = {},
  ) {
    const me = profile({ fullName: "Ada Admin", roles: [{ role: "admin", grantedAt: "2026-10-01T00:00:00.000Z" }] });
    const user = profile();
    const reviews = opts.reviews ? opts.reviews(user.id) : [review(user.id)];
    const decisions: Array<{ sessionId: string; decision: string; reason: string; actorId: string; firstName?: string; lastName?: string }> = [];
    app = buildApp({
      usersClient: createFakeUsersClient({
        profiles: [me, user],
        kycReviews: reviews,
        kycDecisions: decisions,
        ...(opts.evidenceFor === false || !reviews[0] ? {} : { kycEvidence: { [reviews[0].sessionId]: evidence() } }),
        ...(opts.evidenceError ? { kycEvidenceError: opts.evidenceError } : {}),
        ...(opts.decideError ? { kycDecideError: opts.decideError } : {}),
      }),
    });
    await app.ready();
    const db = app.db;
    const inject = app.inject.bind(app);
    const headers = (adminId = me.id) => ({ "x-user-id": adminId, "x-user-roles": "admin" });
    const first = reviews[0]!;
    return {
      me,
      user,
      reviews,
      decisions,
      first,
      rows: () => db.auditLog.findMany({ where: { targetId: user.id }, orderBy: { createdAt: "asc" } }),
      list: (query = "") => inject({ method: "GET", url: `/admin/kyc/reviews${query}`, headers: headers() }),
      evidence: (sessionId: string, headers?: Record<string, string>) =>
        inject({ method: "GET", url: `/admin/kyc/reviews/${sessionId}/evidence`, headers: headers ?? { "x-user-id": me.id, "x-user-roles": "admin" } }),
      detail: (sessionId: string) => inject({ method: "GET", url: `/admin/kyc/reviews/${sessionId}`, headers: headers() }),
      decide: (sessionId: string, body: Record<string, unknown>, adminId?: string) =>
        inject({ method: "POST", url: `/admin/kyc/reviews/${sessionId}/decision`, headers: headers(adminId), payload: body }),
    };
  }

  it("lista solo los casos decidibles y filtra por tipo", async () => {
    const t = await setup({
      reviews: (id) => [review(id), review(id, { verificationType: "license" }), review(id, { decidable: false })],
    });

    const all = (await t.list()).json();
    expect(all.total).toBe(2);
    expect((await t.list("?type=license")).json().total).toBe(1);
  });

  it("devuelve el detalle y 404 si no existe", async () => {
    const t = await setup();

    const found = await t.detail(t.first.sessionId);
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({
      sessionId: t.first.sessionId,
      decidable: true,
      reason: "Documento borroso",
      status: "manual_review",
      inReviewSince: "2026-11-01T12:00:00.000Z",
      resolvedAt: null,
    });

    const missing = await t.detail("no-existe");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("KYC_SESSION_NOT_FOUND");
  });

  it("las lecturas exigen el rol admin", async () => {
    const t = await setup();

    const response = await app!.inject({ method: "GET", url: "/admin/kyc/reviews", headers: { "x-user-id": t.me.id } });

    expect(response.statusCode).toBe(403);
  });

  it("aprobar: delega en svc-users y deja una fila kyc.approve con solo ids", async () => {
    const t = await setup();

    const response = await t.decide(t.first.sessionId, { decision: "approved", reason: "Documento y rostro coinciden" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ sessionId: t.first.sessionId, userId: t.user.id, status: "approved" });
    expect(t.decisions).toEqual([
      { sessionId: t.first.sessionId, decision: "approved", reason: "Documento y rostro coinciden", actorId: t.me.id },
    ]);
    const [row] = await t.rows();
    expect(row).toMatchObject({
      adminId: t.me.id,
      action: "kyc.approve",
      targetType: "user",
      outcome: "succeeded",
      reason: "Documento y rostro coinciden",
    });
    expect(row?.context).toEqual({ sessionId: t.first.sessionId, verificationType: "identity" });
  });

  it("aprobar con el nombre corregido lo manda a svc-users y la bitácora solo anota que se corrigió, sin el nombre", async () => {
    const t = await setup();

    const response = await t.decide(t.first.sessionId, {
      decision: "approved",
      reason: "Documento y rostro coinciden",
      firstName: "Julia María",
      lastName: "Pérez Gómez",
    });

    expect(response.statusCode).toBe(200);
    expect(t.decisions[0]).toMatchObject({ decision: "approved", firstName: "Julia María", lastName: "Pérez Gómez" });
    const [row] = await t.rows();
    expect(row?.context).toEqual({ sessionId: t.first.sessionId, verificationType: "identity", nameCorrected: true });
    expect(JSON.stringify(row)).not.toContain("Pérez");
  });

  it.each([
    ["solo el nombre", { decision: "approved", firstName: "Julia" }],
    ["al rechazar", { decision: "rejected", firstName: "Julia", lastName: "Pérez" }],
  ])("rechaza con 400 corregir el nombre: %s", async (_caso, extra) => {
    const t = await setup();

    const response = await t.decide(t.first.sessionId, { reason: "Documento y rostro coinciden", ...extra });

    expect(response.statusCode).toBe(400);
    expect(t.decisions).toHaveLength(0);
  });

  it("corregir el nombre en una verificación de licencia es 400 y no deja una corrección en la bitácora", async () => {
    const t = await setup({ reviews: (userId) => [review(userId, { verificationType: "license" })] });

    const response = await t.decide(t.first.sessionId, {
      decision: "approved",
      reason: "Carnet vigente y legible",
      firstName: "Julia",
      lastName: "Pérez",
    });

    expect(response.statusCode).toBe(400);
    expect(t.decisions).toHaveLength(0);
    expect((await t.rows()).some((row) => JSON.stringify(row.context).includes("nameCorrected"))).toBe(false);
  });

  it("rechazar deja una fila kyc.decline", async () => {
    const t = await setup();

    const response = await t.decide(t.first.sessionId, { decision: "rejected", reason: "El documento está vencido" });

    expect(response.statusCode).toBe(200);
    expect((await t.rows())[0]).toMatchObject({ action: "kyc.decline", outcome: "succeeded" });
  });

  it("un reintento recibe 409 y no vuelve a decidir; queda una fila failed", async () => {
    const t = await setup();
    await t.decide(t.first.sessionId, { decision: "approved", reason: "Documento y rostro coinciden" });

    const again = await t.decide(t.first.sessionId, { decision: "approved", reason: "Documento y rostro coinciden" });

    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("KYC_REVIEW_STATUS_CHANGED");
    expect(t.decisions).toHaveLength(1);
    const rows = await t.rows();
    expect(rows.map((row) => row.outcome)).toEqual(["succeeded", "failed"]);
    expect(rows[1]?.errorCode).toBe("KYC_REVIEW_STATUS_CHANGED");
  });

  it("si Didit rechaza el pedido (502 KYC_PROVIDER_ERROR) la fila es failed, no unknown", async () => {
    const t = await setup({ decideError: new ApiError(502, "KYC_PROVIDER_ERROR", "Didit rechazó el pedido.") });

    const response = await t.decide(t.first.sessionId, { decision: "approved", reason: "Documento y rostro coinciden" });

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("KYC_PROVIDER_ERROR");
    expect((await t.rows())[0]).toMatchObject({ outcome: "failed", errorCode: "KYC_PROVIDER_ERROR" });
  });

  it("si Didit no confirmó (svc-users responde 502 sin código conocido), la fila es unknown y no failed", async () => {
    const t = await setup({ decideError: new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "El servicio de usuarios devolvió un error.") });

    const response = await t.decide(t.first.sessionId, { decision: "approved", reason: "Documento y rostro coinciden" });

    expect(response.statusCode).toBe(502);
    expect((await t.rows())[0]).toMatchObject({ outcome: "unknown", errorCode: "USERS_SERVICE_UNAVAILABLE" });
  });

  it("otro admin decidiendo el mismo caso: 409 KYC_REVIEW_IN_PROGRESS con fila failed", async () => {
    const t = await setup({ decideError: new ApiError(409, "KYC_REVIEW_IN_PROGRESS", "Otro admin está decidiendo.") });

    const response = await t.decide(t.first.sessionId, { decision: "approved", reason: "Documento y rostro coinciden" });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("KYC_REVIEW_IN_PROGRESS");
    expect((await t.rows())[0]).toMatchObject({ outcome: "failed", errorCode: "KYC_REVIEW_IN_PROGRESS" });
  });

  it("el 409 de una sesión que Didit ya tenía resuelta conserva details.status", async () => {
    const t = await setup({
      decideError: new ApiError(409, "KYC_REVIEW_STATUS_CHANGED", "Didit ya la tenía resuelta.", { status: "rejected" }),
    });

    const response = await t.decide(t.first.sessionId, { decision: "approved", reason: "Documento y rostro coinciden" });

    expect(response.json().error).toMatchObject({ code: "KYC_REVIEW_STATUS_CHANGED", details: { status: "rejected" } });
  });

  it("un admin no puede decidir su propio KYC (conflicto de interés) y no se llama a svc-users", async () => {
    const t = await setup({ reviews: () => [] });
    // El caso es del propio admin: se arma con su id como usuario.
    const own = review(t.me.id);
    t.reviews.push(own);

    const response = await t.decide(own.sessionId, { decision: "approved", reason: "Documento y rostro coinciden" });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("ADMIN_CONFLICT_OF_INTEREST");
    expect(t.decisions).toHaveLength(0);
  });

  it("valida el motivo (corto o vacío) y la decisión (400)", async () => {
    const t = await setup();

    expect((await t.decide(t.first.sessionId, { decision: "approved", reason: "corto" })).statusCode).toBe(400);
    expect((await t.decide(t.first.sessionId, { decision: "approved", reason: "          " })).statusCode).toBe(400);
    expect((await t.decide(t.first.sessionId, { decision: "maybe", reason: "Motivo suficiente" })).statusCode).toBe(400);
    expect(t.decisions).toHaveLength(0);
  });

  it("404 si la sesión no existe, sin fila de bitácora", async () => {
    const t = await setup();

    const response = await t.decide("no-existe", { decision: "approved", reason: "Motivo suficiente" });

    expect(response.statusCode).toBe(404);
    expect(await t.rows()).toHaveLength(0);
  });

  describe("detalle de Didit (evidence)", () => {
    it("devuelve todo lo que mapea svc-users, sin caché, y sin bitácora (es una lectura)", async () => {
      const t = await setup();

      const response = await t.evidence(t.first.sessionId);

      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      const body = response.json();
      expect(body.images.selfie).toBe("https://didit.test/selfie.jpg?sig=1");
      expect(body.document).toMatchObject({ number: "45346504", issuingCountry: "Argentina", age: 22 });
      expect(body.faceMatch).toEqual({ status: "Approved", score: 97 });
      expect(body.warnings).toEqual([{ feature: "ID_VERIFICATION", risk: "X", description: "Documento borroso" }]);
      expect(await t.rows()).toHaveLength(0);
    });

    it("exige el rol admin", async () => {
      const t = await setup();

      const response = await t.evidence(t.first.sessionId, { "x-user-id": t.me.id });

      expect(response.statusCode).toBe(403);
    });

    it("404 si la sesión no existe, 422 si Didit no tiene detalle, 502 si Didit no responde", async () => {
      const missing = await setup();
      expect((await missing.evidence("no-existe")).statusCode).toBe(404);
      await app?.close();

      const noDetail = await setup({ evidenceFor: false });
      const unknown = await noDetail.evidence(noDetail.first.sessionId);
      expect(unknown.statusCode).toBe(422);
      expect(unknown.json().error.code).toBe("KYC_EVIDENCE_NOT_FOUND");
      await app?.close();

      const down = await setup({ evidenceError: new ApiError(502, "KYC_PROVIDER_ERROR", "Didit no responde.") });
      const failed = await down.evidence(down.first.sessionId);
      expect(failed.statusCode).toBe(502);
      expect(failed.json().error.code).toBe("KYC_PROVIDER_ERROR");
    });
  });
});
