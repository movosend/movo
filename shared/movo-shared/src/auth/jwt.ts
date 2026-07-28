import { randomBytes, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { getJwtConfig } from "./config";
import { AccessTokenClaims } from "./claims";
import { KycStatus, UserRole } from "../types/user";

/** TTL del access token, per ADR-004. */
const ACCESS_TOKEN_TTL = "60m";

/** Datos de entrada para emitir un access token; `iat`/`exp`/`iss` los completa `signAccessToken`. */
export interface AccessTokenPayload {
  sub: string;
  roles: UserRole[];
  kycStatus: KycStatus;
}

/** Emite un JWT de acceso firmado, con TTL de 60 minutos (ADR-004). */
export function signAccessToken(payload: AccessTokenPayload): string {
  const { secret, issuer } = getJwtConfig();
  return jwt.sign(payload, secret, {
    expiresIn: ACCESS_TOKEN_TTL,
    issuer,
  });
}

export interface RefreshTokenResult {
  /** Token opaco, criptográficamente aleatorio — NO es un JWT. */
  token: string;
  /** Identificador estable para usar como clave en Redis; seguro de loguear. */
  tokenId: string;
}

/**
 * Genera un refresh token opaco. La persistencia/revocación es
 * responsabilidad del servicio consumidor (guardar un hash de `token` bajo
 * `tokenId` en Redis, con su propio TTL) — esta librería nunca toca Redis.
 */
export function signRefreshToken(): RefreshTokenResult {
  return {
    token: randomBytes(32).toString("base64url"),
    tokenId: randomUUID(),
  };
}

/** Resultado de `verifyAccessToken` — unión discriminada por `status`, nunca una excepción. */
export type VerifyAccessTokenResult =
  | { status: "valid"; claims: AccessTokenClaims }
  | { status: "invalid"; reason: "expired" | "invalid_signature" | "malformed" };

/**
 * Verifica un JWT de acceso. No lanza excepciones para control de flujo:
 * el resultado es una unión discriminada.
 */
export function verifyAccessToken(token: string): VerifyAccessTokenResult {
  const { secret, issuer } = getJwtConfig();
  try {
    const claims = jwt.verify(token, secret, { issuer }) as AccessTokenClaims;
    return { status: "valid", claims };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return { status: "invalid", reason: "expired" };
    }
    if (err instanceof jwt.JsonWebTokenError) {
      return {
        status: "invalid",
        reason: err.message === "invalid signature" ? "invalid_signature" : "malformed",
      };
    }
    return { status: "invalid", reason: "malformed" };
  }
}
