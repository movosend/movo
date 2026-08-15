import { getJwtExpiresInSeconds } from "../src/lib/jwt";

function makeJwt(payload: unknown): string {
  const base64url = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${base64url({ alg: "none" })}.${base64url(payload)}.sig`;
}

describe("getJwtExpiresInSeconds", () => {
  it("devuelve los segundos restantes de un token con exp futuro", () => {
    const exp = Math.floor(Date.now() / 1000) + 1800;
    const result = getJwtExpiresInSeconds(makeJwt({ exp }));
    expect(result).not.toBeNull();
    expect(result as number).toBeGreaterThan(1790);
    expect(result as number).toBeLessThanOrEqual(1800);
  });

  it("devuelve 0 para un token ya vencido, nunca un valor negativo", () => {
    const exp = Math.floor(Date.now() / 1000) - 60;
    expect(getJwtExpiresInSeconds(makeJwt({ exp }))).toBe(0);
  });

  it("devuelve null si el token no tiene 3 segmentos", () => {
    expect(getJwtExpiresInSeconds("no-es-un-jwt")).toBeNull();
  });

  it("devuelve null si el payload no es JSON válido", () => {
    expect(getJwtExpiresInSeconds("aGVhZGVy.no-es-json.sig")).toBeNull();
  });

  it("devuelve null si el payload no tiene claim exp numérico", () => {
    expect(getJwtExpiresInSeconds(makeJwt({ sub: "u-1" }))).toBeNull();
  });
});
