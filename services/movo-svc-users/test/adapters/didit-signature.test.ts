import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import { verifyDiditSignature, canonicalizeJson } from "../../src/adapters/didit-signature";

const SECRET = "webhook_secret_test";

function sign(body: unknown): { rawBody: Buffer; signature: string } {
  const rawBody = Buffer.from(JSON.stringify(body), "utf8");
  const signature = createHmac("sha256", SECRET).update(canonicalizeJson(body)).digest("hex");
  return { rawBody, signature };
}

describe("verifyDiditSignature (AC5, MOVO-72)", () => {
  it("acepta una firma válida con timestamp dentro de la ventana", () => {
    const { rawBody, signature } = sign({ status: "Approved", session_id: "sess_1" });
    const now = String(Math.floor(Date.now() / 1000));

    expect(() => verifyDiditSignature(rawBody, signature, now, SECRET)).not.toThrow();
  });

  it("rechaza una firma inválida", () => {
    const { rawBody } = sign({ status: "Approved", session_id: "sess_1" });
    const now = String(Math.floor(Date.now() / 1000));

    expect(() => verifyDiditSignature(rawBody, "0".repeat(64), now, SECRET)).toThrowError();
    try {
      verifyDiditSignature(rawBody, "0".repeat(64), now, SECRET);
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 401, code: "KYC_WEBHOOK_INVALID_SIGNATURE" });
    }
  });

  it("rechaza si falta el header de firma", () => {
    const { rawBody } = sign({ status: "Approved", session_id: "sess_1" });
    const now = String(Math.floor(Date.now() / 1000));

    expect(() => verifyDiditSignature(rawBody, undefined, now, SECRET)).toThrowError();
  });

  it("rechaza si falta el header de timestamp", () => {
    const { rawBody, signature } = sign({ status: "Approved", session_id: "sess_1" });

    expect(() => verifyDiditSignature(rawBody, signature, undefined, SECRET)).toThrowError();
  });

  it("rechaza un timestamp más de 300s en el pasado (anti-replay)", () => {
    const { rawBody, signature } = sign({ status: "Approved", session_id: "sess_1" });
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 301);

    try {
      verifyDiditSignature(rawBody, signature, staleTimestamp, SECRET);
      expect.unreachable("debería haber lanzado");
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 401, code: "KYC_WEBHOOK_INVALID_SIGNATURE" });
    }
  });

  it("rechaza un timestamp más de 300s en el futuro", () => {
    const { rawBody, signature } = sign({ status: "Approved", session_id: "sess_1" });
    const futureTimestamp = String(Math.floor(Date.now() / 1000) + 301);

    expect(() => verifyDiditSignature(rawBody, signature, futureTimestamp, SECRET)).toThrowError();
  });

  it("acepta un timestamp justo dentro del límite (299s)", () => {
    const { rawBody, signature } = sign({ status: "Approved", session_id: "sess_1" });
    const okTimestamp = String(Math.floor(Date.now() / 1000) - 299);

    expect(() => verifyDiditSignature(rawBody, signature, okTimestamp, SECRET)).not.toThrow();
  });

  it("rechaza un body que no es JSON válido", () => {
    const now = String(Math.floor(Date.now() / 1000));
    expect(() => verifyDiditSignature(Buffer.from("no-es-json"), "0".repeat(64), now, SECRET)).toThrowError();
  });

  it("el orden de las claves del body no cambia la firma esperada (JSON canónico)", () => {
    const now = String(Math.floor(Date.now() / 1000));
    const bodyA = { status: "Approved", session_id: "sess_1" };
    const bodyB = { session_id: "sess_1", status: "Approved" };

    const signature = createHmac("sha256", SECRET).update(canonicalizeJson(bodyA)).digest("hex");
    const rawBodyReordered = Buffer.from(JSON.stringify(bodyB), "utf8");

    expect(() => verifyDiditSignature(rawBodyReordered, signature, now, SECRET)).not.toThrow();
  });
});

describe("canonicalizeJson", () => {
  it("ordena claves de objetos anidados recursivamente", () => {
    expect(canonicalizeJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("preserva el orden de los arrays", () => {
    expect(canonicalizeJson([3, 1, 2])).toBe("[3,1,2]");
  });
});
