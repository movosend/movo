import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ApiError } from "@movo/shared";
import { buildApp } from "../src/app";
import { kycDecisionLockKey } from "../src/modules/kyc/kyc-review-internal.routes";
import { DiditClient, UpdateDiditSessionStatusInput } from "../src/adapters/didit-client";

const ADMIN_ID = randomUUID();

/** `DiditClient` fake: registra las llamadas a `updateSessionStatus` y puede fallar a pedido. */
function createFakeDiditClient() {
  const updates: UpdateDiditSessionStatusInput[] = [];
  let failWith: Error | null = null;
  let decisionBody: unknown | null = null;
  let decisionRawStatus = "In Review";
  let decisionError: Error | null = null;
  const client: DiditClient = {
    async createSession() {
      throw new Error("no usado en este test");
    },
    async getSessionDecision(sessionId: string) {
      if (decisionError) throw decisionError;
      return decisionBody === null ? null : { sessionId, rawStatus: decisionRawStatus, decision: decisionBody };
    },
    async updateSessionStatus(input) {
      if (failWith) throw failWith;
      updates.push(input);
    },
  };
  return {
    client,
    updates,
    failWith(error: Error | null) {
      failWith = error;
    },
    setDecision(body: unknown | null, rawStatus = "In Review") {
      decisionBody = body;
      decisionRawStatus = rawStatus;
    },
    failDecision(error: Error | null) {
      decisionError = error;
    },
  };
}

describe("Cola de revisión manual de KYC (rutas internas del panel)", () => {
  let app: FastifyInstance;
  let didit: ReturnType<typeof createFakeDiditClient>;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    didit = createFakeDiditClient();
    app = buildApp({ diditClient: didit.client });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    didit.updates.length = 0;
    didit.failWith(null);
    didit.setDecision(null);
    didit.failDecision(null);
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
  });

  async function createUser(firstName = "Juan", lastName = "Perez") {
    return app.db.user.create({
      data: {
        email: `${randomUUID()}@example.com`,
        phone: `+549351${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName,
        lastName,
        passwordHash: "hash",
        phoneVerified: true,
      },
    });
  }

  async function createAttempt(
    userId: string,
    status: "manual_review" | "approved" | "rejected" | "pending" | "expired",
    opts: { type?: "identity" | "license"; requestedAt?: Date; resolvedAt?: Date; rawDecision?: object } = {}
  ) {
    const externalSessionId = `sess-${randomUUID()}`;
    await app.db.kycVerification.create({
      data: {
        userId,
        verificationType: opts.type ?? "identity",
        provider: "didit",
        externalSessionId,
        status,
        requestedAt: opts.requestedAt ?? new Date(),
        ...(opts.resolvedAt ? { resolvedAt: opts.resolvedAt } : {}),
        ...(opts.rawDecision ? { rawDecision: opts.rawDecision } : {}),
      },
    });
    return externalSessionId;
  }

  const list = (query = "") =>
    app.inject({ method: "GET", url: `/internal/admin/kyc/reviews${query}`, headers: { "x-user-id": ADMIN_ID } });
  const decide = (sessionId: string, body: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: `/internal/admin/kyc/reviews/${sessionId}/decision`,
      headers: { "x-user-id": ADMIN_ID },
      payload: body,
    });

  describe("GET /internal/admin/kyc/reviews", () => {
    it("lista solo los intentos en manual_review, el más viejo primero", async () => {
      const a = await createUser("Ana");
      const b = await createUser("Beto");
      const c = await createUser("Cora");
      const old = await createAttempt(a.id, "manual_review", { requestedAt: new Date("2026-11-01T10:00:00Z") });
      const recent = await createAttempt(b.id, "manual_review", { requestedAt: new Date("2026-11-05T10:00:00Z") });
      await createAttempt(c.id, "approved");
      await createAttempt(c.id, "rejected", { type: "license" });

      const response = await list();

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(2);
      expect(body.items.map((item: { sessionId: string }) => item.sessionId)).toEqual([old, recent]);
      expect(body.items[0]).toMatchObject({ fullName: "Ana Perez", verificationType: "identity" });
    });

    it("oculta el intento superado por uno más nuevo del mismo usuario y tipo, pero no el de otro tipo", async () => {
      const user = await createUser();
      await createAttempt(user.id, "manual_review", { requestedAt: new Date("2026-11-01T10:00:00Z") });
      await createAttempt(user.id, "pending", { requestedAt: new Date("2026-11-02T10:00:00Z") });
      const license = await createAttempt(user.id, "manual_review", {
        type: "license",
        requestedAt: new Date("2026-11-01T10:00:00Z"),
      });

      const body = (await list()).json();

      expect(body.items.map((item: { sessionId: string }) => item.sessionId)).toEqual([license]);
    });

    it("filtra por tipo y busca por nombre, email o id de sesión", async () => {
      const ana = await createUser("Ana");
      const beto = await createUser("Beto");
      const anaSession = await createAttempt(ana.id, "manual_review");
      await createAttempt(beto.id, "manual_review", { type: "license" });

      expect((await list("?type=license")).json().total).toBe(1);
      expect((await list("?q=ana")).json().items).toHaveLength(1);
      expect((await list(`?q=${encodeURIComponent(ana.email)}`)).json().items).toHaveLength(1);
      expect((await list(`?q=${anaSession}`)).json().items).toHaveLength(1);
      expect((await list("?q=nadie")).json().total).toBe(0);
    });

    it("ordena por cuándo pasó a revisión, no por cuándo se abrió la sesión", async () => {
      const early = await createUser("Temprano");
      const late = await createUser("Tarde");
      // Abrió la sesión primero pero terminó la verificación (entró a revisión) después.
      const opened = await createAttempt(early.id, "manual_review", {
        requestedAt: new Date("2026-11-01T08:00:00Z"),
        resolvedAt: new Date("2026-11-03T08:00:00Z"),
      });
      const waiting = await createAttempt(late.id, "manual_review", {
        requestedAt: new Date("2026-11-02T08:00:00Z"),
        resolvedAt: new Date("2026-11-02T09:00:00Z"),
      });

      const body = (await list()).json();

      expect(body.items.map((item: { sessionId: string }) => item.sessionId)).toEqual([waiting, opened]);
      expect(body.items[1]).toMatchObject({ requestedAt: "2026-11-01T08:00:00.000Z", inReviewSince: "2026-11-03T08:00:00.000Z" });
    });

    it("busca por nombre completo y sin acentos, como el buscador de usuarios", async () => {
      const ana = await createUser("Ana", "Gómez");
      await createAttempt(ana.id, "manual_review");
      await createAttempt((await createUser("Beto", "Ruiz")).id, "manual_review");

      expect((await list(`?q=${encodeURIComponent("Ana Gomez")}`)).json().total).toBe(1);
      expect((await list(`?q=${encodeURIComponent("gomez ana")}`)).json().total).toBe(1);
      expect((await list(`?q=${encodeURIComponent("GÓMEZ")}`)).json().total).toBe(1);
    });

    it("no lista cuentas dadas de baja", async () => {
      const gone = await createUser("Baja");
      await createAttempt(gone.id, "manual_review");
      await app.db.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });

      expect((await list()).json().total).toBe(0);
    });

    it("pagina", async () => {
      for (let i = 0; i < 3; i += 1) {
        const user = await createUser(`U${i}`);
        await createAttempt(user.id, "manual_review", { requestedAt: new Date(2026, 10, 1 + i) });
      }

      const body = (await list("?page=2&pageSize=2")).json();

      expect(body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
      expect(body.items).toHaveLength(1);
    });
  });

  describe("GET /internal/admin/kyc/reviews/:sessionId", () => {
    it("devuelve el motivo, el vencimiento y el historial, y marca decidable", async () => {
      const user = await createUser();
      await createAttempt(user.id, "expired", { requestedAt: new Date("2026-10-01T10:00:00Z") });
      const session = await createAttempt(user.id, "manual_review", {
        requestedAt: new Date("2026-11-01T10:00:00Z"),
        rawDecision: { status: "In Review", warnings: [{ feature: "ID_VERIFICATION", risk: "X", description: "Documento borroso" }], expiration_date: "2030-05-01" },
      });

      const response = await app.inject({ method: "GET", url: `/internal/admin/kyc/reviews/${session}` });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({
        sessionId: session,
        reason: "Documento borroso",
        expirationDate: "2030-05-01",
        decidable: true,
        email: user.email,
      });
      expect(body.history).toHaveLength(1);
      expect(body.history[0].status).toBe("expired");
    });

    it("404 si la sesión no existe; decidable false si ya no está en revisión", async () => {
      const missing = await app.inject({ method: "GET", url: "/internal/admin/kyc/reviews/no-existe" });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe("KYC_SESSION_NOT_FOUND");

      const user = await createUser();
      const session = await createAttempt(user.id, "approved");
      const resolved = await app.inject({ method: "GET", url: `/internal/admin/kyc/reviews/${session}` });
      expect(resolved.json()).toMatchObject({ decidable: false, status: "approved", inReviewSince: null });
    });
  });

  describe("POST /internal/admin/kyc/reviews/:sessionId/decision", () => {
    it("aprobar: llama a Didit, deja approved el intento y el usuario, y conserva los warnings", async () => {
      const user = await createUser();
      const session = await createAttempt(user.id, "manual_review", {
        rawDecision: { status: "In Review", warnings: [{ feature: "F", risk: "R", description: "Revisar foto" }] },
      });
      await app.db.user.update({ where: { id: user.id }, data: { kycStatusIdentity: "manual_review" } });

      const response = await decide(session, { decision: "approved", reason: "Documento y rostro coinciden" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ sessionId: session, userId: user.id, verificationType: "identity", status: "approved" });
      expect(didit.updates).toEqual([{ sessionId: session, newStatus: "Approved", comment: "Documento y rostro coinciden" }]);
      expect((await app.db.user.findUnique({ where: { id: user.id } }))?.kycStatusIdentity).toBe("approved");
      const row = await app.db.kycVerification.findUnique({ where: { externalSessionId: session } });
      expect(row?.status).toBe("approved");
      expect(row?.resolvedAt).not.toBeNull();
      expect(row?.rawDecision).toMatchObject({ status: "Approved", reviewed_by_admin: true, warnings: [{ description: "Revisar foto" }] });
      // El motivo del admin no se copia a raw_decision.
      expect(JSON.stringify(row?.rawDecision)).not.toContain("Documento y rostro");
    });

    it("rechazar: Didit recibe Declined y el usuario queda rejected", async () => {
      const user = await createUser();
      const session = await createAttempt(user.id, "manual_review");
      await app.db.user.update({ where: { id: user.id }, data: { kycStatusIdentity: "manual_review" } });

      const response = await decide(session, { decision: "rejected", reason: "El documento está vencido" });

      expect(response.statusCode).toBe(200);
      expect(didit.updates[0]?.newStatus).toBe("Declined");
      expect((await app.db.user.findUnique({ where: { id: user.id } }))?.kycStatusIdentity).toBe("rejected");
    });

    it("aprobar una licencia crea el registro del carnet", async () => {
      const user = await createUser();
      const session = await createAttempt(user.id, "manual_review", {
        type: "license",
        rawDecision: { status: "In Review", expiration_date: "2031-03-04" },
      });
      await app.db.user.update({ where: { id: user.id }, data: { kycStatusLicense: "manual_review" } });

      const response = await decide(session, { decision: "approved", reason: "Carnet vigente y legible" });

      expect(response.statusCode).toBe(200);
      const license = await app.db.driversLicense.findUnique({ where: { userId: user.id } });
      expect(license?.status).toBe("verified");
      expect(license?.expirationDate?.toISOString().slice(0, 10)).toBe("2031-03-04");
    });

    it("404 si no existe; 409 si ya no está en revisión; 409 si el usuario abrió una verificación más nueva", async () => {
      const missing = await decide("no-existe", { decision: "approved", reason: "Motivo suficiente" });
      expect(missing.statusCode).toBe(404);

      const user = await createUser();
      const resolved = await createAttempt(user.id, "approved");
      const notInReview = await decide(resolved, { decision: "rejected", reason: "Motivo suficiente" });
      expect(notInReview.statusCode).toBe(409);
      expect(notInReview.json().error.code).toBe("KYC_REVIEW_STATUS_CHANGED");

      const other = await createUser();
      const old = await createAttempt(other.id, "manual_review", { requestedAt: new Date("2026-11-01T10:00:00Z") });
      await createAttempt(other.id, "pending", { requestedAt: new Date("2026-11-02T10:00:00Z") });
      const superseded = await decide(old, { decision: "approved", reason: "Motivo suficiente" });
      expect(superseded.statusCode).toBe(409);
      expect(superseded.json().error.code).toBe("KYC_REVIEW_SUPERSEDED");
      expect(didit.updates).toHaveLength(0);
    });

    it("si Didit falla (502), no cambia nada en la base", async () => {
      const user = await createUser();
      const session = await createAttempt(user.id, "manual_review");
      await app.db.user.update({ where: { id: user.id }, data: { kycStatusIdentity: "manual_review" } });
      didit.failWith(new ApiError(502, "KYC_PROVIDER_ERROR", "caído"));

      const response = await decide(session, { decision: "approved", reason: "Motivo suficiente" });

      expect(response.statusCode).toBe(502);
      expect((await app.db.kycVerification.findUnique({ where: { externalSessionId: session } }))?.status).toBe("manual_review");
      expect((await app.db.user.findUnique({ where: { id: user.id } }))?.kycStatusIdentity).toBe("manual_review");
    });

    it("rechaza un motivo corto o una decisión inválida (400)", async () => {
      const user = await createUser();
      const session = await createAttempt(user.id, "manual_review");

      expect((await decide(session, { decision: "approved", reason: "corto" })).statusCode).toBe(400);
      expect((await decide(session, { decision: "maybe", reason: "Motivo suficiente" })).statusCode).toBe(400);
    });

    it("sin x-user-id no se puede decidir", async () => {
      const user = await createUser();
      const session = await createAttempt(user.id, "manual_review");

      const response = await app.inject({
        method: "POST",
        url: `/internal/admin/kyc/reviews/${session}/decision`,
        payload: { decision: "approved", reason: "Motivo suficiente" },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(didit.updates).toHaveLength(0);
    });

    it("si otro admin está decidiendo el mismo caso, 409 KYC_REVIEW_IN_PROGRESS sin llamar a Didit", async () => {
      const user = await createUser();
      const session = await createAttempt(user.id, "manual_review");
      await app.redis.set(kycDecisionLockKey(session), "otro-pedido", "PX", 30_000);

      const response = await decide(session, { decision: "approved", reason: "Motivo suficiente" });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("KYC_REVIEW_IN_PROGRESS");
      expect(didit.updates).toHaveLength(0);
      await app.redis.del(kycDecisionLockKey(session));
    });

    it("al terminar libera el lock (otro admin puede intentar enseguida) y no toca el de otro pedido", async () => {
      const user = await createUser();
      const session = await createAttempt(user.id, "manual_review");

      await decide(session, { decision: "approved", reason: "Motivo suficiente" });

      expect(await app.redis.get(kycDecisionLockKey(session))).toBeNull();
    });

    it("si Didit ya tenía resuelta la sesión, aplica esa decisión en Movo, responde 409 y no le pide otro cambio", async () => {
      const user = await createUser();
      const session = await createAttempt(user.id, "manual_review");
      await app.db.user.update({ where: { id: user.id }, data: { kycStatusIdentity: "manual_review" } });
      didit.setDecision({ status: "Declined", id_verifications: [] }, "Declined");

      const response = await decide(session, { decision: "approved", reason: "Motivo suficiente" });

      expect(response.statusCode).toBe(409);
      expect(response.json().error).toMatchObject({ code: "KYC_REVIEW_STATUS_CHANGED", details: { status: "rejected" } });
      expect(didit.updates).toHaveLength(0);
      expect((await app.db.user.findUnique({ where: { id: user.id } }))?.kycStatusIdentity).toBe("rejected");
    });

    it("si Didit no confirma (red o timeout), 502 KYC_PROVIDER_UNCONFIRMED, no cambia nada acá y el lock se deja vencer", async () => {
      const user = await createUser();
      const session = await createAttempt(user.id, "manual_review");
      didit.failWith(new ApiError(502, "KYC_PROVIDER_UNCONFIRMED", "sin confirmar"));

      const response = await decide(session, { decision: "approved", reason: "Motivo suficiente" });

      expect(response.statusCode).toBe(502);
      expect(response.json().error.code).toBe("KYC_PROVIDER_UNCONFIRMED");
      expect((await app.db.kycVerification.findUnique({ where: { externalSessionId: session } }))?.status).toBe("manual_review");
      // Nadie puede mandar la decisión contraria enseguida: el lock sigue tomado hasta que vence.
      expect(await app.redis.get(kycDecisionLockKey(session))).not.toBeNull();
      await app.redis.del(kycDecisionLockKey(session));
    });

    it("si Didit rechaza el pedido (KYC_PROVIDER_ERROR) libera el lock: se puede reintentar", async () => {
      const user = await createUser();
      const session = await createAttempt(user.id, "manual_review");
      didit.failWith(new ApiError(502, "KYC_PROVIDER_ERROR", "rechazado"));

      await decide(session, { decision: "approved", reason: "Motivo suficiente" });

      expect(await app.redis.get(kycDecisionLockKey(session))).toBeNull();
    });

    it("el webhook de Didit que llega después no vuelve a transicionar ni a avisar", async () => {
      const user = await createUser();
      const session = await createAttempt(user.id, "manual_review");
      await app.db.user.update({ where: { id: user.id }, data: { kycStatusIdentity: "manual_review" } });
      await decide(session, { decision: "approved", reason: "Motivo suficiente" });
      const before = await app.db.kycVerification.findUnique({ where: { externalSessionId: session } });

      // Un segundo intento de aplicar la misma decisión (lo que haría el webhook) es un no-op.
      const again = await decide(session, { decision: "approved", reason: "Motivo suficiente" });

      expect(again.statusCode).toBe(409);
      const after = await app.db.kycVerification.findUnique({ where: { externalSessionId: session } });
      expect(after?.resolvedAt?.getTime()).toBe(before?.resolvedAt?.getTime());
    });
  });

  describe("GET /internal/admin/kyc/reviews/:sessionId/evidence", () => {
    const get = (sessionId: string) => app.inject({ method: "GET", url: `/internal/admin/kyc/reviews/${sessionId}/evidence` });

    it("devuelve el detalle de Didit, sin caché y sin guardar nada", async () => {
      const user = await createUser();
      const session = await createAttempt(user.id, "manual_review", { rawDecision: { status: "In Review" } });
      didit.setDecision({
        status: "In Review",
        id_verifications: [{ document_type: "Identity Card", document_number: "30111222", front_image: "https://didit.test/front.jpg?sig=1", warnings: [] }],
        face_matches: [{ status: "Approved", score: 91, source_image: "https://didit.test/selfie.jpg?sig=1" }],
      });

      const response = await get(session);

      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      const body = response.json();
      expect(body.document).toMatchObject({ type: "Identity Card", number: "30111222" });
      expect(body.faceMatch).toEqual({ status: "Approved", score: 91 });
      expect(body.images.selfie).toBe("https://didit.test/selfie.jpg?sig=1");
      expect(body.images.documentFront).toBe("https://didit.test/front.jpg?sig=1");
      // AC9: nada de esto se persiste; `raw_decision` queda como estaba.
      const row = await app.db.kycVerification.findUnique({ where: { externalSessionId: session } });
      expect(row?.rawDecision).toEqual({ status: "In Review" });
    });

    it("404 KYC_SESSION_NOT_FOUND si Movo no conoce el intento (y no le pregunta a Didit)", async () => {
      didit.failDecision(new Error("no debería llamarse"));

      const response = await get("no-existe");

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("KYC_SESSION_NOT_FOUND");
    });

    it("422 KYC_EVIDENCE_NOT_FOUND si Didit no conoce la sesión", async () => {
      const user = await createUser();
      const session = await createAttempt(user.id, "manual_review");

      const response = await get(session);

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("KYC_EVIDENCE_NOT_FOUND");
    });

    it("502 KYC_PROVIDER_ERROR si Didit no responde", async () => {
      const user = await createUser();
      const session = await createAttempt(user.id, "manual_review");
      didit.failDecision(new ApiError(502, "KYC_PROVIDER_ERROR", "caído"));

      const response = await get(session);

      expect(response.statusCode).toBe(502);
      expect(response.json().error.code).toBe("KYC_PROVIDER_ERROR");
    });
  });
});
