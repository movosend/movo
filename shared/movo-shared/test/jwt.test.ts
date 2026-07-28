import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { __resetJwtConfigForTests } from "../src/auth/config";
import { signAccessToken, signRefreshToken, verifyAccessToken } from "../src/auth/jwt";
import { KycStatus, UserRole } from "../src/types/user";

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
const ORIGINAL_JWT_ISSUER = process.env.JWT_ISSUER;

describe("auth/jwt", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    delete process.env.JWT_ISSUER;
    __resetJwtConfigForTests();
  });

  afterEach(() => {
    if (ORIGINAL_JWT_SECRET === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;

    if (ORIGINAL_JWT_ISSUER === undefined) delete process.env.JWT_ISSUER;
    else process.env.JWT_ISSUER = ORIGINAL_JWT_ISSUER;

    __resetJwtConfigForTests();
  });

  describe("signAccessToken + verifyAccessToken", () => {
    it("firma y verifica un token válido", () => {
      const token = signAccessToken({
        sub: "user-1",
        roles: [UserRole.SENDER, UserRole.CARRIER],
        kycStatus: KycStatus.APPROVED,
      });

      const result = verifyAccessToken(token);

      expect(result.status).toBe("valid");
      if (result.status !== "valid") throw new Error("expected valid result");
      expect(result.claims.sub).toBe("user-1");
      expect(result.claims.roles).toEqual([UserRole.SENDER, UserRole.CARRIER]);
      expect(result.claims.kycStatus).toBe(KycStatus.APPROVED);
      expect(result.claims.iss).toBe("movo");
      expect(typeof result.claims.iat).toBe("number");
      expect(typeof result.claims.exp).toBe("number");
      expect(result.claims.exp).toBeGreaterThan(result.claims.iat);
    });

    it("detecta un token expirado", () => {
      const expired = jwt.sign(
        { sub: "user-1", roles: [UserRole.SENDER], kycStatus: KycStatus.APPROVED },
        "test-secret",
        { expiresIn: "-1s", issuer: "movo" },
      );

      const result = verifyAccessToken(expired);

      expect(result).toEqual({ status: "invalid", reason: "expired" });
    });

    it("detecta una firma inválida", () => {
      const signedWithOtherSecret = jwt.sign(
        { sub: "user-1", roles: [UserRole.SENDER], kycStatus: KycStatus.APPROVED },
        "another-secret",
        { expiresIn: "60m", issuer: "movo" },
      );

      const result = verifyAccessToken(signedWithOtherSecret);

      expect(result).toEqual({ status: "invalid", reason: "invalid_signature" });
    });

    it("detecta un token malformado", () => {
      const result = verifyAccessToken("esto-no-es-un-jwt");

      expect(result).toEqual({ status: "invalid", reason: "malformed" });
    });

    it("nunca lanza excepciones, incluso ante un error inesperado de jsonwebtoken", () => {
      const verifySpy = vi.spyOn(jwt, "verify").mockImplementationOnce(() => {
        throw new Error("algo inesperado");
      });

      const result = verifyAccessToken("cualquier-token");

      expect(result).toEqual({ status: "invalid", reason: "malformed" });
      verifySpy.mockRestore();
    });
  });

  describe("signRefreshToken", () => {
    it("genera un token opaco y un tokenId distintos entre sí", () => {
      const { token, tokenId } = signRefreshToken();

      expect(token).not.toBe(tokenId);
      expect(token.length).toBeGreaterThan(0);
      expect(tokenId.length).toBeGreaterThan(0);
      expect(token).not.toMatch(/[+/=]/);
    });

    it("genera valores distintos en cada llamada", () => {
      const first = signRefreshToken();
      const second = signRefreshToken();

      expect(first.token).not.toBe(second.token);
      expect(first.tokenId).not.toBe(second.tokenId);
    });
  });

  describe("inicialización de JWT_SECRET (AC8)", () => {
    it("falla al firmar si JWT_SECRET no está seteado", () => {
      delete process.env.JWT_SECRET;
      __resetJwtConfigForTests();

      expect(() =>
        signAccessToken({ sub: "user-1", roles: [UserRole.SENDER], kycStatus: KycStatus.APPROVED }),
      ).toThrow(/JWT_SECRET/);
    });

    it("funciona una vez que JWT_SECRET está seteado", () => {
      delete process.env.JWT_SECRET;
      __resetJwtConfigForTests();

      process.env.JWT_SECRET = "now-set";
      __resetJwtConfigForTests();

      expect(() =>
        signAccessToken({ sub: "user-1", roles: [UserRole.SENDER], kycStatus: KycStatus.APPROVED }),
      ).not.toThrow();
    });
  });
});
