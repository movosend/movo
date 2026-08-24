import { describe, it, expect, vi, beforeEach } from "vitest";
import { createExpoPushProvider } from "../../src/adapters/expo-push-provider";

// Mismo criterio que http-didit-client.test.ts/twilio-sms-provider.test.ts: se
// mockea fetch en vez de pegarle a la API real de Expo en cada corrida de CI.
const fetchMock = vi.fn();

describe("Expo Push Provider (adapter concreto, MOVO-106)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("postea a https://exp.host/--/api/v2/push/send con to/title/body/data", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [{ status: "ok" }] }) });

    const provider = createExpoPushProvider();
    await provider.send({
      expoPushToken: "ExponentPushToken[abc]",
      title: "Nueva oferta",
      body: "Tenés una oferta nueva",
      data: { type: "shipment", shipmentId: "ship-1" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual([
      {
        to: "ExponentPushToken[abc]",
        title: "Nueva oferta",
        body: "Tenés una oferta nueva",
        data: { type: "shipment", shipmentId: "ship-1" },
      },
    ]);
  });

  it("mapea una respuesta HTTP no-ok a ApiError 502 PUSH_PROVIDER_ERROR", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    const provider = createExpoPushProvider();
    await expect(
      provider.send({ expoPushToken: "ExponentPushToken[abc]", title: "t", body: "b" })
    ).rejects.toMatchObject({ statusCode: 502, code: "PUSH_PROVIDER_ERROR" });
  });

  it("mapea un ticket con status 'error' (200 HTTP, envío fallido) a ApiError 502 PUSH_PROVIDER_ERROR", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: "error", message: "DeviceNotRegistered" }] }),
    });

    const provider = createExpoPushProvider();
    await expect(
      provider.send({ expoPushToken: "ExponentPushToken[stale]", title: "t", body: "b" })
    ).rejects.toMatchObject({ statusCode: 502, code: "PUSH_PROVIDER_ERROR", message: "DeviceNotRegistered" });
  });

  it("mapea un fallo de red a ApiError 502 PUSH_PROVIDER_ERROR", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const provider = createExpoPushProvider();
    await expect(
      provider.send({ expoPushToken: "ExponentPushToken[abc]", title: "t", body: "b" })
    ).rejects.toMatchObject({ statusCode: 502, code: "PUSH_PROVIDER_ERROR" });
  });
});
