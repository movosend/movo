import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTelegramSmsProvider } from "../../src/adapters/telegram-sms-provider";

// Mismo criterio que twilio-sms-provider.test.ts: se mockea fetch en vez de pegarle a
// la API real de Telegram en cada corrida de CI.
const fetchMock = vi.fn();

describe("Telegram SMS Provider (adapter concreto, AC8, exclusivo de develop)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("send() postea al endpoint sendMessage del bot con chat_id y el código en el texto", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });

    const provider = createTelegramSmsProvider({ botToken: "bot_test_token", chatId: "-100123456" });
    await provider.send("+5493511234567", "482913");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/botbot_test_token/sendMessage");
    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe("-100123456");
    expect(body.text).toContain("+5493511234567");
    expect(body.text).toContain("482913");
  });

  it("lanza si la respuesta HTTP no es 2xx", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ ok: false, description: "Unauthorized" }) });

    const provider = createTelegramSmsProvider({ botToken: "bad_token", chatId: "-100123456" });

    await expect(provider.send("+5493511234567", "482913")).rejects.toThrow();
  });

  it("lanza si Telegram responde 200 pero con ok: false en el body", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, description: "chat not found" }),
    });

    const provider = createTelegramSmsProvider({ botToken: "bot_test_token", chatId: "-1" });

    await expect(provider.send("+5493511234567", "482913")).rejects.toThrow(/chat not found/);
  });
});
