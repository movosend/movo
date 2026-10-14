import { describe, it, expect, vi, afterEach } from "vitest";
import { createUsersClient } from "../src/adapters/users-client";

const client = createUsersClient({ USERS_SERVICE_URL: "http://users:3000" });
const USER = "11111111-1111-4111-8111-111111111111";

describe("users-client.findAccountEmail (MOVO-100)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pide /users/me con el x-user-id del emisor y devuelve el email", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ email: "e@example.com" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await client.findAccountEmail(USER)).toBe("e@example.com");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://users:3000/users/me");
    expect(init.headers).toEqual({ "x-user-id": USER });
  });

  it("devuelve null si la cuenta no existe o no trae email", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    expect(await client.findAccountEmail(USER)).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ email: "" }), { status: 200 })));
    expect(await client.findAccountEmail(USER)).toBeNull();
  });

  it("falla cerrado con 502 ante un error de svc-users o de red", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    await expect(client.findAccountEmail(USER)).rejects.toMatchObject({ statusCode: 502, code: "USERS_SERVICE_UNAVAILABLE" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(client.findAccountEmail(USER)).rejects.toMatchObject({ statusCode: 502, code: "USERS_SERVICE_UNAVAILABLE" });
  });
});
