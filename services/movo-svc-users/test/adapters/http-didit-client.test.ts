import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHttpDiditClient } from "../../src/adapters/http-didit-client";

// Mismo criterio que twilio/telegram-sms-provider.test.ts: se mockea fetch en vez de
// pegarle al sandbox real de Didit.me en cada corrida de CI.
const fetchMock = vi.fn();

describe("HTTP Didit Client (adapter concreto, MOVO-72)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("createSession() postea a {baseUrl}/v3/session/ con x-api-key y el workflow_id/vendor_data/callback", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ session_id: "sess_123", session_token: "tok_123", url: "https://verification.didit.me/s/sess_123" }),
    });

    const client = createHttpDiditClient({
      baseUrl: "https://verification.didit.me",
      apiKey: "api_key_test",
      workflowId: "workflow_test",
    });

    const result = await client.createSession({ vendorData: "user-123", callbackUrl: "https://movo.test/callback" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://verification.didit.me/v3/session/");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("api_key_test");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ workflow_id: "workflow_test", vendor_data: "user-123", callback: "https://movo.test/callback" });

    expect(result).toEqual({ sessionId: "sess_123", sessionToken: "tok_123", url: "https://verification.didit.me/s/sess_123" });
  });

  it("omite 'callback' del body si no se pasa callbackUrl", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ session_id: "sess_1", session_token: "tok_1", url: "https://verification.didit.me/s/sess_1" }),
    });

    const client = createHttpDiditClient({ baseUrl: "https://verification.didit.me", apiKey: "k", workflowId: "w" });
    await client.createSession({ vendorData: "user-1" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ workflow_id: "w", vendor_data: "user-1" });
  });

  it("mapea una respuesta no-ok (ej. 403 de api-key inválida, ver spike MOVO-48) a ApiError 502 KYC_PROVIDER_ERROR", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });

    const client = createHttpDiditClient({ baseUrl: "https://verification.didit.me", apiKey: "bad", workflowId: "w" });

    await expect(client.createSession({ vendorData: "user-1" })).rejects.toMatchObject({
      statusCode: 502,
      code: "KYC_PROVIDER_ERROR",
    });
  });

  it("mapea un fallo de red/timeout a ApiError 502 KYC_PROVIDER_ERROR", async () => {
    fetchMock.mockRejectedValue(new Error("network error"));

    const client = createHttpDiditClient({ baseUrl: "https://verification.didit.me", apiKey: "k", workflowId: "w" });

    await expect(client.createSession({ vendorData: "user-1" })).rejects.toMatchObject({
      statusCode: 502,
      code: "KYC_PROVIDER_ERROR",
    });
  });

  it("getSessionDecision() pega a {baseUrl}/v3/session/{id}/decision/ y devuelve el status crudo + el cuerpo completo", async () => {
    const decisionBody = {
      session_id: "sess_123",
      status: "Approved",
      id_verifications: [{ warnings: [{ feature: "ID_VERIFICATION", risk: "X", short_description: "y" }] }],
    };
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => decisionBody });

    const client = createHttpDiditClient({ baseUrl: "https://verification.didit.me", apiKey: "k", workflowId: "w" });
    const result = await client.getSessionDecision("sess_123");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://verification.didit.me/v3/session/sess_123/decision/");
    expect(init.method).toBe("GET");
    expect(init.headers["x-api-key"]).toBe("k");
    expect(result).toEqual({ sessionId: "sess_123", rawStatus: "Approved", decision: decisionBody });
  });

  it("getSessionDecision() devuelve null si Didit no conoce la sesión (404), sin tirar", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    const client = createHttpDiditClient({ baseUrl: "https://verification.didit.me", apiKey: "k", workflowId: "w" });

    await expect(client.getSessionDecision("sess_desconocida")).resolves.toBeNull();
  });

  it("getSessionDecision() devuelve null si la respuesta no trae status, en vez de inventar una transicion", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ session_id: "sess_123" }) });

    const client = createHttpDiditClient({ baseUrl: "https://verification.didit.me", apiKey: "k", workflowId: "w" });

    await expect(client.getSessionDecision("sess_123")).resolves.toBeNull();
  });

  it("getSessionDecision() mapea un fallo de red a ApiError 502 KYC_PROVIDER_ERROR (el servicio decide que hacer)", async () => {
    fetchMock.mockRejectedValue(new Error("network error"));

    const client = createHttpDiditClient({ baseUrl: "https://verification.didit.me", apiKey: "k", workflowId: "w" });

    await expect(client.getSessionDecision("sess_123")).rejects.toMatchObject({
      statusCode: 502,
      code: "KYC_PROVIDER_ERROR",
    });
  });
});
