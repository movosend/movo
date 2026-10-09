import { describe, it, expect } from "vitest";
import { createTokenCipher, parseEncryptionKey, TokenCipherError } from "../src/utils/token-cipher";

const KEY = Buffer.alloc(32, 1).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 2).toString("base64");

describe("token-cipher (AES-256-GCM, review de PR #223)", () => {
  it("cifra y descifra ida y vuelta", () => {
    const cipher = createTokenCipher(KEY);
    const payload = cipher.encrypt("TEST-access-token");

    expect(payload).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(payload).not.toContain("TEST-access-token");
    expect(cipher.decrypt(payload)).toBe("TEST-access-token");
  });

  it("usa un IV aleatorio: el mismo texto cifra distinto cada vez", () => {
    const cipher = createTokenCipher(KEY);

    expect(cipher.encrypt("x")).not.toBe(cipher.encrypt("x"));
  });

  it("con otra key no descifra", () => {
    const payload = createTokenCipher(KEY).encrypt("secreto");

    expect(() => createTokenCipher(OTHER_KEY).decrypt(payload)).toThrow(TokenCipherError);
  });

  it("detecta un dato alterado (auth tag de GCM)", () => {
    const cipher = createTokenCipher(KEY);
    const [version, iv, tag, data] = cipher.encrypt("secreto").split(":");
    const tampered = Buffer.from(data, "base64url");
    tampered[0] ^= 0xff;

    expect(() => cipher.decrypt([version, iv, tag, tampered.toString("base64url")].join(":"))).toThrow(
      TokenCipherError
    );
  });

  it("rechaza un formato desconocido (ej. un token guardado en texto plano)", () => {
    expect(() => createTokenCipher(KEY).decrypt("TEST-plano")).toThrow(/formato desconocido/);
  });

  it("falla explícito si la key falta o no es de 32 bytes, sin mostrar su valor", () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(/no está configurada/);
    expect(() => parseEncryptionKey(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
    expect(() => createTokenCipher("").encrypt("x")).toThrow(TokenCipherError);
  });
});
