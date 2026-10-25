import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import {
  AdminDisputeDetail,
  AdminDisputePage,
  AdminDisputeResolutionPreview,
  AdminUserProfile,
  ApiError,
  DisputeStatus,
  InternalResolveDisputeRequest,
  ShipmentParties,
} from "@movo/shared";
import { buildApp } from "../src/app";
import { createFakePaymentsClient, createFakeShipmentsClient, createFakeUsersClient } from "./fake-clients";

/**
 * MOVO-337: disputas en el panel. Lecturas por bloque, notas internas y `POST /admin/disputes/:id/resolve` con la
 * regla de conflicto de interés, la bitácora y el mínimo de la captura parcial (AC6). La resolución en sí
 * (matriz de pago, estado final, idempotencia) se prueba en `svc-shipments`.
 */

const REASONING = "Revisamos las fotos, el handshake y el chat de las partes";
const sender = { id: randomUUID(), name: "Ana Emisora" };
const carrier = { id: randomUUID(), name: "Carlos Transportista" };
const receiver = { id: randomUUID(), name: "Rosa Receptora" };

const baseRow = (disputeId: string, shipmentId: string, status: DisputeStatus = DisputeStatus.OPEN) => ({
  id: disputeId,
  shipmentId,
  shipmentCode: "MOVO-12345",
  status,
  reason: "damaged" as const,
  openedByRole: "sender" as const,
  openedAt: new Date().toISOString(),
  shipmentStatusAtOpen: "in_transit",
  shipmentStatus: "disputed",
  sender,
  carrier,
  receiver,
  outcome: null,
});

const PREVIEW: AdminDisputeResolutionPreview = {
  statusAtOpen: "in_transit",
  stakeArs: 1150,
  minimumPartialArs: 157.4,
  outcomes: [
    { outcome: "sender", paymentAction: "release_hold", shipmentStatus: "cancelled" },
    { outcome: "carrier", paymentAction: "capture_hold", shipmentStatus: "completed" },
    { outcome: "partial", paymentAction: "capture_partial", shipmentStatus: "completed" },
  ],
  presets: [
    { percentage: 25, carrierAmountArs: 287.5, senderAmountArs: 862.5, belowMinimum: false },
    { percentage: 50, carrierAmountArs: 575, senderAmountArs: 575, belowMinimum: false },
    { percentage: 75, carrierAmountArs: 862.5, senderAmountArs: 287.5, belowMinimum: false },
  ],
};

describe("Disputas en el panel (MOVO-337)", () => {
  let app: FastifyInstance;

  afterAll(async () => {
    await app?.close();
  });

  interface Scenario {
    adminId: string;
    disputeId: string;
    shipmentId: string;
    calls: InternalResolveDisputeRequest[];
    headers: Record<string, string>;
    seen: { list?: string };
  }

  async function setup(
    opts: {
      adminIsParty?: boolean;
      status?: DisputeStatus;
      preview?: AdminDisputeResolutionPreview;
      resolveError?: ApiError;
      resolveUnavailable?: boolean;
      noAdminProfile?: boolean;
      noDispute?: boolean;
    } = {},
  ): Promise<Scenario> {
    const adminId = randomUUID();
    const disputeId = randomUUID();
    const shipmentId = randomUUID();
    const calls: InternalResolveDisputeRequest[] = [];
    const seen: Scenario["seen"] = {};
    const parties: ShipmentParties & { shipmentId: string } = {
      shipmentId,
      senderId: opts.adminIsParty ? adminId : sender.id,
      carrierId: carrier.id,
      receiverId: receiver.id,
      formerReceiverIds: [],
    };
    const detail: AdminDisputeDetail = {
      ...baseRow(disputeId, shipmentId, opts.status),
      description: "El paquete llegó roto",
      photos: [],
      statements: [],
      resolution: null,
    };
    const page: AdminDisputePage = {
      items: [baseRow(disputeId, shipmentId, opts.status)],
      nextCursor: null,
      statusCounts: { open: 1, resolving: 0, resolved: 0 },
    };

    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    await app?.close();
    app = buildApp({
      shipmentsClient: createFakeShipmentsClient({
        photos: { [shipmentId]: [{ id: randomUUID(), stage: "pickup", url: "https://s3/foto.jpg", createdAt: new Date().toISOString() }] as never },
        disputes: {
          page,
          seen,
          ...(opts.noDispute
            ? {}
            : {
                details: { [disputeId]: detail },
                parties: { [disputeId]: parties },
                previews: { [disputeId]: opts.preview ?? PREVIEW },
              }),
          resolve: { calls, error: opts.resolveError, unavailable: opts.resolveUnavailable },
        },
      }),
      usersClient: createFakeUsersClient({
        profiles: opts.noAdminProfile ? [] : [{ id: adminId, fullName: "Lucía Admin" } as unknown as AdminUserProfile],
      }),
      paymentsClient: createFakePaymentsClient(),
    });
    await app.ready();
    return { adminId, disputeId, shipmentId, calls, seen, headers: { "x-user-id": adminId, "x-user-roles": "admin" } };
  }

  const resolve = (s: Scenario, payload: Record<string, unknown>, headers = s.headers) =>
    app.inject({ method: "POST", url: `/admin/disputes/${s.disputeId}/resolve`, headers, payload: { reasoning: REASONING, ...payload } });

  const auditRows = (s: Scenario, action: string) =>
    app.db.auditLog.findMany({ where: { targetId: s.disputeId, action }, orderBy: { createdAt: "asc" } });

  describe("lecturas", () => {
    it("exigen el rol admin", async () => {
      const s = await setup();
      const response = await app.inject({ method: "GET", url: "/admin/disputes", headers: { "x-user-id": s.adminId, "x-user-roles": "user" } });
      expect(response.statusCode).toBe(403);
    });

    it("el listado reenvía los filtros y trae partes, motivo, apertura, estado al abrirse y conteos", async () => {
      const s = await setup();

      const response = await app.inject({
        method: "GET",
        url: "/admin/disputes?status=open&reason=damaged&q=Ana&limit=10",
        headers: s.headers,
      });

      expect(response.statusCode).toBe(200);
      expect(s.seen.list).toBe("status=open&reason=damaged&q=Ana&limit=10");
      const page = response.json();
      expect(page.statusCounts).toEqual({ open: 1, resolving: 0, resolved: 0 });
      expect(page.items[0]).toMatchObject({
        id: s.disputeId,
        reason: "damaged",
        shipmentStatusAtOpen: "in_transit",
        sender: { name: "Ana Emisora" },
        carrier: { name: "Carlos Transportista" },
      });
      // Sin lectura de bitácora: las lecturas no la escriben.
      expect(await auditRows(s, "dispute.resolve")).toHaveLength(0);
    });

    it("rechaza un estado que no existe", async () => {
      const s = await setup();
      const response = await app.inject({ method: "GET", url: "/admin/disputes?status=cerrada", headers: s.headers });
      expect(response.statusCode).toBe(400);
    });

    it("el expediente y cada bloque tienen su ruta, y una disputa inexistente es 404", async () => {
      const s = await setup();
      const get = (path: string) => app.inject({ method: "GET", url: `/admin/disputes/${s.disputeId}${path}`, headers: s.headers });

      expect((await get("")).json()).toMatchObject({ id: s.disputeId, description: "El paquete llegó roto", resolution: null });
      expect((await get("/photos")).json()).toHaveLength(1);
      expect((await get("/handshake")).json()).toEqual([]);
      const trace = await get("/trace");
      expect(trace.json()).toEqual({ available: false, points: [] });
      expect(trace.headers["cache-control"]).toBe("no-store");
      expect((await get("/resolution-preview")).json()).toMatchObject({ stakeArs: 1150, minimumPartialArs: 157.4 });

      const other = await app.inject({ method: "GET", url: `/admin/disputes/${randomUUID()}`, headers: s.headers });
      expect(other.statusCode).toBe(404);
      expect(other.json().error.code).toBe("DISPUTE_NOT_FOUND");
    });
  });

  describe("notas internas (AC3)", () => {
    it("se agregan con bitácora, se listan con el nombre del admin y nunca se mezclan con el expediente", async () => {
      const s = await setup();

      const created = await app.inject({
        method: "POST",
        url: `/admin/disputes/${s.disputeId}/notes`,
        headers: s.headers,
        payload: { body: "Llamé al emisor, confirma que el paquete llegó roto" },
      });

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ disputeId: s.disputeId, adminId: s.adminId, adminName: "Lucía Admin" });
      const [row] = await auditRows(s, "dispute.note_add");
      expect(row).toMatchObject({ adminId: s.adminId, targetType: "dispute", outcome: "succeeded" });

      const list = await app.inject({ method: "GET", url: `/admin/disputes/${s.disputeId}/notes`, headers: s.headers });
      expect(list.json().items).toHaveLength(1);
      expect(list.json().items[0].body).toContain("Llamé al emisor");
      expect(JSON.stringify((await app.inject({ method: "GET", url: `/admin/disputes/${s.disputeId}`, headers: s.headers })).json())).not.toContain(
        "Llamé al emisor",
      );
    });

    it("un admin que es parte del envío recibe 403 y queda la fila failed", async () => {
      const s = await setup({ adminIsParty: true });
      const response = await app.inject({
        method: "POST",
        url: `/admin/disputes/${s.disputeId}/notes`,
        headers: s.headers,
        payload: { body: "Nota" },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("ADMIN_CONFLICT_OF_INTEREST");
      expect((await auditRows(s, "dispute.note_add"))[0]).toMatchObject({ outcome: "failed", errorCode: "ADMIN_CONFLICT_OF_INTEREST" });
    });
  });

  describe("POST /admin/disputes/:id/resolve", () => {
    it("llama a svc-shipments con el admin, su nombre y el razonamiento, y deja una fila succeeded con el resultado", async () => {
      const s = await setup();

      const response = await resolve(s, { outcome: "carrier" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ disputeId: s.disputeId, outcome: "carrier", status: "resolved", shipmentStatus: "completed", replayed: false });
      expect(s.calls).toEqual([{ outcome: "carrier", reasoning: REASONING, adminId: s.adminId, adminName: "Lucía Admin" }]);
      const [row, ...rest] = await auditRows(s, "dispute.resolve");
      expect(rest).toHaveLength(0);
      expect(row).toMatchObject({
        adminId: s.adminId,
        targetType: "dispute",
        outcome: "succeeded",
        reason: REASONING,
        context: { outcome: "carrier", paymentAction: "none", shipmentStatus: "completed", replayed: false },
      });
    });

    it("el razonamiento se guarda sin espacios sobrantes", async () => {
      const s = await setup();
      await resolve(s, { outcome: "sender", reasoning: `   ${REASONING}   ` });
      expect(s.calls[0]?.reasoning).toBe(REASONING);
    });

    it("un admin que es parte del envío recibe 403 ADMIN_CONFLICT_OF_INTEREST y no se llama a svc-shipments (AC10)", async () => {
      const s = await setup({ adminIsParty: true });

      const response = await resolve(s, { outcome: "sender" });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("ADMIN_CONFLICT_OF_INTEREST");
      expect(s.calls).toHaveLength(0);
      expect((await auditRows(s, "dispute.resolve"))[0]).toMatchObject({ outcome: "failed", errorCode: "ADMIN_CONFLICT_OF_INTEREST" });
    });

    it("una disputa inexistente es 404 y falla cerrado", async () => {
      const s = await setup({ noDispute: true });
      const response = await resolve(s, { outcome: "sender" });
      expect(response.statusCode).toBe(404);
      expect(s.calls).toHaveLength(0);
    });

    it("sin acceso a svc-shipments falla cerrado (la regla de conflicto no se puede comprobar)", async () => {
      const s = await setup();
      await app.close();
      app = buildApp({
        shipmentsClient: createFakeShipmentsClient({ down: true }),
        usersClient: createFakeUsersClient({ profiles: [{ id: s.adminId, fullName: "Lucía Admin" } as unknown as AdminUserProfile] }),
        paymentsClient: createFakePaymentsClient(),
      });
      await app.ready();
      const response = await resolve(s, { outcome: "sender" });
      expect(response.statusCode).toBe(502);
    });

    describe("resultado parcial", () => {
      it("con un porcentaje del set predefinido", async () => {
        const s = await setup();
        const response = await resolve(s, { outcome: "partial", percentage: 50 });
        expect(response.statusCode).toBe(200);
        expect(s.calls[0]).toMatchObject({ outcome: "partial", percentage: 50 });
        expect((await auditRows(s, "dispute.resolve"))[0]?.context).toMatchObject({ outcome: "partial", percentage: 50 });
      });

      it("con un monto libre", async () => {
        const s = await setup();
        const response = await resolve(s, { outcome: "partial", amountArs: 300 });
        expect(response.statusCode).toBe(200);
        expect(s.calls[0]).toMatchObject({ outcome: "partial", amountArs: 300 });
      });

      it.each([
        ["ninguno", {}],
        ["los dos", { percentage: 50, amountArs: 300 }],
      ])("con %s de porcentaje y monto es 400 DISPUTE_PARTIAL_INVALID", async (_label, extra) => {
        const s = await setup();
        const response = await resolve(s, { outcome: "partial", ...extra });
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe("DISPUTE_PARTIAL_INVALID");
        expect(s.calls).toHaveLength(0);
        expect((await auditRows(s, "dispute.resolve"))[0]).toMatchObject({ outcome: "failed", errorCode: "DISPUTE_PARTIAL_INVALID" });
      });

      it("un porcentaje fuera del set es 400 y en un resultado que no es parcial también", async () => {
        const s = await setup();
        expect((await resolve(s, { outcome: "partial", percentage: 30 })).statusCode).toBe(400);
        const response = await resolve(s, { outcome: "carrier", percentage: 50 });
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe("DISPUTE_PARTIAL_INVALID");
      });

      it("captura parcial por debajo de la comisión del hold: 422 con el mínimo y sin llamar a svc-shipments (AC6)", async () => {
        const s = await setup();

        const response = await resolve(s, { outcome: "partial", amountArs: 100 });

        expect(response.statusCode).toBe(422);
        expect(response.json().error).toMatchObject({
          code: "DISPUTE_PARTIAL_BELOW_MINIMUM",
          details: { minimumArs: 157.4, holdAmountArs: 1150 },
        });
        expect(s.calls).toHaveLength(0);
        expect((await auditRows(s, "dispute.resolve"))[0]).toMatchObject({ outcome: "failed", errorCode: "DISPUTE_PARTIAL_BELOW_MINIMUM" });
      });

      it("un porcentaje que queda por debajo del mínimo también", async () => {
        const s = await setup({
          preview: { ...PREVIEW, minimumPartialArs: 400 },
        });
        const response = await resolve(s, { outcome: "partial", percentage: 25 });
        expect(response.statusCode).toBe(422);
        expect(response.json().error.details.minimumArs).toBe(400);
      });

      it("fuera del hold sin capturar (sin mínimo) el monto no se rechaza", async () => {
        const s = await setup({ preview: { ...PREVIEW, statusAtOpen: "completed", minimumPartialArs: null } });
        const response = await resolve(s, { outcome: "partial", amountArs: 100 });
        expect(response.statusCode).toBe(200);
      });

      it("un monto libre que llega al total es 422 con el máximo", async () => {
        const s = await setup();
        const response = await resolve(s, { outcome: "partial", amountArs: 1150 });
        expect(response.statusCode).toBe(422);
        expect(response.json().error).toMatchObject({ code: "DISPUTE_PARTIAL_ABOVE_MAXIMUM", details: { maximumArs: 1149.99 } });
      });

      it("con la disputa ya en `resolving` no se revalida contra la vista previa: lo decide svc-shipments con lo guardado", async () => {
        const s = await setup({ status: DisputeStatus.RESOLVING, preview: { ...PREVIEW, minimumPartialArs: 9999 } });
        const response = await resolve(s, { outcome: "partial", percentage: 25 });
        expect(response.statusCode).toBe(200);
        expect(s.calls).toHaveLength(1);
      });
    });

    describe("rechazos y fallas de svc-shipments", () => {
      it("una falla de la acción de pago se relanza como 502 DISPUTE_PAYMENT_FAILED y la fila es failed, no unknown", async () => {
        const s = await setup({
          resolveError: new ApiError(502, "DISPUTE_PAYMENT_FAILED", "No se pudo confirmar el movimiento de dinero.", { disputeId: "x" }),
        });
        // El cliente real relaya este código (`relayServerErrorCodes`); el fake lo lanza tal cual.
        const response = await resolve(s, { outcome: "sender" });
        expect(response.statusCode).toBe(502);
        expect(response.json().error.code).toBe("DISPUTE_PAYMENT_FAILED");
        expect((await auditRows(s, "dispute.resolve"))[0]).toMatchObject({ outcome: "failed", errorCode: "DISPUTE_PAYMENT_FAILED" });
      });

      it("svc-shipments sin responder deja la fila unknown: pudo haberse aplicado", async () => {
        const s = await setup({ resolveUnavailable: true });
        const response = await resolve(s, { outcome: "sender" });
        expect(response.statusCode).toBe(502);
        expect((await auditRows(s, "dispute.resolve"))[0]).toMatchObject({ outcome: "unknown", errorCode: "SHIPMENTS_SERVICE_UNAVAILABLE" });
      });

      it.each([
        ["DISPUTE_RESOLUTION_MISMATCH", 409],
        ["HOLD_NOT_AUTHORIZED", 422],
        ["SETTLEMENT_NOT_REFUNDABLE", 422],
      ] as const)("relanza %s con su código", async (code, statusCode) => {
        const s = await setup({ resolveError: new ApiError(statusCode, code, "Rechazo de negocio") });
        const response = await resolve(s, { outcome: "sender" });
        expect(response.statusCode).toBe(statusCode);
        expect(response.json().error.code).toBe(code);
        expect((await auditRows(s, "dispute.resolve"))[0]).toMatchObject({ outcome: "failed", errorCode: code });
      });

      it("sin poder identificar al admin falla cerrado (502) antes de resolver", async () => {
        const s = await setup({ noAdminProfile: true });
        const response = await resolve(s, { outcome: "sender" });
        expect(response.statusCode).toBe(502);
        expect(s.calls).toHaveLength(0);
      });

      it("un reintento idempotente devuelve replayed: true", async () => {
        const s = await setup();
        const fake = { response: { replayed: true } };
        await app.close();
        const calls: InternalResolveDisputeRequest[] = [];
        app = buildApp({
          shipmentsClient: createFakeShipmentsClient({
            disputes: {
              details: { [s.disputeId]: { ...baseRow(s.disputeId, s.shipmentId), description: "x", photos: [], statements: [], resolution: null } },
              parties: { [s.disputeId]: { shipmentId: s.shipmentId, senderId: sender.id, carrierId: carrier.id, receiverId: receiver.id, formerReceiverIds: [] } },
              resolve: { calls, ...fake },
            },
          }),
          usersClient: createFakeUsersClient({ profiles: [{ id: s.adminId, fullName: "Lucía Admin" } as unknown as AdminUserProfile] }),
          paymentsClient: createFakePaymentsClient(),
        });
        await app.ready();
        const response = await resolve(s, { outcome: "carrier" });
        expect(response.statusCode).toBe(200);
        expect(response.json().replayed).toBe(true);
        expect((await auditRows(s, "dispute.resolve"))[0]?.context).toMatchObject({ replayed: true });
      });
    });

    it("valida la forma: sin razonamiento es 400 y un resultado desconocido también", async () => {
      const s = await setup();
      expect((await app.inject({ method: "POST", url: `/admin/disputes/${s.disputeId}/resolve`, headers: s.headers, payload: { outcome: "carrier" } })).statusCode).toBe(400);
      expect((await resolve(s, { outcome: "nadie" })).statusCode).toBe(400);
      expect((await resolve(s, { outcome: "carrier", reasoning: "corto" })).statusCode).toBe(400);
    });
  });
});
