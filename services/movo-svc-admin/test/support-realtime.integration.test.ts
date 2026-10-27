import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FastifyInstance } from "fastify";
import WebSocket from "ws";
import {
  AdminUserProfile,
  SupportInternalRow,
  SupportStreamEvent,
  SUPPORT_EVENTS_STREAM_FIELD,
  SUPPORT_EVENTS_STREAM_KEY,
  SUPPORT_WS_PROTOCOL,
} from "@movo/shared";
import { buildApp } from "../src/app";
import { originAllowed, ticketFromHeaders } from "../src/modules/support/support-realtime";
import { createFakeShipmentsClient, createFakeSupportClient, createFakeUsersClient } from "./fake-clients";

const PANEL_ORIGIN = "https://admin.movosend.app";

const profile = (fullName: string, roles: AdminUserProfile["roles"]): AdminUserProfile => {
  const id = randomUUID();
  return {
    id,
    firstName: fullName.split(" ")[0],
    lastName: fullName.split(" ")[1] ?? "",
    fullName,
    email: `${id}@movo.test`,
    emailVerified: true,
    phone: "+5493511234567",
    phoneVerified: true,
    dni: null,
    birthdate: null,
    photoUrl: null,
    createdAt: "2026-03-10T12:00:00.000Z",
    deletedAt: null,
    roles,
    accountStatus: "active",
    bannedUntil: null,
  };
};

describe("reglas del WebSocket de soporte (MOVO-322)", () => {
  it("el origen tiene que estar en la lista; `*` vale para un tramo del preview de Vercel", () => {
    const allow = `${PANEL_ORIGIN}, https://movo-admin-git-*-movoteamprojects.vercel.app`;
    expect(originAllowed(PANEL_ORIGIN, allow)).toBe(true);
    expect(originAllowed("https://movo-admin-git-feature-x-movoteamprojects.vercel.app", allow)).toBe(true);
    expect(originAllowed("https://movo-admin-git-a.evil.com-movoteamprojects.vercel.app", allow)).toBe(false);
    expect(originAllowed("https://evil.example", allow)).toBe(false);
    expect(originAllowed("https://admin.movosend.app.evil.example", allow)).toBe(false);
    expect(originAllowed(undefined, allow)).toBe(false);
  });

  it("el ticket es el segundo subprotocolo; detrás del gateway llega en x-ws-protocols", () => {
    expect(ticketFromHeaders({ "sec-websocket-protocol": `${SUPPORT_WS_PROTOCOL}, abc` })).toBe("abc");
    expect(ticketFromHeaders({ "x-ws-protocols": `${SUPPORT_WS_PROTOCOL},abc`, "sec-websocket-protocol": SUPPORT_WS_PROTOCOL })).toBe("abc");
    expect(ticketFromHeaders({ "sec-websocket-protocol": SUPPORT_WS_PROTOCOL })).toBeNull();
    expect(ticketFromHeaders({ "sec-websocket-protocol": `otro, abc` })).toBeNull();
    expect(ticketFromHeaders({ "sec-websocket-protocol": `${SUPPORT_WS_PROTOCOL}, abc, de-mas` })).toBeNull();
  });
});

/**
 * MOVO-322 AC9: ticket de un solo uso y WebSocket del panel. Servidor TCP real y cliente `ws` real; Redis real (los
 * tickets y el stream `support:events`), svc-shipments y svc-users con fakes.
 */
describe("WebSocket de la bandeja de soporte (MOVO-322)", () => {
  const me = profile("Lucía Bustos", [{ role: "admin", grantedAt: "2026-10-01T00:00:00.000Z" }]);
  const user = profile("Juana Pérez", [{ role: "carrier", grantedAt: "2026-10-01T00:00:00.000Z" }]);
  const admin = { "x-user-id": me.id, "x-user-roles": "admin" };
  const conversation: SupportInternalRow = {
    id: randomUUID(),
    code: "SOP-1042",
    userId: user.id,
    topic: "payments",
    priority: "high",
    status: "open",
    assignedTo: null,
    unread: 1,
    lastMessage: { from: "user", authorId: null, body: "Hola", hasAttachments: false, createdAt: "2026-10-25T12:00:00.000Z" },
    waitMinutes: 3,
    shipment: null,
    tags: [],
    lastActivityAt: "2026-10-25T12:00:00.000Z",
    createdAt: "2026-10-25T12:00:00.000Z",
    resolvedAt: null,
  };

  let app: FastifyInstance;
  let support: ReturnType<typeof createFakeSupportClient>;
  let baseUrl: string;

  const ticket = async () => (await app.inject({ method: "POST", url: "/admin/support/realtime-ticket", headers: admin })).json().ticket as string;
  const publish = (event: SupportStreamEvent) =>
    app.redis.xadd(SUPPORT_EVENTS_STREAM_KEY, "*", SUPPORT_EVENTS_STREAM_FIELD, JSON.stringify(event));

  interface Client {
    ws: WebSocket;
    frames: Array<Record<string, unknown>>;
    opened: Promise<boolean>;
    closed: Promise<{ code: number; reason: string }>;
  }

  function connect(protocols: string[], headers: Record<string, string> = { origin: PANEL_ORIGIN }): Client {
    const ws = new WebSocket(`${baseUrl}/admin/support/ws`, protocols, { headers });
    const frames: Array<Record<string, unknown>> = [];
    ws.on("message", (data: Buffer) => frames.push(JSON.parse(data.toString())));
    const opened = new Promise<boolean>((resolve) => {
      ws.once("open", () => resolve(true));
      ws.once("unexpected-response", () => resolve(false));
      ws.once("error", () => resolve(false));
    });
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on("close", (code: number, reason: Buffer) => resolve({ code, reason: reason.toString() }));
    });
    return { ws, frames, opened, closed };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    process.env.SUPPORT_WS_PUBLIC_URL = "wss://api.movosend.app/api/v1/admin/support/ws";
    process.env.SUPPORT_WS_ALLOWED_ORIGINS = `${PANEL_ORIGIN},https://movo-admin-git-*-movoteamprojects.vercel.app`;
    support = createFakeSupportClient({
      rows: { [conversation.id]: conversation },
      counts: { byStatus: { open: 3, awaiting_user: 0, resolved: 1 }, byOwner: { all: 3, mine: 1, none: 2 }, unreadTotal: 4 },
    });
    app = buildApp({
      usersClient: createFakeUsersClient({ profiles: [me, user] }),
      shipmentsClient: createFakeShipmentsClient(),
      supportClient: support.client,
      supportRealtime: { maxSessionMs: 1500, readerBlockMs: 200 },
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("El servidor de test no devolvió una dirección TCP");
    baseUrl = `ws://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.SUPPORT_WS_PUBLIC_URL;
    delete process.env.SUPPORT_WS_ALLOWED_ORIGINS;
  });

  beforeEach(async () => {
    await app.redis.del(SUPPORT_EVENTS_STREAM_KEY);
  });

  it("el ticket lo pide un admin y trae la URL pública del gateway y su vencimiento", async () => {
    const res = await app.inject({ method: "POST", url: "/admin/support/realtime-ticket", headers: admin });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toBe("wss://api.movosend.app/api/v1/admin/support/ws");
    expect(body.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const ttl = new Date(body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(20_000);
    expect(ttl).toBeLessThanOrEqual(30_000);
    const notAdmin = await app.inject({ method: "POST", url: "/admin/support/realtime-ticket", headers: { "x-user-id": user.id, "x-user-roles": "sender" } });
    expect(notAdmin.statusCode).toBe(403);
  });

  it("con el ticket abre, responde solo el subprotocolo y reparte los eventos con nombres y cursor", async () => {
    const client = connect([SUPPORT_WS_PROTOCOL, await ticket()]);
    expect(await client.opened).toBe(true);
    expect(client.ws.protocol).toBe(SUPPORT_WS_PROTOCOL);
    await new Promise((resolve) => setTimeout(resolve, 300)); // el lector arranca desde "ahora"

    await publish({ type: "conversation_created", conversation });
    await publish({ type: "counts_changed" });

    await vi.waitFor(() => expect(client.frames).toHaveLength(2), { timeout: 3000 });
    expect(client.frames[0]).toMatchObject({
      type: "conversation_created",
      cursor: expect.stringMatching(/^\d+-\d+$/),
      conversation: { id: conversation.id, user: { fullName: "Juana Pérez", role: "carrier" } },
    });
    expect(client.frames[1]).toMatchObject({ type: "counts_updated", counts: { unreadTotal: 4, byOwner: { mine: 1 } } });
    expect(support.seen.counts).toEqual({ status: "open", viewerId: me.id });
    client.ws.close();
    await client.closed;
  });

  it("un ticket ya usado, inventado o sin ticket cierra con 4001", async () => {
    const used = await ticket();
    const first = connect([SUPPORT_WS_PROTOCOL, used]);
    expect(await first.opened).toBe(true);

    for (const protocols of [[SUPPORT_WS_PROTOCOL, used], [SUPPORT_WS_PROTOCOL, "x".repeat(43)], [SUPPORT_WS_PROTOCOL]]) {
      const client = connect(protocols);
      expect((await client.closed).code).toBe(4001);
    }
    first.ws.close();
    await first.closed;
  });

  it("un origen fuera de la lista cierra con 4003 sin gastar el ticket; el preview de Vercel entra", async () => {
    const t = await ticket();
    const rejected = connect([SUPPORT_WS_PROTOCOL, t], { origin: "https://evil.example" });
    expect((await rejected.closed).code).toBe(4003);
    const noOrigin = connect([SUPPORT_WS_PROTOCOL, t], {});
    expect((await noOrigin.closed).code).toBe(4003);

    const preview = connect([SUPPORT_WS_PROTOCOL, t], { origin: "https://movo-admin-git-feature-x-movoteamprojects.vercel.app" });
    expect(await preview.opened).toBe(true);
    preview.ws.close();
    await preview.closed;
  });

  it("detrás del gateway el ticket llega en x-ws-protocols", async () => {
    const client = connect([SUPPORT_WS_PROTOCOL], { origin: PANEL_ORIGIN, "x-ws-protocols": `${SUPPORT_WS_PROTOCOL},${await ticket()}` });
    expect(await client.opened).toBe(true);
    client.ws.close();
    await client.closed;
  });

  it("la conexión se corta (4001) al cumplir la duración de una sesión de panel", async () => {
    const client = connect([SUPPORT_WS_PROTOCOL, await ticket()]);
    expect(await client.opened).toBe(true);
    const { code } = await client.closed;
    expect(code).toBe(4001);
  });
});
