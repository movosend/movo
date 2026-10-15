import { randomBytes, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { getJwtConfig } from "./config";
import { AccessTokenClaims } from "./claims";
import { KycStatus, UserRole } from "../types/user";

/**
 * TTL del access token de la app, per ADR-004. Exportado (review de PR #244) para que
 * `svc-users` use el mismo número en el `expiresIn` de la respuesta y en el TTL de la
 * marca de revocación `user-revoked-at`.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * MOVO-287: sesión del panel de administración. Access token corto (15 min) y una
 * sesión de 8 h fijas desde el login, que rotar el refresh no extiende. Exportados para
 * que `svc-users` (emite) y el gateway (TTL de la marca de revocación) usen el mismo número.
 */
export const PANEL_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const PANEL_SESSION_TTL_SECONDS = 8 * 60 * 60;

/** Datos de entrada para emitir un access token; `iat`/`exp`/`iss` los completa `signAccessToken`. */
export interface AccessTokenPayload {
  sub: string;
  roles: UserRole[];
  kycStatus: KycStatus;
  /** MOVO-287: solo lo llevan los tokens de una sesión de panel. Ver `AccessTokenClaims.session`. */
  session?: "panel";
}

export interface SignAccessTokenOptions {
  /** Default: 60 minutos (ADR-004). La sesión de panel pasa `PANEL_ACCESS_TOKEN_TTL_SECONDS`. */
  expiresInSeconds?: number;
}

/** Emite un JWT de acceso firmado, con TTL de 60 minutos (ADR-004) salvo que se indique otro. */
export function signAccessToken(payload: AccessTokenPayload, options: SignAccessTokenOptions = {}): string {
  const { secret, issuer } = getJwtConfig();
  return jwt.sign(payload, secret, {
    expiresIn: options.expiresInSeconds ?? ACCESS_TOKEN_TTL_SECONDS,
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
  try {
    const { secret, issuer } = getJwtConfig();
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
