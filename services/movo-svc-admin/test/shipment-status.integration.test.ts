import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import {
  AdminShipmentDetail,
  AdminUserProfile,
  ApiError,
  ForceShipmentStatusRequest,
  ShipmentStatus,
  shipmentConfirmationCode,
} from "@movo/shared";
import { buildApp } from "../src/app";
import { createFakePaymentsClient, createFakeShipmentsClient, createFakeUsersClient } from "./fake-clients";

/** MOVO-332 (ADR-055): cambio de estado desde el panel, step-up, conflicto de interés y bitácora. */

const REASON = "El transportista no responde hace dos días y el emisor pidió destrabarlo";
const sender = { id: randomUUID(), name: "Ana Emisora" };
const carrier = { id: randomUUID(), name: "Carlos Transportista" };
const receiver = { id: randomUUID(), name: "Rosa Receptora" };

describe("Cambio de estado de un envío desde el panel (MOVO-332)", () => {
  let app: FastifyInstance;

  afterAll(async () => {
    await app?.close();
  });

  interface Scenario {
    adminId: string;
    shipmentId: string;
    code: string;
    force: NonNullable<Parameters<typeof createFakeShipmentsClient>[0]["force"]>;
    stepUp: NonNullable<Parameters<typeof createFakeUsersClient>[0]["stepUp"]>;
    headers: Record<string, string>;
  }

  /** Un envío en `status`, un admin ajeno a él y los fakes que registran lo que reciben. */
  async function setup(
    status: ShipmentStatus,
    opts: {
      adminIsParty?: boolean;
      withCarrier?: boolean;
      forceError?: ApiError;
      forceUnavailable?: boolean;
      validateError?: ApiError;
      consumeError?: ApiError;
      shipmentsDown?: boolean;
      noAdminProfile?: boolean;
    } = {},
  ): Promise<Scenario> {
    const adminId = randomUUID();
    const shipmentId = randomUUID();
    const code = shipmentConfirmationCode(shipmentId);
    const force: Scenario["force"] = { calls: [], error: opts.forceError, unavailable: opts.forceUnavailable };
    const stepUp: Scenario["stepUp"] = {
      requested: [],
      validated: [],
      consumed: [],
      validateError: opts.validateError,
      consumeError: opts.consumeError,
    };
    const withCarrier = opts.withCarrier ?? !["published", "awaiting_receiver_confirmation", "rejected_by_receiver"].includes(status);
    const detail = {
      id: shipmentId,
      code,
      status,
      sender,
      carrier: withCarrier ? carrier : null,
      receiver,
    } as unknown as AdminShipmentDetail;
    const profile = { id: adminId, fullName: "Lucía Admin" } as unknown as AdminUserProfile;

    if (!app) {
      process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
      process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    }
    // Un app por escenario: los fakes cierran sobre los datos de cada uno.
    await app?.close();
    app = buildApp({
      shipmentsClient: createFakeShipmentsClient({
        details: { [shipmentId]: detail },
        shipments: {
          [shipmentId]: {
            shipmentId,
            senderId: opts.adminIsParty ? adminId : sender.id,
            carrierId: withCarrier ? carrier.id : null,
            receiverId: receiver.id,
            formerReceiverIds: [],
          },
        },
        force,
        down: opts.shipmentsDown,
      }),
      usersClient: createFakeUsersClient({ profiles: opts.noAdminProfile ? [] : [profile], stepUp }),
      paymentsClient: createFakePaymentsClient(),
    });
    await app.ready();
    return { adminId, shipmentId, code, force, stepUp, headers: { "x-user-id": adminId, "x-user-roles": "admin" } };
  }

  const change = (s: Scenario, payload: Record<string, unknown>, headers = s.headers) =>
    app.inject({
      method: "POST",
      url: `/admin/shipments/${s.shipmentId}/status`,
      headers,
      payload: { reason: REASON, idempotencyKey: randomUUID(), ...payload },
    });

  const rows = (s: Scenario) =>
    app.db.auditLog.findMany({ where: { targetId: s.shipmentId, action: "shipment.status_change" }, orderBy: { createdAt: "asc" } });

  describe("cambio permitido", () => {
    it("published -> cancelled: llama a svc-shipments con el admin, su nombre y la clave, y deja una fila succeeded", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED);
      const idempotencyKey = randomUUID();

      const response = await change(s, { targetStatus: "cancelled", expectedStatus: "published", idempotencyKey });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ shipmentId: s.shipmentId, fromStatus: "published", toStatus: "cancelled", kind: "manual", replayed: false });
      expect(s.force.calls).toEqual([
        {
          targetStatus: "cancelled",
          expectedStatus: "published",
          reason: REASON,
          adminId: s.adminId,
          adminName: "Lucía Admin",
          idempotencyKey,
        },
      ] satisfies ForceShipmentStatusRequest[]);
      const [row, ...rest] = await rows(s);
      expect(rest).toHaveLength(0);
      expect(row).toMatchObject({
        adminId: s.adminId,
        targetType: "shipment",
        outcome: "succeeded",
        reason: REASON,
        context: { from: "published", to: "cancelled", forced: false, risk: "medium", idempotencyKey, replayed: false },
      });
    });

    it("el motivo se guarda sin espacios sobrantes", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED);

      await change(s, { targetStatus: "cancelled", expectedStatus: "published", reason: `   ${REASON}   ` });

      expect(s.force.calls[0]?.reason).toBe(REASON);
    });
  });

  describe("segundo factor y código del envío", () => {
    it("assigned -> cancelled (forzada, riesgo alto): valida el token antes de llamar a svc-shipments y lo gasta al aplicarse", async () => {
      const s = await setup(ShipmentStatus.ASSIGNED);

      const response = await change(s, {
        targetStatus: "cancelled",
        expectedStatus: "assigned",
        typedCode: `#${s.code.toLowerCase()}`,
        stepUpToken: "t".repeat(43),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().kind).toBe("forced");
      const spent = { adminId: s.adminId, shipmentId: s.shipmentId, targetStatus: "cancelled", stepUpToken: "t".repeat(43) };
      expect(s.stepUp.validated).toEqual([spent]);
      expect(s.stepUp.consumed).toEqual([spent]);
      expect(s.force.calls).toHaveLength(1);
      expect((await rows(s))[0]).toMatchObject({ outcome: "succeeded", context: expect.objectContaining({ forced: true, risk: "high" }) });
    });

    it("sin el token de una transición forzada: 403 STEP_UP_REQUIRED, no llama a svc-shipments y queda la fila failed", async () => {
      const s = await setup(ShipmentStatus.ASSIGNED);

      const response = await change(s, { targetStatus: "cancelled", expectedStatus: "assigned", typedCode: s.code });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("STEP_UP_REQUIRED");
      expect(s.force.calls).toHaveLength(0);
      expect((await rows(s))[0]).toMatchObject({ outcome: "failed", errorCode: "STEP_UP_REQUIRED" });
    });

    it("con un token inválido, usado o de otra acción: 401 STEP_UP_INVALID, no llama a svc-shipments y queda failed", async () => {
      const s = await setup(ShipmentStatus.ASSIGNED, {
        validateError: new ApiError(401, "STEP_UP_INVALID", "El código ingresado es inválido o venció."),
      });

      const response = await change(s, {
        targetStatus: "cancelled",
        expectedStatus: "assigned",
        typedCode: s.code,
        stepUpToken: "t".repeat(43),
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("STEP_UP_INVALID");
      expect(s.force.calls).toHaveLength(0);
      expect((await rows(s))[0]).toMatchObject({ outcome: "failed", errorCode: "STEP_UP_INVALID" });
    });

    it("un código del envío erróneo o ausente (riesgo alto): 422 TYPED_CODE_MISMATCH y no se gasta el token", async () => {
      const s = await setup(ShipmentStatus.ASSIGNED);

      for (const typedCode of [undefined, "ZZZZZZZZ"]) {
        const response = await change(s, {
          targetStatus: "cancelled",
          expectedStatus: "assigned",
          stepUpToken: "t".repeat(43),
          ...(typedCode ? { typedCode } : {}),
        });
        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe("TYPED_CODE_MISMATCH");
      }
      expect(s.stepUp.consumed).toHaveLength(0);
      expect(s.force.calls).toHaveLength(0);
      expect(await rows(s)).toHaveLength(2);
    });

    it("riesgo medio manual no pide ni código ni token", async () => {
      const s = await setup(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION);

      const response = await change(s, { targetStatus: "cancelled", expectedStatus: "awaiting_receiver_confirmation" });

      expect(response.statusCode).toBe(200);
      expect(s.stepUp.consumed).toHaveLength(0);
    });
  });

  describe("validaciones y rechazos (todos dejan fila)", () => {
    it("un motivo de menos de 20 caracteres es 400, deja la fila failed y no llama a svc-shipments", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED);

      const response = await change(s, { targetStatus: "cancelled", expectedStatus: "published", reason: "muy corto" });

      expect(response.statusCode).toBe(400);
      expect(s.force.calls).toHaveLength(0);
      expect((await rows(s))[0]).toMatchObject({ outcome: "failed", errorCode: "VALIDATION_FAILED" });
    });

    it("un motivo de solo espacios es 400", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED);
      const response = await change(s, { targetStatus: "cancelled", expectedStatus: "published", reason: " ".repeat(30) });
      expect(response.statusCode).toBe(400);
    });

    it("un par bloqueado: 422 TRANSITION_NOT_ALLOWED con el motivo, sin llamar a svc-shipments", async () => {
      const s = await setup(ShipmentStatus.DISPUTED);

      const response = await change(s, { targetStatus: "published", expectedStatus: "disputed" });

      expect(response.statusCode).toBe(422);
      expect(response.json().error).toMatchObject({ code: "TRANSITION_NOT_ALLOWED", details: { reason: expect.stringContaining("disputa") } });
      expect(s.force.calls).toHaveLength(0);
      expect((await rows(s))[0]).toMatchObject({ outcome: "failed", errorCode: "TRANSITION_NOT_ALLOWED" });
    });

    it("si el envío ya no está en expectedStatus: 409 STATUS_CHANGED con el estado actual", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED);

      const response = await change(s, { targetStatus: "cancelled", expectedStatus: "assigned" });

      expect(response.statusCode).toBe(409);
      expect(response.json().error).toMatchObject({ code: "STATUS_CHANGED", details: { currentStatus: "published" } });
      expect(s.force.calls).toHaveLength(0);
    });

    it("un envío que no existe es 404", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED);
      const response = await app.inject({
        method: "POST",
        url: `/admin/shipments/${randomUUID()}/status`,
        headers: s.headers,
        payload: { targetStatus: "cancelled", expectedStatus: "published", reason: REASON, idempotencyKey: randomUUID() },
      });
      expect(response.statusCode).toBe(404);
    });

    it("sin el rol admin es 403 y no deja fila ni llama a nadie", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED);

      const response = await change(s, { targetStatus: "cancelled", expectedStatus: "published" }, { "x-user-id": s.adminId, "x-user-roles": "sender" });

      expect(response.statusCode).toBe(403);
      expect(s.force.calls).toHaveLength(0);
      expect(await rows(s)).toHaveLength(0);
    });

    it("sin identidad es 401", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED);
      const response = await change(s, { targetStatus: "cancelled", expectedStatus: "published" }, {});
      expect(response.statusCode).toBe(401);
    });

    it("si no se puede identificar al admin falla cerrado: 502, fila failed y no se llama a svc-shipments", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED, { noAdminProfile: true });

      const response = await change(s, { targetStatus: "cancelled", expectedStatus: "published" });

      expect(response.statusCode).toBe(502);
      expect(s.force.calls).toHaveLength(0);
      expect((await rows(s))[0]?.outcome).toBe("failed");
    });
  });

  describe("conflicto de interés", () => {
    it("si el admin es parte del envío: 403 ADMIN_CONFLICT_OF_INTEREST, fila failed y svc-shipments no se llama", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED, { adminIsParty: true });

      const response = await change(s, { targetStatus: "cancelled", expectedStatus: "published" });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("ADMIN_CONFLICT_OF_INTEREST");
      expect(s.force.calls).toHaveLength(0);
      expect(s.stepUp.consumed).toHaveLength(0);
      expect((await rows(s))[0]).toMatchObject({ outcome: "failed", errorCode: "ADMIN_CONFLICT_OF_INTEREST" });
    });

    it("falla cerrado si svc-shipments no responde: 502 y no se llama a force-status", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED, { shipmentsDown: true });

      const response = await change(s, { targetStatus: "cancelled", expectedStatus: "published" });

      expect(response.statusCode).toBe(502);
      expect(response.json().error.code).toBe("SHIPMENTS_SERVICE_UNAVAILABLE");
      expect(s.force.calls).toHaveLength(0);
    });
  });

  describe("errores de svc-shipments", () => {
    it.each([
      ["STATUS_CHANGED", 409, { currentStatus: "assigned" }],
      ["TRANSITION_NOT_ALLOWED", 422, { reason: "No hay un servicio de dominio que ejecute esta transición." }],
      ["HOLD_NOT_AUTHORIZED", 422, { holdStatus: "in_process" }],
      ["FORCE_STATUS_EFFECT_FAILED", 502, undefined],
      ["IDEMPOTENCY_KEY_REUSED", 409, undefined],
    ] as const)("%s pasa con su código, su status y sus details, y queda como failed", async (code, status, details) => {
      const s = await setup(ShipmentStatus.PUBLISHED, { forceError: new ApiError(status, code, "rechazado", details) });

      const response = await change(s, { targetStatus: "cancelled", expectedStatus: "published" });

      expect(response.statusCode).toBe(status);
      expect(response.json().error.code).toBe(code);
      if (details) expect(response.json().error.details).toEqual(details);
      expect((await rows(s))[0]).toMatchObject({ outcome: "failed", errorCode: code });
    });

    it("si svc-shipments no responde durante la acción, la fila queda unknown (pudo haberse aplicado)", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED, { forceUnavailable: true });

      const response = await change(s, { targetStatus: "cancelled", expectedStatus: "published" });

      expect(response.statusCode).toBe(502);
      expect((await rows(s))[0]).toMatchObject({ outcome: "unknown", errorCode: "SHIPMENTS_SERVICE_UNAVAILABLE" });
    });
  });

  describe("idempotencia (comentarios de review de la PR #305)", () => {
    const forcedBody = (s: Scenario, extra: Record<string, unknown> = {}) => ({
      targetStatus: "cancelled",
      expectedStatus: "assigned",
      typedCode: s.code,
      stepUpToken: "t".repeat(43),
      ...extra,
    });

    it("reintentar la misma clave tras un cambio exitoso devuelve el resultado original, sin tocar svc-shipments ni el token", async () => {
      const s = await setup(ShipmentStatus.ASSIGNED);
      const idempotencyKey = randomUUID();

      const first = await change(s, forcedBody(s, { idempotencyKey }));
      const second = await change(s, forcedBody(s, { idempotencyKey }));

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({ ...first.json(), replayed: true });
      expect(s.force.calls).toHaveLength(1);
      expect(s.stepUp.validated).toHaveLength(1);
      expect(s.stepUp.consumed).toHaveLength(1);
      // Un replay no es un intento nuevo: no deja otra fila.
      expect(await rows(s)).toHaveLength(1);
    });

    it("la misma clave para otro destino o estado esperado es 409 IDEMPOTENCY_KEY_REUSED", async () => {
      const s = await setup(ShipmentStatus.ASSIGNED);
      const idempotencyKey = randomUUID();
      await change(s, forcedBody(s, { idempotencyKey }));

      const response = await change(s, forcedBody(s, { idempotencyKey, targetStatus: "published" }));

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
      expect(s.force.calls).toHaveLength(1);
    });

    it("la misma clave de otro admin no choca con la de este", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED);
      const idempotencyKey = randomUUID();
      await change(s, { targetStatus: "cancelled", expectedStatus: "published", idempotencyKey });

      const response = await change(s, { targetStatus: "cancelled", expectedStatus: "published", idempotencyKey }, {
        "x-user-id": randomUUID(),
        "x-user-roles": "admin",
      });

      // Otro admin sin perfil en el fake: falla al identificarlo, no con un replay del primero.
      expect(response.json().replayed).toBeUndefined();
    });

    it("tras una llamada sin respuesta (pudo aplicarse) el reintento no pide otro token ni compara expectedStatus: vuelve a svc-shipments con la misma clave", async () => {
      const s = await setup(ShipmentStatus.ASSIGNED, { forceUnavailable: true });
      const idempotencyKey = randomUUID();

      const first = await change(s, forcedBody(s, { idempotencyKey }));
      expect(first.statusCode).toBe(502);
      expect((await rows(s))[0]).toMatchObject({ outcome: "unknown" });
      // El token se gastó igual: no se sabe si el cambio se aplicó.
      expect(s.stepUp.consumed).toHaveLength(1);

      // svc-shipments vuelve, el envío ya está en el destino y el panel reintenta sin token.
      s.force.unavailable = false;
      const retry = await change(s, { targetStatus: "cancelled", expectedStatus: "assigned", typedCode: s.code, idempotencyKey });

      expect(retry.statusCode).toBe(200);
      expect(s.force.calls).toHaveLength(1);
      expect(s.stepUp.validated).toHaveLength(1);
      expect(s.stepUp.consumed).toHaveLength(1);
    });

    it("el reintento tras una llamada sin respuesta sigue exigiendo el código del envío", async () => {
      const s = await setup(ShipmentStatus.ASSIGNED, { forceUnavailable: true });
      const idempotencyKey = randomUUID();
      await change(s, forcedBody(s, { idempotencyKey }));
      s.force.unavailable = false;

      const retry = await change(s, { targetStatus: "cancelled", expectedStatus: "assigned", idempotencyKey });

      expect(retry.statusCode).toBe(422);
      expect(retry.json().error.code).toBe("TYPED_CODE_MISMATCH");
    });
  });

  describe("el token del segundo factor (comentarios de review de la PR #305)", () => {
    const forcedBody = (s: Scenario) => ({
      targetStatus: "cancelled",
      expectedStatus: "assigned",
      typedCode: s.code,
      stepUpToken: "t".repeat(43),
    });

    it.each([
      ["HOLD_NOT_AUTHORIZED", 422],
      ["FORCE_STATUS_EFFECT_FAILED", 502],
      ["STATUS_CHANGED", 409],
    ] as const)("un rechazo de svc-shipments (%s) no gasta el token: el admin puede reintentar con el mismo código", async (code, status) => {
      const s = await setup(ShipmentStatus.ASSIGNED, { forceError: new ApiError(status, code, "rechazado") });

      const response = await change(s, forcedBody(s));

      expect(response.statusCode).toBe(status);
      expect(s.stepUp.validated).toHaveLength(1);
      expect(s.stepUp.consumed).toHaveLength(0);
    });

    it("un rechazo no deja guardado el replay: el reintento con la misma clave vuelve a intentar el cambio", async () => {
      const s = await setup(ShipmentStatus.ASSIGNED, { forceError: new ApiError(422, "HOLD_NOT_AUTHORIZED", "x") });
      const idempotencyKey = randomUUID();
      await change(s, { ...forcedBody(s), idempotencyKey });
      s.force.error = undefined;

      const retry = await change(s, { ...forcedBody(s), idempotencyKey });

      expect(retry.statusCode).toBe(200);
      expect(retry.json().replayed).toBe(false);
      expect(s.stepUp.consumed).toHaveLength(1);
    });

    it("si no se puede gastar el token después de aplicarse, el cambio igual responde 200", async () => {
      const s = await setup(ShipmentStatus.ASSIGNED, {
        consumeError: new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "caído"),
      });

      const response = await change(s, forcedBody(s));

      expect(response.statusCode).toBe(200);
      expect((await rows(s))[0]?.outcome).toBe("succeeded");
    });
  });

  describe("límites", () => {
    it("más de 5 intentos por minuto sobre el mismo envío son 429", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED);

      const codes: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        codes.push((await change(s, { targetStatus: "cancelled", expectedStatus: "published", reason: "corto" })).statusCode);
      }

      expect(codes.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
      expect(codes[5]).toBe(429);
    });

    it("el 429 deja UNA fila en la bitácora por admin y envío, no una por cada rechazo", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED);

      for (let i = 0; i < 9; i += 1) {
        await change(s, { targetStatus: "cancelled", expectedStatus: "published", reason: "corto" });
      }

      const limited = (await rows(s)).filter((row) => row.errorCode === "RATE_LIMIT_EXCEEDED");
      expect(limited).toHaveLength(1);
      expect(limited[0]).toMatchObject({ outcome: "failed", context: expect.objectContaining({ rateLimited: true }) });
    });

    it("más de 10 cambios por minuto de un mismo admin son 429, aunque sean envíos distintos", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED);
      const statuses: number[] = [];

      for (let i = 0; i < 11; i += 1) {
        const response = await app.inject({
          method: "POST",
          url: `/admin/shipments/${randomUUID()}/status`,
          headers: s.headers,
          payload: { targetStatus: "cancelled", expectedStatus: "published", reason: REASON, idempotencyKey: randomUUID() },
        });
        statuses.push(response.statusCode);
      }

      expect(statuses.slice(0, 10).every((code) => code === 404)).toBe(true);
      expect(statuses[10]).toBe(429);
    });
  });

  describe("GET /shipments/:id/status-options", () => {
    const options = (s: Scenario) => app.inject({ method: "GET", url: `/admin/shipments/${s.shipmentId}/status-options`, headers: s.headers });

    it("desde assigned: las opciones con su riesgo, efectos, destinatarios y fricción, y el resto bloqueado con su motivo", async () => {
      const s = await setup(ShipmentStatus.ASSIGNED);

      const response = await options(s);

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.current).toBe("assigned");
      expect(body.code).toBe(s.code);
      const byTarget = Object.fromEntries(body.options.map((o: { targetStatus: string }) => [o.targetStatus, o]));
      expect(Object.keys(byTarget).sort()).toEqual(["cancelled", "published"]);
      expect(byTarget.cancelled).toMatchObject({
        kind: "forced",
        risk: "high",
        requiresTypedCode: true,
        requiresStepUp: true,
        notifies: ["sender", "receiver", "carrier"],
      });
      expect(byTarget.cancelled.effects.length).toBeGreaterThan(0);
      expect(byTarget.cancelled.irreversible).toEqual([expect.stringContaining("terminal")]);
      expect(byTarget.published.irreversible).toEqual([expect.stringContaining("volver a ofertar")]);
      expect(byTarget.cancelled.checks).toEqual([]);
      const blocked = Object.fromEntries(body.blocked.map((b: { targetStatus: string; reason: string }) => [b.targetStatus, b.reason]));
      expect(blocked.in_transit).toMatch(/handshake/);
      expect(blocked.disputed).toBeDefined();
      expect(Object.keys(blocked)).not.toContain("assigned");
      expect(body.options.length + body.blocked.length).toBe(Object.values(ShipmentStatus).length - 1);
    });

    it("desde published: cancelar es riesgo medio, sin código ni segundo factor, y no avisa al transportista", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED);

      const body = (await options(s)).json();

      expect(body.options).toHaveLength(1);
      expect(body.options[0]).toMatchObject({ targetStatus: "cancelled", kind: "manual", risk: "medium", requiresTypedCode: false, requiresStepUp: false, notifies: ["sender", "receiver"] });
    });

    it("desde un estado terminal: ninguna opción y todo bloqueado", async () => {
      for (const status of [ShipmentStatus.COMPLETED, ShipmentStatus.CANCELLED, ShipmentStatus.DISPUTED]) {
        const s = await setup(status);
        const body = (await options(s)).json();
        expect(body.options).toEqual([]);
        expect(body.blocked.length).toBe(Object.values(ShipmentStatus).length - 1);
      }
    });

    it("un envío inexistente es 404, y sin el rol admin es 403", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED);
      expect((await app.inject({ method: "GET", url: `/admin/shipments/${randomUUID()}/status-options`, headers: s.headers })).statusCode).toBe(404);
      expect(
        (await app.inject({ method: "GET", url: `/admin/shipments/${s.shipmentId}/status-options`, headers: { "x-user-id": s.adminId, "x-user-roles": "sender" } })).statusCode,
      ).toBe(403);
    });

    it("es una lectura: no deja fila en la bitácora", async () => {
      const s = await setup(ShipmentStatus.PUBLISHED);
      await options(s);
      expect(await rows(s)).toHaveLength(0);
    });
  });

  describe("POST /step-up y /step-up/verify", () => {
    it("pedir el código delega en svc-users con el admin de la sesión", async () => {
      const s = await setup(ShipmentStatus.ASSIGNED);

      const response = await app.inject({
        method: "POST",
        url: "/admin/step-up",
        headers: s.headers,
        payload: { shipmentId: s.shipmentId, targetStatus: "cancelled" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ challengeId: "challenge-1", maskedEmail: "a***@movo.test", cooldownSeconds: 60, expiresInSeconds: 300 });
      expect(s.stepUp.requested).toEqual([{ adminId: s.adminId, shipmentId: s.shipmentId, targetStatus: "cancelled" }]);
    });

    it("no manda el código si el envío no existe, el par está bloqueado o la transición no exige segundo factor", async () => {
      const post = (s: Scenario, payload: Record<string, unknown>) =>
        app.inject({ method: "POST", url: "/admin/step-up", headers: s.headers, payload });

      // Un escenario a la vez: cada `setup` reconstruye el app con los datos de ese envío.
      const missing = await setup(ShipmentStatus.ASSIGNED);
      expect((await post(missing, { shipmentId: randomUUID(), targetStatus: "cancelled" })).statusCode).toBe(404);

      const blocked = await setup(ShipmentStatus.DISPUTED);
      const bloqueado = await post(blocked, { shipmentId: blocked.shipmentId, targetStatus: "published" });
      expect(bloqueado.statusCode).toBe(422);
      expect(bloqueado.json().error).toMatchObject({ code: "TRANSITION_NOT_ALLOWED", details: { reason: expect.any(String) } });

      const noStepUp = await setup(ShipmentStatus.PUBLISHED);
      expect((await post(noStepUp, { shipmentId: noStepUp.shipmentId, targetStatus: "cancelled" })).statusCode).toBe(400);

      for (const s of [missing, blocked, noStepUp]) expect(s.stepUp.requested).toHaveLength(0);
    });

    it("verificar devuelve el token; un código erróneo pasa como 401 STEP_UP_INVALID", async () => {
      const ok = await setup(ShipmentStatus.ASSIGNED);
      const verified = await app.inject({
        method: "POST",
        url: "/admin/step-up/verify",
        headers: ok.headers,
        payload: { shipmentId: ok.shipmentId, targetStatus: "cancelled", challengeId: "challenge-1", code: "123456" },
      });
      expect(verified.statusCode).toBe(200);
      expect(verified.json().expiresInSeconds).toBe(300);
      expect(verified.json().stepUpToken).toEqual(expect.any(String));

      const bad = await setup(ShipmentStatus.ASSIGNED);
      bad.stepUp.verifyError = new ApiError(401, "STEP_UP_INVALID", "El código ingresado es inválido o venció.");
      const rejected = await app.inject({
        method: "POST",
        url: "/admin/step-up/verify",
        headers: bad.headers,
        payload: { shipmentId: bad.shipmentId, targetStatus: "cancelled", challengeId: "challenge-1", code: "123456" },
      });
      expect(rejected.statusCode).toBe(401);
      expect(rejected.json().error.code).toBe("STEP_UP_INVALID");
    });

    it("sin el rol admin es 403 y un código mal formado es 400", async () => {
      const s = await setup(ShipmentStatus.ASSIGNED);
      const noAdmin = await app.inject({
        method: "POST",
        url: "/admin/step-up",
        headers: { "x-user-id": s.adminId, "x-user-roles": "sender" },
        payload: { shipmentId: s.shipmentId, targetStatus: "cancelled" },
      });
      expect(noAdmin.statusCode).toBe(403);

      const malformed = await app.inject({
        method: "POST",
        url: "/admin/step-up/verify",
        headers: s.headers,
        payload: { shipmentId: s.shipmentId, targetStatus: "cancelled", challengeId: "c", code: "12ab" },
      });
      expect(malformed.statusCode).toBe(400);
    });
  });
});
