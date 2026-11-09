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
      workflowIds: { identity: "workflow_test", license: "workflow_test_license" },
    });

    const result = await client.createSession({ vendorData: "user-123", verificationType: "identity", callbackUrl: "https://movo.test/callback" });

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

    const client = createHttpDiditClient({ baseUrl: "https://verification.didit.me", apiKey: "k", workflowIds: { identity: "w", license: "w2" } });
    await client.createSession({ vendorData: "user-1", verificationType: "identity" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ workflow_id: "w", vendor_data: "user-1" });
  });

  it("resuelve el workflow_id de licencia por separado del de identidad (MOVO-15)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ session_id: "sess_1", session_token: "tok_1", url: "https://verification.didit.me/s/sess_1" }),
    });

    const client = createHttpDiditClient({
      baseUrl: "https://verification.didit.me",
      apiKey: "k",
      workflowIds: { identity: "workflow_identity", license: "workflow_license" },
    });
    await client.createSession({ vendorData: "user-1", verificationType: "license" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.workflow_id).toBe("workflow_license");
  });

  it("mapea una respuesta no-ok (ej. 403 de api-key inválida, ver spike MOVO-48) a ApiError 502 KYC_PROVIDER_ERROR", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });

    const client = createHttpDiditClient({ baseUrl: "https://verification.didit.me", apiKey: "bad", workflowIds: { identity: "w", license: "w2" } });

    await expect(client.createSession({ vendorData: "user-1", verificationType: "identity" })).rejects.toMatchObject({
      statusCode: 502,
      code: "KYC_PROVIDER_ERROR",
    });
  });

  it("mapea un fallo de red/timeout a ApiError 502 KYC_PROVIDER_ERROR", async () => {
    fetchMock.mockRejectedValue(new Error("network error"));

    const client = createHttpDiditClient({ baseUrl: "https://verification.didit.me", apiKey: "k", workflowIds: { identity: "w", license: "w2" } });

    await expect(client.createSession({ vendorData: "user-1", verificationType: "identity" })).rejects.toMatchObject({
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

    const client = createHttpDiditClient({ baseUrl: "https://verification.didit.me", apiKey: "k", workflowIds: { identity: "w", license: "w2" } });
    const result = await client.getSessionDecision("sess_123");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://verification.didit.me/v3/session/sess_123/decision/");
    expect(init.method).toBe("GET");
    expect(init.headers["x-api-key"]).toBe("k");
    expect(result).toEqual({ sessionId: "sess_123", rawStatus: "Approved", decision: decisionBody });
  });

  it("getSessionDecision() devuelve null si Didit no conoce la sesión (404), sin tirar", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    const client = createHttpDiditClient({ baseUrl: "https://verification.didit.me", apiKey: "k", workflowIds: { identity: "w", license: "w2" } });

    await expect(client.getSessionDecision("sess_desconocida")).resolves.toBeNull();
  });

  it("getSessionDecision() devuelve null si la respuesta no trae status, en vez de inventar una transicion", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ session_id: "sess_123" }) });

    const client = createHttpDiditClient({ baseUrl: "https://verification.didit.me", apiKey: "k", workflowIds: { identity: "w", license: "w2" } });

    await expect(client.getSessionDecision("sess_123")).resolves.toBeNull();
  });

  it("getSessionDecision() mapea un fallo de red a ApiError 502 KYC_PROVIDER_ERROR (el servicio decide que hacer)", async () => {
    fetchMock.mockRejectedValue(new Error("network error"));

    const client = createHttpDiditClient({ baseUrl: "https://verification.didit.me", apiKey: "k", workflowIds: { identity: "w", license: "w2" } });

    await expect(client.getSessionDecision("sess_123")).rejects.toMatchObject({
      statusCode: 502,
      code: "KYC_PROVIDER_ERROR",
    });
  });

  it("updateSessionStatus() hace PATCH a update-status con new_status, comment y send_email false", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    const client = createHttpDiditClient({ baseUrl: "https://verification.didit.me", apiKey: "k", workflowIds: { identity: "w", license: "w2" } });

    await client.updateSessionStatus({ sessionId: "sess_123", newStatus: "Approved", comment: "Documento legible y coincide" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://verification.didit.me/v3/session/sess_123/update-status/");
    expect(init.method).toBe("PATCH");
    expect(init.headers["x-api-key"]).toBe("k");
    expect(JSON.parse(init.body as string)).toEqual({
      new_status: "Approved",
      comment: "Documento legible y coincide",
      send_email: false,
    });
  });

  it("updateSessionStatus() manda un timeout menor a los 15 s de svc-admin", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const client = createHttpDiditClient({ baseUrl: "https://verification.didit.me", apiKey: "k", workflowIds: { identity: "w", license: "w2" } });

    await client.updateSessionStatus({ sessionId: "x", newStatus: "Approved" });

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("updateSessionStatus(): 404 es KYC_SESSION_NOT_FOUND y un 4xx es un rechazo (KYC_PROVIDER_ERROR, no se aplicó nada)", async () => {
    const client = createHttpDiditClient({ baseUrl: "https://verification.didit.me", apiKey: "k", workflowIds: { identity: "w", license: "w2" } });

    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    await expect(client.updateSessionStatus({ sessionId: "x", newStatus: "Declined" })).rejects.toMatchObject({
      statusCode: 404,
      code: "KYC_SESSION_NOT_FOUND",
    });

    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    await expect(client.updateSessionStatus({ sessionId: "x", newStatus: "Declined" })).rejects.toMatchObject({
      statusCode: 502,
      code: "KYC_PROVIDER_ERROR",
    });
  });

  it("updateSessionStatus(): red caída, timeout o 5xx no dicen si se aplicó (KYC_PROVIDER_UNCONFIRMED)", async () => {
    const client = createHttpDiditClient({ baseUrl: "https://verification.didit.me", apiKey: "k", workflowIds: { identity: "w", license: "w2" } });

    fetchMock.mockRejectedValueOnce(new Error("network error"));
    await expect(client.updateSessionStatus({ sessionId: "x", newStatus: "Approved" })).rejects.toMatchObject({
      statusCode: 502,
      code: "KYC_PROVIDER_UNCONFIRMED",
    });

    fetchMock.mockRejectedValueOnce(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    await expect(client.updateSessionStatus({ sessionId: "x", newStatus: "Approved" })).rejects.toMatchObject({
      code: "KYC_PROVIDER_UNCONFIRMED",
    });

    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    await expect(client.updateSessionStatus({ sessionId: "x", newStatus: "Approved" })).rejects.toMatchObject({
      code: "KYC_PROVIDER_UNCONFIRMED",
    });
  });
});
