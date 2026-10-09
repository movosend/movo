import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import Fastify from "fastify";
import { loggerOptions, REDACT_CENSOR, REDACTED_KEYS } from "../src/config/logger";

function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  // El mismo `loggerOptions` que usa buildApp(), solo con la salida redirigida.
  const app = Fastify({ logger: { ...loggerOptions, stream } });
  return { logger: app.log, output: () => lines.join("") };
}

describe("redacción de secretos en logs (MOVO-267 AC6)", () => {
  it("no imprime tokens OAuth, client_secret ni datos de tarjeta", () => {
    const { logger, output } = captureLogger();

    logger.info(
      {
        // Respuesta de /oauth/token tal como la loguearía MOVO-111 por descuido.
        oauth: {
          access_token: "TEST-access-secret",
          refresh_token: "TG-refresh-secret",
          user_id: 2991764998,
          public_key: "TEST-public-key",
        },
        request: { client_secret: "client-secret-value", code_verifier: "verifier-value" },
        card: {
          token: "card-token-value",
          card_number: "4509953566233704",
          security_code: "123",
          cardholder: { name: "APRO" },
        },
      },
      "mp call"
    );

    const logged = output();
    for (const secret of [
      "TEST-access-secret",
      "TG-refresh-secret",
      "client-secret-value",
      "verifier-value",
      "card-token-value",
      "4509953566233704",
      "APRO",
    ]) {
      expect(logged).not.toContain(secret);
    }
    // Lo que no es secreto sigue visible: el log tiene que servir para diagnosticar.
    expect(logged).toContain("2991764998");
    expect(logged).toContain("TEST-public-key");
    expect(logged).toContain(REDACT_CENSOR);
  });

  it("redacta la clave en el nivel raíz y en objetos anidados hasta 3 niveles", () => {
    const { logger, output } = captureLogger();

    logger.info({
      access_token: "nivel-0",
      a: { access_token: "nivel-1", b: { access_token: "nivel-2", c: { access_token: "nivel-3" } } },
    });

    const logged = output();
    for (const value of ["nivel-0", "nivel-1", "nivel-2", "nivel-3"]) {
      expect(logged).not.toContain(value);
    }
  });

  it("redacta el header authorization del request", () => {
    const { logger, output } = captureLogger();

    logger.info({ req: { headers: { authorization: "Bearer jwt-del-usuario" } } });

    expect(output()).not.toContain("jwt-del-usuario");
  });

  it("cubre las variantes camelCase de cada clave", () => {
    expect(REDACTED_KEYS).toEqual(
      expect.arrayContaining(["accessToken", "refreshToken", "clientSecret", "codeVerifier"])
    );
  });

  it("no loguea el query string del callback de OAuth (MOVO-111)", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const app = Fastify({ logger: { ...loggerOptions, stream } });
    app.get("/payments/mp-connect/callback", async () => ({ ok: true }));
    app.get("/payments/otra", async () => ({ ok: true }));

    await app.inject({ method: "GET", url: "/payments/mp-connect/callback?code=TG-secret-code&state=s" });
    await app.inject({ method: "GET", url: "/payments/otra?visible=1" });
    await app.close();

    const logged = lines.join("");
    expect(logged).not.toContain("TG-secret-code");
    expect(logged).toContain("/payments/mp-connect/callback?[REDACTED]");
    expect(logged).toContain("/payments/otra?visible=1");
  });

  it("redacta secretos anidados hasta 6 niveles (p. ej. el cause de un error del SDK)", () => {
    const { logger, output } = captureLogger();
    logger.info({ err: { cause: [{ body: { data: { access_token: "deep-secret" } } }] } }, "mp error");
    expect(output()).not.toContain("deep-secret");
  });
});
