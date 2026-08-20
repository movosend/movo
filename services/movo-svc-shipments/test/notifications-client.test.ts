import { describe, it, expect, vi, afterEach } from "vitest";
import { FastifyBaseLogger } from "fastify";
import { createNotificationsClient } from "../src/adapters/notifications-client";

function fakeLogger(): FastifyBaseLogger {
  return { warn: vi.fn() } as unknown as FastifyBaseLogger;
}

const input = { userId: "user-id", title: "Título", body: "Cuerpo" };

describe("createNotificationsClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("manda el POST al endpoint interno de svc-users con el payload esperado", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const client = createNotificationsClient({ USERS_SERVICE_URL: "http://svc-users" }, fakeLogger());
    await client.sendPush(input);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://svc-users/internal/notifications/push",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      })
    );
  });

  it("AC5: una respuesta no-2xx no rechaza — se loguea event: notification_dispatch_failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const logger = fakeLogger();

    const client = createNotificationsClient({ USERS_SERVICE_URL: "http://svc-users" }, logger);
    await expect(client.sendPush(input)).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "notification_dispatch_failed", userId: "user-id" }),
      expect.any(String)
    );
  });

  it("AC5: una falla de red (timeout incluido) no rechaza", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const logger = fakeLogger();

    const client = createNotificationsClient({ USERS_SERVICE_URL: "http://svc-users" }, logger);
    await expect(client.sendPush(input)).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "notification_dispatch_failed" }),
      expect.any(String)
    );
  });
});
