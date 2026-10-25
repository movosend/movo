import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createServer, Server, IncomingMessage } from "node:http";
import { FastifyInstance } from "fastify";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
import { signAccessToken, UserRole, KycStatus, SUPPORT_WS_PROTOCOL } from "@movo/shared";
import { buildApp } from "../src/app";

/**
 * MOVO-201: `@fastify/http-proxy` (con `{ websocket: true }` en la entrada `/shipments`
 * de `routes-map.ts`) reenvía el upgrade WS al upstream, pero su
 * `rewriteRequestHeaders` de default SOLO reenvía el header `cookie` -- sin el
 * `wsClientOptions.rewriteRequestHeaders` custom que agrega `routes/index.ts`, un
 * request HTTP normal a `/shipments/*` llega con `x-user-id` inyectado pero una
 * conexión WS al mismo prefijo llegaría "anónima". Este test verifica el proxy de
 * punta a punta contra un upstream WS real -- las suites existentes de
 * `routes-prefix.test.ts` usan un stub HTTP plano, que nunca ejercita esta rama.
 */
describe("Proxy de WebSocket hacia /shipments (MOVO-201)", () => {
  let app: FastifyInstance;
  let upstream: Server;
  let upstreamWss: WebSocketServer;
  let upstreamPort: number;
  let capturedHeaders: IncomingMessage["headers"] = {};
  let capturedUrl = "";
  let gatewayBaseUrl: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.REDIS_URL = "redis://localhost:6379";

    upstream = createServer();
    upstreamWss = new WebSocketServer({ noServer: true });
    upstream.on("upgrade", (req, socket, head) => {
      capturedHeaders = req.headers;
      capturedUrl = req.url ?? "";
      upstreamWss.handleUpgrade(req, socket, head, (ws) => {
        ws.send(JSON.stringify({ type: "connected" }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      upstream.listen(0, "127.0.0.1", () => {
        const address = upstream.address();
        if (!address || typeof address === "string") {
          reject(new Error("El upstream de test no devolvió una dirección TCP"));
          return;
        }
        upstreamPort = address.port;
        resolve();
      });
    });

    process.env.USERS_SERVICE_URL = `http://127.0.0.1:${upstreamPort}`;
    process.env.SHIPMENTS_SERVICE_URL = `http://127.0.0.1:${upstreamPort}`;
    process.env.PAYMENTS_SERVICE_URL = `http://127.0.0.1:${upstreamPort}`;
    process.env.ADMIN_SERVICE_URL = `http://127.0.0.1:${upstreamPort}`;

    app = buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const gatewayAddress = app.server.address();
    if (!gatewayAddress || typeof gatewayAddress === "string") {
      throw new Error("El gateway de test no devolvió una dirección TCP");
    }
    gatewayBaseUrl = `ws://127.0.0.1:${gatewayAddress.port}`;
  });

  /** El límite propio del WS del panel (20/min por IP) vive en Redis: cada test arranca con el contador limpio. */
  async function resetSupportWsLimit() {
    const keys = await app.redis.keys("*GET /admin/support/ws*");
    if (keys.length > 0) await app.redis.del(...keys);
  }

  beforeEach(resetSupportWsLimit);

  afterAll(async () => {
    await resetSupportWsLimit();
    await app.close();
    upstreamWss.close();
    upstream.close();
  });

  it("reenvía el upgrade al upstream con x-user-id/x-user-roles/x-kyc-status inyectados", async () => {
    const token = signAccessToken({
      sub: "55555555-5555-5555-5555-555555555555",
      roles: [UserRole.SENDER, UserRole.CARRIER],
      kycStatus: KycStatus.NOT_STARTED,
    });

    const ws = new WebSocket(`${gatewayBaseUrl}/api/v1/shipments/some-id/track`, {
      // "x-user-id" falsificado por el cliente -- el preHandler tiene que
      // limpiarlo y reemplazarlo por el sub real del JWT antes del upgrade.
      headers: { authorization: `Bearer ${token}`, "x-user-id": "attacker-controlled" },
    });

    const message = await new Promise<unknown>((resolve, reject) => {
      ws.once("message", (data: Buffer) => resolve(JSON.parse(data.toString())));
      ws.once("error", reject);
      ws.once("unexpected-response", (_req, res) => reject(new Error(`unexpected-response: ${res.statusCode}`)));
    });

    expect(message).toEqual({ type: "connected" });
    expect(capturedUrl).toBe("/shipments/some-id/track");
    expect(capturedHeaders["authorization"]).toBe(`Bearer ${token}`);
    expect(capturedHeaders["x-user-id"]).toBe("55555555-5555-5555-5555-555555555555");
    expect(capturedHeaders["x-user-roles"]).toBe("sender,carrier");
    expect(capturedHeaders["x-kyc-status"]).toBe(KycStatus.NOT_STARTED);

    ws.close();
    await new Promise((resolve) => ws.once("close", resolve));
  });

  it("también reenvía el upgrade de /support (WebSocket de una consulta, MOVO-320) con la identidad inyectada", async () => {
    const token = signAccessToken({
      sub: "66666666-6666-6666-6666-666666666666",
      roles: [UserRole.SENDER],
      kycStatus: KycStatus.NOT_STARTED,
    });

    const ws = new WebSocket(`${gatewayBaseUrl}/api/v1/support/conversations/some-id`, {
      headers: { authorization: `Bearer ${token}`, "x-user-id": "attacker-controlled" },
    });

    const message = await new Promise<unknown>((resolve, reject) => {
      ws.once("message", (data: Buffer) => resolve(JSON.parse(data.toString())));
      ws.once("error", reject);
      ws.once("unexpected-response", (_req, res) => reject(new Error(`unexpected-response: ${res.statusCode}`)));
    });

    expect(message).toEqual({ type: "connected" });
    expect(capturedUrl).toBe("/support/conversations/some-id");
    // `svc-shipments` autoriza el handshake con el JWT: tiene que llegar el `authorization`.
    expect(capturedHeaders["authorization"]).toBe(`Bearer ${token}`);
    expect(capturedHeaders["x-user-id"]).toBe("66666666-6666-6666-6666-666666666666");

    ws.close();
    await new Promise((resolve) => ws.once("close", resolve));
  });

  it("MOVO-322: el WebSocket del panel entra sin JWT y llega al upstream con el subprotocolo completo y el origin", async () => {
    const ticket = "t".repeat(43);
    const ws = new WebSocket(`${gatewayBaseUrl}/api/v1/admin/support/ws`, [SUPPORT_WS_PROTOCOL, ticket], {
      headers: { origin: "https://admin.movosend.app", "x-ws-protocols": "falsificado" },
    });

    const message = await new Promise<unknown>((resolve, reject) => {
      ws.once("message", (data: Buffer) => resolve(JSON.parse(data.toString())));
      ws.once("error", reject);
      ws.once("unexpected-response", (_req, res) => reject(new Error(`unexpected-response: ${res.statusCode}`)));
    });

    expect(message).toEqual({ type: "connected" });
    expect(capturedUrl).toBe("/admin/support/ws");
    // El gateway le responde al navegador solo el primer subprotocolo, nunca el ticket.
    expect(ws.protocol).toBe(SUPPORT_WS_PROTOCOL);
    expect(capturedHeaders["x-ws-protocols"]).toBe(`${SUPPORT_WS_PROTOCOL},${ticket}`);
    expect(capturedHeaders["origin"]).toBe("https://admin.movosend.app");
    expect(capturedHeaders["x-user-id"]).toBeUndefined();

    ws.close();
    await new Promise((resolve) => ws.once("close", resolve));
  });

  it("MOVO-322: sin ticket el upgrade del panel se rechaza antes de abrirse", async () => {
    for (const protocols of [[SUPPORT_WS_PROTOCOL], ["otro", "t".repeat(43)]]) {
      const ws = new WebSocket(`${gatewayBaseUrl}/api/v1/admin/support/ws`, protocols);
      const status = await new Promise<number | null>((resolve) => {
        ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? null));
        ws.once("open", () => resolve(null));
        ws.once("error", () => resolve(-1));
      });
      expect(status).toBe(401);
    }
  });

  it("MOVO-322: el WebSocket del panel tiene un límite propio de 20 intentos por minuto, con ticket o sin él", async () => {
    const statuses: Array<number | null> = [];
    for (let i = 0; i < 21; i++) {
      const ws = new WebSocket(`${gatewayBaseUrl}/api/v1/admin/support/ws`, [SUPPORT_WS_PROTOCOL]);
      statuses.push(
        await new Promise<number | null>((resolve) => {
          ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? null));
          ws.once("open", () => resolve(null));
          ws.once("error", () => resolve(-1));
        })
      );
    }
    expect(statuses.slice(0, 20).every((status) => status === 401)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("una conexión sin token no propaga x-user-* (preHandler la corta antes del upgrade)", async () => {
    const ws = new WebSocket(`${gatewayBaseUrl}/api/v1/shipments/some-id/track`);

    await new Promise<void>((resolve) => {
      // Sin JWT, `app.authenticate` responde 401 antes de hijackear la conexión --
      // el cliente WS lo ve como un `unexpected-response`/`error`, nunca como un
      // upgrade exitoso.
      ws.once("unexpected-response", () => resolve());
      ws.once("error", () => resolve());
      ws.once("open", () => resolve());
    });

    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });
});
