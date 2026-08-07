import { describe, it, expect } from "vitest";
import { createMockDiditClient } from "../../src/adapters/mock-didit-client";

describe("Mock Didit Client (DIDIT_MODE=mock, default, MOVO-72)", () => {
  it("genera una sesión sintética sin red, con sessionId/sessionToken/url no vacíos", async () => {
    const client = createMockDiditClient();

    const session = await client.createSession({ vendorData: "user-123" });

    expect(session.sessionId).toEqual(expect.any(String));
    expect(session.sessionId.length).toBeGreaterThan(0);
    expect(session.sessionToken).toContain(session.sessionId);
    expect(session.url).toContain(session.sessionId);
  });

  it("genera un sessionId distinto en cada llamada", async () => {
    const client = createMockDiditClient();

    const first = await client.createSession({ vendorData: "user-1" });
    const second = await client.createSession({ vendorData: "user-2" });

    expect(first.sessionId).not.toBe(second.sessionId);
  });
});
