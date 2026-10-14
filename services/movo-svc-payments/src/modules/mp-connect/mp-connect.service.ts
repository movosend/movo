import type { FastifyBaseLogger } from "fastify";
import {
  ApiError,
  CarrierMpAccountStatusResponse,
  MP_CONNECT_RETURN_URL,
  MpConnectAuthorizationUrlResponse,
  MpConnectReturnErrorCode,
  MpConnectStatusResponse,
} from "@movo/shared";
import { EnvConfig, requireMercadoPagoSecret } from "../../config/env";
import {
  MercadoPagoAccountInfo,
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
import { RefreshStrikeStore } from "./mp-refresh-strike-store";
import { PendingTokensStore } from "./mp-pending-tokens-store";
import { parseEncryptionKey } from "../../utils/token-cipher";

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
  strikeStore: RefreshStrikeStore;
  pendingTokensStore: PendingTokensStore;
  /** Espera entre reintentos del guardado; inyectable para no dormir de verdad en tests. */
  sleep?: (ms: number) => Promise<void>;
  oauthClient: MercadoPagoOAuthClient;
  log: FastifyBaseLogger;
  now?: () => Date;
}

/** Tope de vinculaciones por corrida: el resto entra en la siguiente (se ordenan por vencimiento). */
export const TOKEN_REFRESH_BATCH_SIZE = 100;
/**
 * Esperas entre los intentos de guardar los tokens ya rotados por MP (3 intentos en total):
 * cubren un corte de la base de unos segundos. Pasado eso se deja un respaldo en Redis.
 */
const SAVE_RETRY_DELAYS_MS = [500, 2000];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Resultado de una corrida de renovación (MOVO-243), para el log y los tests. */
export interface TokenRefreshSummary {
  checked: number;
  refreshed: number;
  revoked: number;
  /** Fallos transitorios (red, MP caído): se reintentan en la próxima corrida. */
  failed: number;
  /** La fila cambió mientras se esperaba a MP (re-vinculó/desvinculó): no se escribió. */
  skipped: number;
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
  const { config, repository, stateStore, strikeStore, pendingTokensStore, oauthClient, log } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => new Date());

  /** 503 si faltan las credenciales de la app, o la key para cifrar los tokens. */
  function appCredentials(): OAuthAppCredentials {
    try {
      parseEncryptionKey(requireMercadoPagoSecret(config, "MP_TOKEN_ENCRYPTION_KEY"));
      return {
        clientId: requireMercadoPagoSecret(config, "MP_CLIENT_ID"),
        clientSecret: requireMercadoPagoSecret(config, "MP_CLIENT_SECRET"),
        redirectUri: requireMercadoPagoSecret(config, "MP_REDIRECT_URI"),
        testToken: config.MP_TEST_MODE,
      };
    } catch (error) {
      // El mensaje nombra la variable que falta, nunca su valor.
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
    // Best-effort (review de PR #223): email y nickname son solo para mostrar, y a esta
    // altura el code ya se gastó. Si `/users/me` falla, se vincula igual con `null` en vez
    // de obligar al transportista a repetir todo el flujo en MP.
    let info: MercadoPagoAccountInfo = { email: null, nickname: null };
    try {
      info = await oauthClient.getAccountInfo(tokens.accessToken);
    } catch (error) {
      log.warn(
        { userId, mpUserId: tokens.mpUserId, reason: error instanceof Error ? error.message : "unknown" },
        "no se pudo leer /users/me de MP, se vincula sin email ni nickname"
      );
    }
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

    /**
     * MOVO-116: ¿el transportista tiene una cuenta con la que hoy se puede cobrar? Mismo
     * criterio que el hold (`findActiveCredentials`), más estricto que `linked` de
     * `getStatus` porque también exige `public_key`.
     */
    async getCarrierAccountStatus(userId: string): Promise<CarrierMpAccountStatusResponse> {
      return { linked: await repository.hasActiveCredentials(userId, now()) };
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
     * Todo va dentro del `try`, incluido el `GETDEL` del state (review de PR #223): un
     * Redis caído también tiene que terminar en el deep link y no en un 500 JSON.
     */
    async handleCallback(query: CallbackQuery): Promise<string> {
      let userId: string | null = null;
      try {
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
        userId = pending.userId;
        await exchangeAndPersist(pending.userId, query.code, pending.codeVerifier);
        return successReturnUrl();
      } catch (error) {
        if (error instanceof MpAccountAlreadyLinkedError) {
          log.warn({ userId }, "cuenta de MP ya vinculada a otro usuario");
          return errorReturnUrl("MP_ACCOUNT_ALREADY_LINKED");
        }
        if (error instanceof MercadoPagoOAuthError) {
          log.error(
            { userId, operation: error.operation, status: error.status, reason: error.message },
            "falló el canje de OAuth con MP"
          );
        } else {
          log.error({ userId, err: error }, "error inesperado al vincular la cuenta de MP");
        }
        return errorReturnUrl("MP_CONNECT_EXCHANGE_FAILED");
      }
    },

    async unlink(userId: string): Promise<void> {
      await repository.unlink(userId, now());
    },

    /**
     * MOVO-243: renueva los tokens que vencen dentro de `MP_TOKEN_REFRESH_WINDOW_DAYS`.
     * Lo dispara el barrido periódico (`plugins/mp-token-refresh-sweep.ts`), nunca el
     * cobro (AC1). Una vinculación a la vez: son pocas por corrida y así un MP lento no
     * se multiplica en conexiones paralelas.
     *
     * - 200 → se guardan `access_token` y `refresh_token` nuevos y el vencimiento (AC2).
     * - 400 `invalid_grant` en dos corridas seguidas sobre el mismo token → `revoked_at`; ya
     *   no entra en las próximas corridas (AC3). La primera vez solo se registra.
     * - cualquier otro fallo → no se toca la fila y se reintenta en la próxima (AC4).
     * Nunca se loguea un token.
     */
    async refreshDueTokens(): Promise<TokenRefreshSummary> {
      const summary: TokenRefreshSummary = { checked: 0, refreshed: 0, revoked: 0, failed: 0, skipped: 0 };
      let credentials: Pick<OAuthAppCredentials, "clientId" | "clientSecret" | "testToken">;
      try {
        parseEncryptionKey(requireMercadoPagoSecret(config, "MP_TOKEN_ENCRYPTION_KEY"));
        credentials = {
          clientId: requireMercadoPagoSecret(config, "MP_CLIENT_ID"),
          clientSecret: requireMercadoPagoSecret(config, "MP_CLIENT_SECRET"),
          testToken: config.MP_TEST_MODE,
        };
      } catch (error) {
        // error y no warn: en prod esas credenciales siguen sin cargar y, sin una alerta
        // visible, los tokens de 180 días vencerían sin que nadie se entere.
        log.error({ reason: (error as Error).message }, "renovación de tokens de MP OMITIDA: sin configurar");
        return summary;
      }

      const dueBefore = new Date(now().getTime() + config.MP_TOKEN_REFRESH_WINDOW_DAYS * DAY_MS);
      const candidates = await repository.findDueForRefresh(dueBefore, TOKEN_REFRESH_BATCH_SIZE, (userId) =>
        log.error({ userId }, "no se pudo descifrar el refresh_token de una vinculación de MP, se omite")
      );
      summary.checked = candidates.length;

      for (const { userId, mpUserId, refreshToken, version } of candidates) {
        try {
          // Si una corrida anterior dejó los tokens ya rotados sin poder guardarlos, se
          // persisten ESOS: el `refresh_token` de la base ya no sirve y pedir otro refresh
          // terminaría en `invalid_grant`.
          const pending = await pendingTokensStore.find(userId).catch(() => null);
          if (pending && pending.version === version) {
            const restored = await repository.saveRefreshedTokens(userId, version, pending.tokens);
            await pendingTokensStore.clear(userId).catch(() => undefined);
            await strikeStore.clear(userId).catch(() => undefined);
            if (restored) {
              summary.refreshed += 1;
              log.info({ userId, mpUserId }, "tokens de MP renovados (recuperados del respaldo)");
            } else {
              summary.skipped += 1;
            }
            continue;
          }
          if (pending) await pendingTokensStore.clear(userId).catch(() => undefined);

          const refreshed = await oauthClient.refreshTokens(credentials, refreshToken);
          // MP ya rotó el refresh_token: si el guardado falla se reintenta con una pausa
          // corta y, si sigue fallando, se deja un respaldo en Redis. Si no, en la corrida
          // siguiente el token viejo daría `invalid_grant` y se revocaría una cuenta sana.
          const tokensToSave = {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            scope: refreshed.scope,
            tokenExpiresAt: new Date(now().getTime() + refreshed.expiresInSeconds * 1000),
          };
          let saved = false;
          for (let attempt = 0; ; attempt += 1) {
            try {
              saved = await repository.saveRefreshedTokens(userId, version, tokensToSave);
              break;
            } catch (saveError) {
              if (attempt >= SAVE_RETRY_DELAYS_MS.length) {
                const backedUp = await pendingTokensStore
                  .save(userId, { version, tokens: tokensToSave })
                  .then(() => true)
                  .catch(() => false);
                log.error(
                  { userId, mpUserId, backedUp },
                  "no se pudieron guardar los tokens de MP ya rotados en la base"
                );
                throw saveError;
              }
              await sleep(SAVE_RETRY_DELAYS_MS[attempt]);
            }
          }
          if (saved) {
            await strikeStore.clear(userId).catch(() => undefined);
            summary.refreshed += 1;
            log.info({ userId, mpUserId }, "tokens de MP renovados");
          } else {
            summary.skipped += 1;
            log.warn({ userId, mpUserId }, "la vinculación de MP cambió durante la renovación, se descarta");
          }
        } catch (error) {
          // Se anota el intento para que, si sigue fallando, no acapare el lote.
          await repository.touchRefreshAttempt(userId, version, now()).catch(() => undefined);
          if (error instanceof MercadoPagoOAuthError && error.isRevocation()) {
            try {
              // `invalid_grant` no siempre es una revocación (otra corrida pudo canjear el
              // token): se exige verlo dos corridas seguidas sobre el mismo token.
              if ((await strikeStore.strike(userId, version)) < 2) {
                summary.failed += 1;
                log.warn(
                  { userId, mpUserId },
                  "MP rechazó el refresh_token (invalid_grant), se confirma en la próxima corrida antes de revocar"
                );
                continue;
              }
              if (await repository.markRevoked(userId, version, now())) {
                summary.revoked += 1;
                log.warn({ userId, mpUserId }, "el transportista revocó el acceso a MP: vinculación marcada");
              } else {
                summary.skipped += 1;
              }
            } catch (markError) {
              summary.failed += 1;
              log.error({ userId, mpUserId, err: markError }, "no se pudo marcar la vinculación de MP como revocada");
            }
            continue;
          }
          summary.failed += 1;
          log.warn(
            {
              userId,
              mpUserId,
              status: error instanceof MercadoPagoOAuthError ? error.status : null,
              reason: error instanceof Error ? error.message : "unknown",
            },
            "no se pudieron renovar los tokens de MP, se reintenta en la próxima corrida"
          );
        }
      }

      if (summary.checked > 0) log.info(summary, "corrida de renovación de tokens de MP");
      return summary;
    },
  };
}

export type MpConnectService = ReturnType<typeof createMpConnectService>;
