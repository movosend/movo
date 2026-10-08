import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import Fastify from "fastify";
import { loggerOptions, redactUrl } from "../src/config/logger";

describe("logs del gateway sin el query del callback de MP (MOVO-111, review de PR #223)", () => {
  it("redactUrl solo oculta el query del callback", () => {
    expect(redactUrl("/api/v1/payments/mp-connect/callback?code=TG-x&state=s")).toBe(
      "/api/v1/payments/mp-connect/callback?[REDACTED]"
    );
    expect(redactUrl("/api/v1/payments/mp-connect/callback")).toBe("/api/v1/payments/mp-connect/callback");
    expect(redactUrl("/api/v1/auth/register?ref=campaign")).toBe("/api/v1/auth/register?ref=campaign");
  });

  it("el log del request no incluye el code", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    // El mismo `loggerOptions` que usa buildApp(), solo con la salida redirigida.
    const app = Fastify({ logger: { ...loggerOptions, stream } });
    app.get("/api/v1/payments/mp-connect/callback", async () => ({ ok: true }));

    await app.inject({ method: "GET", url: "/api/v1/payments/mp-connect/callback?code=TG-secret-code&state=s" });
    await app.close();

    const logged = lines.join("");
    expect(logged).not.toContain("TG-secret-code");
    expect(logged).toContain("/api/v1/payments/mp-connect/callback?[REDACTED]");
  });
});
