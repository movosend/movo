import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { createTelegramAlertNotifier } from "../src/adapters/alert-notifier";
import {
  createShipmentsClient,
  ShipmentNotFoundError,
  ShipmentsUnavailableError,
} from "../src/adapters/shipments-client";

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as FastifyBaseLogger;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("TelegramAlertNotifier (MOVO-268)", () => {
  const alert = {
    kind: "mp_chargeback",
    message: "Contracargo",
    context: { shipmentId: "s-1", mpPaymentId: "123", refundedArs: null },
  };

  it("manda el mensaje al chat con el ambiente y omite los valores vacíos", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    await createTelegramAlertNotifier({ botToken: "TOKEN", chatId: "-100", environmentLabel: "dev" }, log).send(alert);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/botTOKEN/sendMessage");
    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe("-100");
    expect(body.text).toContain("[dev]");
    expect(body.text).toContain("mpPaymentId: 123");
    expect(body.text).not.toContain("refundedArs");
    // Siempre queda también en el log.
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ alert: "mp_chargeback" }), expect.any(String));
  });

  it("si Telegram falla no tira: lo loguea", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("red caída"); }));
    await expect(createTelegramAlertNotifier({ botToken: "T", chatId: "C" }, log).send(alert)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ reason: "red caída" }), expect.any(String));
  });
});

describe("ShipmentsClient.notifyHoldEvent (MOVO-268)", () => {
  const event = { holdId: "h-1", event: "expired" as const, statusDetail: "expired" };

  it("postea al endpoint interno y devuelve el resultado", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ handled: true, outcome: "reconfirmation_requested" })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createShipmentsClient("http://shipments:3000").notifyHoldEvent("ship-1", event);

    expect(result).toEqual({ handled: true, outcome: "reconfirmation_requested" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://shipments:3000/internal/shipments/ship-1/hold-events");
    expect(JSON.parse(init.body as string)).toEqual(event);
  });

  it("404 es ShipmentNotFoundError; 5xx, red o respuesta inválida son ShipmentsUnavailableError", async () => {
    const client = createShipmentsClient("http://shipments:3000");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    await expect(client.notifyHoldEvent("s", event)).rejects.toBeInstanceOf(ShipmentNotFoundError);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(client.notifyHoldEvent("s", event)).rejects.toBeInstanceOf(ShipmentsUnavailableError);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(client.notifyHoldEvent("s", event)).rejects.toBeInstanceOf(ShipmentsUnavailableError);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }))));
    await expect(client.notifyHoldEvent("s", event)).rejects.toBeInstanceOf(ShipmentsUnavailableError);
  });
});
