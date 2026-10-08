import type { FastifyBaseLogger } from "fastify";
import {
  ApiError,
  MP_CONNECT_RETURN_URL,
  MpConnectAuthorizationUrlResponse,
  MpConnectReturnErrorCode,
  MpConnectStatusResponse,
} from "@movo/shared";
import { EnvConfig, requireMercadoPagoSecret } from "../../config/env";
import {
  MercadoPagoOAuthClient,
  MercadoPagoOAuthError,
  OAuthAppCredentials,
} from "../../adapters/mercadopago-oauth-client";
import {
  CarrierMpAccount,
  CarrierMpAccountRepository,
  MpAccountAlreadyLinkedError,
} from "../../repositories/carrier-mp-account-repository";
import { MpConnectStateStore } from "./mp-connect-state-store";

export const MP_AUTHORIZATION_URL = "https://auth.mercadopago.com/authorization";

/** Query que Mercado Pago manda al callback: `code`+`state`, o `error`+`state` si se rechazó. */
export interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
}

export interface MpConnectServiceDeps {
  config: EnvConfig;
  repository: CarrierMpAccountRepository;
  stateStore: MpConnectStateStore;
  oauthClient: MercadoPagoOAuthClient;
  log: FastifyBaseLogger;
  now?: () => Date;
}

export function successReturnUrl(): string {
  return `${MP_CONNECT_RETURN_URL}?result=success`;
}

export function errorReturnUrl(code: MpConnectReturnErrorCode): string {
  return `${MP_CONNECT_RETURN_URL}?result=error&code=${code}`;
}

/**
 * - Sin fila, o desvinculada a mano → `unlinked`.
 * - Revocada desde MP (MOVO-243) → `invalid/revoked`.
 * - Token vencido sin renovar → `invalid/expired`.
 */
export function toStatusResponse(account: CarrierMpAccount | null, now: Date): MpConnectStatusResponse {
  if (!account || account.unlinkedAt) {
    return { status: "unlinked", account: null, invalidReason: null };
  }
  const summary = {
    mpUserId: account.mpUserId,
    email: account.email,
    nickname: account.nickname,
    connectedAt: account.connectedAt.toISOString(),
  };
  if (account.revokedAt) {
    return { status: "invalid", account: summary, invalidReason: "revoked" };
  }
  if (!account.tokenExpiresAt || account.tokenExpiresAt.getTime() <= now.getTime()) {
    return { status: "invalid", account: summary, invalidReason: "expired" };
  }
  return { status: "linked", account: summary, invalidReason: null };
}

export function createMpConnectService(deps: MpConnectServiceDeps) {
  const { config, repository, stateStore, oauthClient, log } = deps;
  const now = deps.now ?? (() => new Date());

  /** 503 si faltan las credenciales de la app en el ambiente. */
  function appCredentials(): OAuthAppCredentials {
    try {
      return {
        clientId: requireMercadoPagoSecret(config, "MP_CLIENT_ID"),
        clientSecret: requireMercadoPagoSecret(config, "MP_CLIENT_SECRET"),
        redirectUri: requireMercadoPagoSecret(config, "MP_REDIRECT_URI"),
        testToken: config.MP_TEST_MODE,
      };
    } catch (error) {
      log.error({ reason: (error as Error).message }, "mp-connect sin configurar");
      throw new ApiError(
        503,
        "MP_CONNECT_NOT_CONFIGURED",
        "La vinculación con Mercado Pago no está configurada en este ambiente"
      );
    }
  }

  async function exchangeAndPersist(userId: string, code: string, codeVerifier: string): Promise<void> {
    const credentials = appCredentials();
    const tokens = await oauthClient.exchangeCode(credentials, { code, codeVerifier });
    // En sandbox, un token sin prefijo `TEST-` no sirve para cobrar con tarjetas de
    // prueba (SOLUCION-FINAL §3): mejor fallar acá que en el primer hold.
    if (credentials.testToken && !tokens.accessToken.startsWith("TEST-")) {
      throw new MercadoPagoOAuthError("exchange_code", 200, "MP_TEST_MODE activo y el token no es TEST-");
    }
    const info = await oauthClient.getAccountInfo(tokens.accessToken);
    const linkedAt = now();
    await repository.upsertLinked(
      userId,
      {
        mpUserId: tokens.mpUserId,
        email: info.email,
        nickname: info.nickname,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        publicKey: tokens.publicKey,
        scope: tokens.scope,
        tokenExpiresAt: new Date(linkedAt.getTime() + tokens.expiresInSeconds * 1000),
      },
      linkedAt
    );
    log.info({ userId, mpUserId: tokens.mpUserId, scope: tokens.scope }, "cuenta de MP vinculada");
  }

  return {
    async getStatus(userId: string): Promise<MpConnectStatusResponse> {
      return toStatusResponse(await repository.findByUserId(userId), now());
    },

    async buildAuthorizationUrl(userId: string): Promise<MpConnectAuthorizationUrlResponse> {
      const { clientId, redirectUri } = appCredentials();
      const { state, codeChallenge, expiresAt } = await stateStore.create(userId);
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        platform_id: "mp",
        state,
        redirect_uri: redirectUri,
        // Lo necesita MOVO-243 para renovar sin que el transportista vuelva a autorizar.
        scope: "offline_access",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      return { authorizationUrl: `${MP_AUTHORIZATION_URL}?${params.toString()}`, expiresAt: expiresAt.toISOString() };
    },

    /**
     * Siempre devuelve el deep link de vuelta a la app, nunca tira: el navegador embebido
     * solo se cierra si el 302 llega a `movo://mp-connect`. La app no confía en
     * `result=success` y vuelve a consultar el status; el `code` solo elige el texto.
     */
    async handleCallback(query: CallbackQuery): Promise<string> {
      // El state se consume siempre primero, aunque MP vuelva con `error`: así no
      // queda reutilizable.
      const pending = query.state ? await stateStore.consume(query.state) : null;
      if (query.error) {
        log.info({ mpError: query.error, knownState: pending !== null }, "vinculación de MP rechazada");
        return errorReturnUrl("MP_CONNECT_ACCESS_DENIED");
      }
      if (!pending || !query.code) {
        log.warn({ hasState: Boolean(query.state), hasCode: Boolean(query.code) }, "callback de MP con state inválido");
        return errorReturnUrl("MP_CONNECT_STATE_INVALID");
      }
      try {
        await exchangeAndPersist(pending.userId, query.code, pending.codeVerifier);
        return successReturnUrl();
      } catch (error) {
        if (error instanceof MpAccountAlreadyLinkedError) {
          log.warn({ userId: pending.userId }, "cuenta de MP ya vinculada a otro usuario");
          return errorReturnUrl("MP_ACCOUNT_ALREADY_LINKED");
        }
        if (error instanceof MercadoPagoOAuthError) {
          log.error(
            { userId: pending.userId, operation: error.operation, status: error.status, reason: error.message },
            "falló el canje de OAuth con MP"
          );
        } else {
          log.error({ userId: pending.userId, err: error }, "error inesperado al vincular la cuenta de MP");
        }
        return errorReturnUrl("MP_CONNECT_EXCHANGE_FAILED");
      }
    },

    async unlink(userId: string): Promise<void> {
      await repository.unlink(userId, now());
    },
  };
}

export type MpConnectService = ReturnType<typeof createMpConnectService>;
