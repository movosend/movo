import { webcrypto } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import {
  buildHandshakeCanonicalPayload,
  verifyHandshakeSignature,
  HANDSHAKE_QR_TTL_SECONDS,
} from "../src/domain/handshake-crypto";

const { subtle } = webcrypto;

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;
}

async function exportPublicKeyBase64(publicKey: CryptoKey): Promise<string> {
  const raw = await subtle.exportKey("raw", publicKey);
  return Buffer.from(raw).toString("base64");
}

async function signPayload(privateKey: CryptoKey, payload: string): Promise<string> {
  const signature = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(payload));
  return Buffer.from(signature).toString("base64");
}

describe("buildHandshakeCanonicalPayload", () => {
  it("concatena shipmentId:stage:nonce", () => {
    expect(buildHandshakeCanonicalPayload("ship-1", "pickup", "nonce-1")).toBe("ship-1:pickup:nonce-1");
  });

  it("difiere si cambia el stage (evita replay de un stage a otro)", () => {
    const pickup = buildHandshakeCanonicalPayload("ship-1", "pickup", "nonce-1");
    const delivery = buildHandshakeCanonicalPayload("ship-1", "delivery", "nonce-1");
    expect(pickup).not.toBe(delivery);
  });
});

describe("verifyHandshakeSignature", () => {
  let keyPair: CryptoKeyPair;
  let publicKeyB64: string;
  const payload = buildHandshakeCanonicalPayload("ship-1", "pickup", "nonce-real");

  beforeAll(async () => {
    keyPair = await generateKeyPair();
    publicKeyB64 = await exportPublicKeyBase64(keyPair.publicKey);
  });

  it("valida una firma real contra su clave pública", async () => {
    const signature = await signPayload(keyPair.privateKey, payload);
    await expect(verifyHandshakeSignature(payload, signature, publicKeyB64)).resolves.toBe(true);
  });

  it("acepta la clave pública en base64url además de base64 estándar", async () => {
    const signature = await signPayload(keyPair.privateKey, payload);
    const base64Url = publicKeyB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await expect(verifyHandshakeSignature(payload, signature, base64Url)).resolves.toBe(true);
  });

  it("rechaza una firma válida pero para un payload distinto (tampering del payload)", async () => {
    const signature = await signPayload(keyPair.privateKey, payload);
    const tamperedPayload = buildHandshakeCanonicalPayload("ship-1", "pickup", "nonce-otro");
    await expect(verifyHandshakeSignature(tamperedPayload, signature, publicKeyB64)).resolves.toBe(false);
  });

  it("rechaza una firma generada con OTRA clave privada (cedente distinto)", async () => {
    const otherKeyPair = await generateKeyPair();
    const signature = await signPayload(otherKeyPair.privateKey, payload);
    await expect(verifyHandshakeSignature(payload, signature, publicKeyB64)).resolves.toBe(false);
  });

  it("rechaza una firma corrupta (bytes al azar)", async () => {
    const garbageSignature = Buffer.from("no-soy-una-firma-real").toString("base64");
    await expect(verifyHandshakeSignature(payload, garbageSignature, publicKeyB64)).resolves.toBe(false);
  });

  it("rechaza una clave pública malformada sin lanzar (nunca 500)", async () => {
    const signature = await signPayload(keyPair.privateKey, payload);
    await expect(verifyHandshakeSignature(payload, signature, "no-es-una-clave-valida-@@@")).resolves.toBe(false);
  });

  it("rechaza un valor de firma no-base64 sin lanzar", async () => {
    await expect(verifyHandshakeSignature(payload, "@@@no-base64@@@", publicKeyB64)).resolves.toBe(false);
  });
});

describe("HANDSHAKE_QR_TTL_SECONDS", () => {
  it("es 15 (AC1/AC5 de MOVO-158)", () => {
    expect(HANDSHAKE_QR_TTL_SECONDS).toBe(15);
  });
});
