import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildSignatureManifest,
  parseSignatureHeader,
  verifyMpWebhookSignature,
} from "../src/utils/mp-webhook-signature";

const SECRET = "clave-secreta-de-webhooks";

function sign(manifest: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

describe("firma del webhook de MP (MOVO-268 AC2)", () => {
  it("arma el manifest que documenta MP", () => {
    expect(buildSignatureManifest("123456", "req-1", "1700000000")).toBe("id:123456;request-id:req-1;ts:1700000000;");
  });

  it("pasa a minúscula un data.id alfanumérico y omite lo que no vino", () => {
    expect(buildSignatureManifest("ABC123", undefined, "17")).toBe("id:abc123;ts:17;");
    expect(buildSignatureManifest(undefined, "req-1", "17")).toBe("request-id:req-1;ts:17;");
  });

  it("parsea el header con espacios y en cualquier orden", () => {
    expect(parseSignatureHeader("v1=abc, ts=17")).toEqual({ ts: "17", v1: "abc" });
    expect(parseSignatureHeader("ts=17")).toBeNull();
  });

  it("acepta una firma válida", () => {
    const v1 = sign("id:123456;request-id:req-1;ts:1700000000;");
    expect(
      verifyMpWebhookSignature({
        signatureHeader: `ts=1700000000,v1=${v1}`,
        requestId: "req-1",
        dataId: "123456",
        secret: SECRET,
      })
    ).toBe(true);
  });

  it("acepta una firma vieja: no hay ventana sobre ts (decisión del ticket)", () => {
    const v1 = sign("id:1;request-id:r;ts:1;");
    expect(verifyMpWebhookSignature({ signatureHeader: `ts=1,v1=${v1}`, requestId: "r", dataId: "1", secret: SECRET })).toBe(
      true
    );
  });

  it.each([
    ["sin header", undefined],
    ["header sin v1", "ts=1700000000"],
    ["v1 no hexadecimal", "ts=1700000000,v1=zzzz"],
    ["v1 de otro largo", "ts=1700000000,v1=abcd"],
  ])("rechaza %s", (_label, signatureHeader) => {
    expect(verifyMpWebhookSignature({ signatureHeader, requestId: "req-1", dataId: "123456", secret: SECRET })).toBe(false);
  });

  it("rechaza si cambia cualquier parte firmada o la clave", () => {
    const v1 = sign("id:123456;request-id:req-1;ts:1700000000;");
    const base = { signatureHeader: `ts=1700000000,v1=${v1}`, requestId: "req-1", dataId: "123456", secret: SECRET };
    expect(verifyMpWebhookSignature({ ...base, dataId: "123457" })).toBe(false);
    expect(verifyMpWebhookSignature({ ...base, requestId: "req-2" })).toBe(false);
    expect(verifyMpWebhookSignature({ ...base, signatureHeader: `ts=1700000001,v1=${v1}` })).toBe(false);
    expect(verifyMpWebhookSignature({ ...base, secret: "otra" })).toBe(false);
  });
});
