import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createNotificationsClient } from "../src/adapters/notifications-client";

describe("NotificationsClient", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("envía la push al path correcto (/internal/notifications/push) de movo-svc-users", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    globalThis.fetch = fetchMock;

    const client = createNotificationsClient({
      USERS_SERVICE_URL: "http://movo-svc-users:3000",
    });

    await client.sendPush({
      userId: "user-123",
      title: "Envío aceptado",
      body: "Lucía aceptó el envío",
      data: { shipmentId: "shipment-123", type: "shipment_accepted" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://movo-svc-users:3000/internal/notifications/push",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          userId: "user-123",
          title: "Envío aceptado",
          body: "Lucía aceptó el envío",
          data: { shipmentId: "shipment-123", type: "shipment_accepted" },
        }),
      })
    );
  });

  it("lanza error si la respuesta no es ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    globalThis.fetch = fetchMock;

    const client = createNotificationsClient({
      USERS_SERVICE_URL: "http://movo-svc-users:3000",
    });

    await expect(
      client.sendPush({
        userId: "user-123",
        title: "Test",
        body: "Test body",
      })
    ).rejects.toThrow("El servicio de notificaciones devolvió status 500");
  });
});
