import { base64ToBytes } from "../src/crypto/bytes";

// `require`, no `import { webcrypto } from "node:crypto"`: este paquete no tiene
// `@types/node` instalado (RN/Hermes no es Node) — el test corre en Jest (proceso
// Node real), así que `webcrypto` real está disponible en runtime, solo evitamos que
// `tsc` intente resolver tipos de un módulo `node:` que el proyecto no tipa.
const { webcrypto } = require("node:crypto");

const FIXTURE_PRIVATE_KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=";
const FIXTURE_PUBLIC_KEY_B64 =
  "BGsX0fLhLEJH+Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT+NC4v4af5uO5+tKfA+eFivOM1drMV7Oy7ZAaDe/UfU=";

jest.mock("../src/crypto/keypair", () => ({
  getOrCreateDeviceKeyPair: jest.fn().mockResolvedValue({
    privateKey: require("../src/crypto/bytes").base64ToBytes(
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=",
    ),
    publicKeyBase64:
      "BGsX0fLhLEJH+Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT+NC4v4af5uO5+tKfA+eFivOM1drMV7Oy7ZAaDe/UfU=",
  }),
}));

import { signHandshakeNonce } from "../src/crypto/signing";

/**
 * Reproduce EXACTAMENTE `verifyHandshakeSignature` de
 * `services/movo-svc-shipments/src/domain/handshake-crypto.ts` (ADR-020) -- mismos
 * parámetros de `importKey`/`verify`. Corre en Node (Jest), donde `webcrypto` real
 * está disponible, así que esto verifica compatibilidad byte a byte con el backend
 * sin necesitar levantarlo.
 */
async function verifyLikeBackend(canonicalPayload: string, signatureB64: string, publicKeyB64: string) {
  const key = await webcrypto.subtle.importKey(
    "raw",
    base64ToBytes(publicKeyB64),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return webcrypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64ToBytes(signatureB64),
    new TextEncoder().encode(canonicalPayload),
  );
}

describe("signHandshakeNonce", () => {
  it("produce una firma que el backend (webcrypto.subtle.verify) acepta como válida", async () => {
    const canonicalPayload = "shp_1:pickup:nonce-abc";

    const signature = await signHandshakeNonce(canonicalPayload);
    const isValid = await verifyLikeBackend(canonicalPayload, signature, FIXTURE_PUBLIC_KEY_B64);

    expect(isValid).toBe(true);
  });

  it("la firma mide 64 bytes (IEEE P1363, r‖s, no DER)", async () => {
    const signature = await signHandshakeNonce("shp_1:delivery:nonce-xyz");
    expect(base64ToBytes(signature).length).toBe(64);
  });

  it("una firma válida para un payload no sirve para otro (protección contra replay)", async () => {
    const signature = await signHandshakeNonce("shp_1:pickup:nonce-abc");
    const isValidForDifferentPayload = await verifyLikeBackend(
      "shp_1:pickup:nonce-DISTINTO",
      signature,
      FIXTURE_PUBLIC_KEY_B64,
    );
    expect(isValidForDifferentPayload).toBe(false);
  });

  it("nunca incluye la clave privada en el resultado", async () => {
    const signature = await signHandshakeNonce("shp_1:pickup:nonce-abc");
    expect(signature).not.toContain(FIXTURE_PRIVATE_KEY_B64);
  });
});
