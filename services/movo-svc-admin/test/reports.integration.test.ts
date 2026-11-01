import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { AdminTargetType, AuditLogEntry, auditTargetKey } from "@movo/shared";
import { buildApp } from "../src/app";
import { createFakePaymentsClient, createFakeShipmentsClient, createFakeSupportClient, createFakeUsersClient } from "./fake-clients";

const profile = (id: string, fullName: string) => ({ id, fullName, firstName: fullName, lastName: "" }) as never;

/**
 * MOVO-342: bitácora ampliada y su CSV (Postgres real, filas con fechas fijas) y la home (servicios dueños con fakes).
 * Las columnas son las que acordó el panel (comentario de MOVO-345 en el ticket).
 */
describe("reportes del panel — MOVO-342", () => {
  let app: FastifyInstance;
  const viewer = randomUUID();
  const headers = { "x-user-id": viewer, "x-user-roles": "sender,admin", "x-request-id": "req-report" };
  const namedAdmin = randomUUID();
  const namedUser = randomUUID();
  const reportedUser = randomUUID();
  const userReportId = randomUUID();
  const disputeId = randomUUID();
  const chatReportId = randomUUID();
  const conversationId = randomUUID();
  const disputedShipment = randomUUID();

  const clients = () => ({
    usersClient: createFakeUsersClient({
      profiles: [profile(namedAdmin, "Lucía Admin"), profile(namedUser, "Julián Ortiz"), profile(reportedUser, "Diego Reportado")],
      reported: [{ id: userReportId, reportedId: reportedUser }],
      overview: {
        kyc: { count: 3, carriers: 1, senders: 2, oldestAt: new Date(Date.now() - 48 * 3_600_000).toISOString(), yesterdayCount: 2, breakdown: [{ key: "identity", count: 2 }] },
      },
    }),
    shipmentsClient: createFakeShipmentsClient({
      auditTargets: {
        disputes: { [disputeId]: { shipmentId: disputedShipment } },
        chatReports: { [chatReportId]: { shipmentId: disputedShipment } },
        supportConversations: { [conversationId]: { code: "SOP-1042" } },
      },
      overview: {
        disputes: { count: 4, awaitingPayment: 1, oldestAt: new Date(Date.now() - 100 * 3_600_000).toISOString(), yesterdayCount: 3, breakdown: [{ key: "damaged", count: 4 }] },
      },
    }),
    supportClient: createFakeSupportClient({}).client,
    paymentsClient: createFakePaymentsClient({
      overview: { count: 1, holdsExpiringToday: 1, overSla: true, oldestAt: new Date().toISOString(), yesterdayCount: null, breakdown: [{ key: "hold_expiring", count: 1 }] },
    }).client,
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp(clients());
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Fila con fecha fija: la tabla acepta INSERT (el trigger solo frena UPDATE/DELETE/TRUNCATE). */
  async function seedAt(
    adminId: string,
    createdAt: string,
    overrides: Partial<{ action: string; reason: string; targetType: AdminTargetType; targetId: string; context: Record<string, string> }> = {},
  ) {
    await app.db.auditLog.create({
      data: {
        adminId,
        action: overrides.action ?? "user.suspend",
        targetType: overrides.targetType ?? "user",
        targetId: overrides.targetId ?? randomUUID(),
        reason: overrides.reason ?? null,
        outcome: "succeeded",
        requestId: "seed",
        createdAt: new Date(createdAt),
        ...(overrides.context ? { context: overrides.context } : {}),
      },
    });
  }

  /** CSV → filas como objetos por encabezado (sin BOM; el test no mete saltos de línea dentro de celdas). */
  function parseCsv(body: string): Array<Record<string, string>> {
    const [header, ...lines] = body.replace(/^﻿/, "").split("\r\n").filter((line) => line !== "");
    const columns = header!.split(",");
    return lines.map((line) => Object.fromEntries(line.split(",").map((cell, i) => [columns[i]!, cell])));
  }

  const exportCsv = (query: string, h: Record<string, string> = headers, target: FastifyInstance = app) =>
    target.inject({ method: "GET", url: `/admin/audit-log/export${query}`, headers: h });
  const list = (query: string) => app.inject({ method: "GET", url: `/admin/audit-log${query}`, headers });

  describe("GET /admin/audit-log/export", () => {
    it("sin el rol admin es 403", async () => {
      const res = await exportCsv("", { "x-user-id": viewer, "x-user-roles": "sender" });
      expect(res.statusCode).toBe(403);
    });

    it("filtra por días de Argentina, inclusivos, y coincide fila a fila con el listado", async () => {
      const adminId = randomUUID();
      // 01/10 en Argentina arranca a las 03:00 UTC del 01/10; 31/10 termina a las 03:00 UTC del 01/11.
      await seedAt(adminId, "2026-10-01T02:59:59.999Z");
      await seedAt(adminId, "2026-10-01T03:00:00.000Z");
      await seedAt(adminId, "2026-10-15T12:00:00.000Z", { action: "user.note_add" });
      await seedAt(adminId, "2026-11-01T02:59:59.999Z");
      await seedAt(adminId, "2026-11-01T03:00:00.000Z");
      const query = `?adminId=${adminId}&from=2026-10-01&to=2026-10-31`;

      const res = await exportCsv(query);

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
      expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="movo-bitacora_\d{4}-\d{2}-\d{2}\.csv"$/);
      expect(res.headers["x-export-rows"]).toBe("3");
      expect(res.headers["x-export-truncated"]).toBe("false");
      const rows = parseCsv(res.body);
      expect(rows.map((row) => row.created_at)).toEqual(["2026-11-01T02:59:59.999Z", "2026-10-15T12:00:00.000Z", "2026-10-01T03:00:00.000Z"]);

      const listed = (await list(`${query}&limit=50`)).json().items as AuditLogEntry[];
      expect(rows.map((row) => row.created_at)).toEqual(listed.map((item) => item.createdAt));
      expect(rows.map((row) => row.target_id)).toEqual(listed.map((item) => item.targetId));
      expect(rows.map((row) => row.action)).toEqual(listed.map((item) => item.action));

      expect(parseCsv((await exportCsv(`${query}&action=user.note_add`)).body).map((row) => row.action)).toEqual(["user.note_add"]);
    });

    it("trae las columnas acordadas, con el nombre del admin; sin `context`", async () => {
      await seedAt(namedAdmin, "2026-10-05T10:00:00.000Z", { context: { secreto: "no" } });
      const res = await exportCsv(`?adminId=${namedAdmin}&from=2026-10-05&to=2026-10-05`);
      expect(res.body.replace(/^﻿/, "").split("\r\n")[0]).toBe(
        "created_at,admin_id,admin_name,action,target_type,target_id,outcome,error_code,reason,request_id",
      );
      expect(parseCsv(res.body)[0]).toMatchObject({ admin_id: namedAdmin, admin_name: "Lucía Admin" });
      expect(res.body).not.toContain("secreto");
    });

    it("si `svc-users` no responde, el CSV sale igual, sin el nombre", async () => {
      const namesDown = buildApp({ ...clients(), usersClient: createFakeUsersClient({ namesDown: true }) });
      await namesDown.ready();
      try {
        const adminId = randomUUID();
        await seedAt(adminId, "2026-10-06T10:00:00.000Z");
        const res = await exportCsv(`?adminId=${adminId}`, headers, namesDown);
        expect(res.statusCode).toBe(200);
        expect(parseCsv(res.body)[0]).toMatchObject({ admin_id: adminId, admin_name: "" });
      } finally {
        await namesDown.close();
      }
    });

    it("escapa un motivo que empieza como fórmula", async () => {
      const adminId = randomUUID();
      await seedAt(adminId, "2026-10-10T10:00:00.000Z", { reason: '=HYPERLINK("http://x")' });
      const body = (await exportCsv(`?adminId=${adminId}`)).body;
      // `'` adelante (la planilla lo lee como texto) y comillas RFC 4180 por las del motivo.
      expect(body).toContain(`,"'=HYPERLINK(""http://x"")",`);
      expect(body).not.toContain(",=HYPERLINK");
    });

    it("cada exportación deja su fila en la bitácora (quién, filtros y filas), fuera del CSV que la generó", async () => {
      const adminId = randomUUID();
      await seedAt(adminId, "2026-10-05T10:00:00.000Z");
      const exporter = randomUUID();

      const res = await exportCsv(`?adminId=${adminId}`, { ...headers, "x-user-id": exporter });

      expect(parseCsv(res.body)).toHaveLength(1);
      const rows = await app.db.auditLog.findMany({ where: { adminId: exporter } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "report.export",
        targetType: "report",
        targetId: "audit_log",
        outcome: "succeeded",
        context: { filters: { adminId }, rows: 1, truncated: false },
        requestId: "req-report",
      });
    });

    it("con más filas que el tope corta, conserva las más recientes y lo avisa en los headers y en la bitácora", async () => {
      const capped = buildApp({ ...clients(), auditExportMaxRows: 2 });
      await capped.ready();
      try {
        const adminId = randomUUID();
        const exporter = randomUUID();
        for (const day of ["01", "02", "03"]) await seedAt(adminId, `2026-10-${day}T10:00:00.000Z`);

        const res = await exportCsv(`?adminId=${adminId}`, { ...headers, "x-user-id": exporter }, capped);

        expect(res.statusCode).toBe(200);
        expect(res.headers["x-export-rows"]).toBe("2");
        expect(res.headers["x-export-truncated"]).toBe("true");
        expect(parseCsv(res.body).map((row) => row.created_at)).toEqual(["2026-10-03T10:00:00.000Z", "2026-10-02T10:00:00.000Z"]);
        const [row] = await capped.db.auditLog.findMany({ where: { adminId: exporter } });
        expect(row?.context).toMatchObject({ rows: 2, truncated: true });
      } finally {
        await capped.close();
      }
    });

    it("con justo el tope no se marca como cortado", async () => {
      const adminId = randomUUID();
      for (const day of ["01", "02"]) await seedAt(adminId, `2026-10-${day}T10:00:00.000Z`);
      expect((await app.audit.listForExport({ adminId }, 2)).truncated).toBe(false);
      expect((await app.audit.listForExport({ adminId }, 1)).truncated).toBe(true);
    });

    it("un rango inválido es 400 REPORT_RANGE_INVALID con el motivo, en el CSV y en el listado", async () => {
      const cases = [
        ["?from=2026-10-02&to=2026-10-01", "inverted"],
        ["?from=2024-01-01&to=2026-01-01", "too_long"],
        ["?to=2999-01-01", "future"],
      ] as const;
      for (const [query, reason] of cases) {
        for (const res of [await exportCsv(query), await list(query)]) {
          expect(res.statusCode).toBe(400);
          expect(res.json().error).toMatchObject({ code: "REPORT_RANGE_INVALID", details: { reason } });
        }
      }
      expect((await exportCsv("?from=ayer")).statusCode).toBe(400);
    });
  });

  describe("GET /admin/audit-log ampliado", () => {
    it("trae el nombre de los admins y la etiqueta y relación de cada objetivo", async () => {
      const from = "2026-09-20";
      const adminOf = namedAdmin;
      const at = "2026-09-20T15:00:00.000Z";
      const shipmentId = randomUUID();
      await seedAt(adminOf, at, { action: "user.suspend", targetType: "user", targetId: namedUser });
      await seedAt(adminOf, at, { action: "shipment.status_change", targetType: "shipment", targetId: shipmentId });
      await seedAt(adminOf, at, { action: "dispute.resolve", targetType: "dispute", targetId: disputeId });
      await seedAt(adminOf, at, { action: "support.reply", targetType: "support_conversation", targetId: conversationId });
      await seedAt(adminOf, at, { action: "x", targetType: "chat_report", targetId: chatReportId });
      await seedAt(adminOf, at, { action: "x", targetType: "user_report", targetId: userReportId });
      await seedAt(adminOf, at, { action: "admin_role.grant", targetType: "admin_role", targetId: namedUser, context: { email: "ana@movo.test" } });

      const res = await list(`?adminId=${adminOf}&from=${from}&to=${from}&limit=50`);

      expect(res.statusCode).toBe(200);
      const { admins, targets } = res.json();
      expect(admins[adminOf]).toEqual({ fullName: "Lucía Admin" });
      expect(targets[auditTargetKey("user", namedUser)]).toEqual({ label: "Julián Ortiz" });
      expect(targets[auditTargetKey("shipment", shipmentId)]).toEqual({ label: shipmentId.slice(0, 8).toUpperCase() });
      expect(targets[auditTargetKey("dispute", disputeId)]).toEqual({ label: null, shipmentId: disputedShipment });
      expect(targets[auditTargetKey("support_conversation", conversationId)]).toEqual({ label: "SOP-1042" });
      expect(targets[auditTargetKey("chat_report", chatReportId)]).toEqual({ label: null, shipmentId: disputedShipment });
      expect(targets[auditTargetKey("user_report", userReportId)]).toEqual({ label: null, userId: reportedUser });
      expect(targets[auditTargetKey("admin_role", namedUser)]).toEqual({ label: "ana@movo.test" });
    });

    it("si los servicios no responden, el listado sale igual y faltan esas claves", async () => {
      const down = buildApp({
        ...clients(),
        usersClient: createFakeUsersClient({ namesDown: true }),
        shipmentsClient: createFakeShipmentsClient({ targetsDown: true }),
      });
      await down.ready();
      try {
        const adminId = randomUUID();
        await seedAt(adminId, "2026-09-21T15:00:00.000Z", { targetType: "dispute", targetId: disputeId });
        const res = await down.inject({ method: "GET", url: `/admin/audit-log?adminId=${adminId}`, headers });
        expect(res.statusCode).toBe(200);
        expect(res.json().items).toHaveLength(1);
        expect(res.json().admins).toEqual({});
        expect(res.json().targets).toEqual({});
      } finally {
        await down.close();
      }
    });

    it("una fila cuyo objetivo no es un uuid no rompe la resolución (un `grant` fallido guarda el email)", async () => {
      const adminId = randomUUID();
      await seedAt(adminId, "2026-09-22T15:00:00.000Z", { targetType: "admin_role", targetId: "ana@movo.test" });
      const res = await list(`?adminId=${adminId}`);
      expect(res.json().targets[auditTargetKey("admin_role", "ana@movo.test")]).toEqual({ label: "ana@movo.test" });
    });

    it("desde 8 caracteres `targetId` matchea por prefijo, sin distinguir mayúsculas; con menos, exacto", async () => {
      const adminId = randomUUID();
      const target = randomUUID();
      await seedAt(adminId, "2026-09-23T15:00:00.000Z", { targetType: "shipment", targetId: target });

      const prefix = target.slice(0, 8).toUpperCase();
      expect((await list(`?adminId=${adminId}&targetId=${prefix}`)).json().items).toHaveLength(1);
      expect((await list(`?adminId=${adminId}&targetId=${target}`)).json().items).toHaveLength(1);
      expect((await list(`?adminId=${adminId}&targetId=${target.slice(0, 7)}`)).json().items).toHaveLength(0);
    });

    it("filtra por los objetivos `dispute` y `report`", async () => {
      expect((await list("?targetType=dispute")).statusCode).toBe(200);
      expect((await list("?targetType=report&targetId=audit_log")).statusCode).toBe(200);
    });
  });

  describe("GET /admin/overview", () => {
    const overview = (query = "", target: FastifyInstance = app) => target.inject({ method: "GET", url: `/admin/overview${query}`, headers });

    it("trae las ocho bandejas, con el plazo y si se pasó", async () => {
      const res = await overview();

      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      const { blocks, generatedAt } = res.json();
      expect(Number.isNaN(Date.parse(generatedAt))).toBe(false);
      expect(Object.keys(blocks).sort()).toEqual(
        ["disputes", "flaggedMessages", "kyc", "payments", "sanctionsEndingToday", "shipmentAlerts", "support", "userReports"].sort(),
      );
      // 100 h contra un plazo de 72 h.
      expect(blocks.disputes.data).toMatchObject({ count: 4, awaitingPayment: 1, slaHours: 72, overSla: true, yesterdayCount: 3 });
      // 48 h contra 24 h, con sus contadores propios.
      expect(blocks.kyc.data).toMatchObject({ count: 3, carriers: 1, senders: 2, slaHours: 24, overSla: true });
      // Recién creado, pero `svc-payments` ya dijo que se pasó: el hold vence pronto.
      expect(blocks.payments.data).toMatchObject({ holdsExpiringToday: 1, slaHours: 6, overSla: true });
      expect(blocks.sanctionsEndingToday.data).toMatchObject({ count: 0, slaHours: null, overSla: false });
      expect(blocks.support.data).toMatchObject({ urgent: 0, slaHours: 0.5, overSla: false });
    });

    it("con `?blocks=` vienen solo esos, para reintentar una tarjeta", async () => {
      const { blocks } = (await overview("?blocks=kyc,support")).json();
      expect(Object.keys(blocks).sort()).toEqual(["kyc", "support"]);
    });

    it("un bloque desconocido es 400", async () => {
      const res = await overview("?blocks=kyc,inventado");
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_FAILED");
    });

    it("si un servicio no responde, solo sus bandejas vienen con error y `requestId`; el resto de la home sigue", async () => {
      const down = buildApp({ ...clients(), usersClient: createFakeUsersClient({ down: true }) });
      await down.ready();
      try {
        const { blocks } = (await overview("", down)).json();
        for (const name of ["kyc", "userReports", "sanctionsEndingToday"]) {
          expect(blocks[name]).toEqual({
            data: null,
            error: { code: "USERS_SERVICE_UNAVAILABLE", message: expect.any(String), requestId: "req-report" },
          });
        }
        expect(blocks.disputes.data.count).toBe(4);
        expect(blocks.payments.error).toBeNull();
      } finally {
        await down.close();
      }
    });

    it("sin el rol admin es 403", async () => {
      const res = await app.inject({ method: "GET", url: "/admin/overview", headers: { "x-user-id": viewer, "x-user-roles": "sender" } });
      expect(res.statusCode).toBe(403);
    });

    it("las dos rutas aparecen en la Swagger del servicio", async () => {
      const paths = Object.keys((app.swagger() as { paths: Record<string, unknown> }).paths);
      expect(paths).toEqual(expect.arrayContaining(["/admin/overview", "/admin/audit-log/export"]));
    });
  });
});
