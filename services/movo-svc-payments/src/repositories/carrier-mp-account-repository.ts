import { PrismaClient } from "../generated/prisma/client";
import type { CarrierMpAccount } from "../generated/prisma/client";
import { TokenCipher } from "../utils/token-cipher";

export type { CarrierMpAccount };

export interface LinkedAccountData {
  mpUserId: string;
  email: string | null;
  nickname: string | null;
  accessToken: string;
  refreshToken: string;
  publicKey: string;
  scope: string | null;
  tokenExpiresAt: Date;
}

/** Esa cuenta de MP ya está vinculada (activa) a otro usuario de Movo. */
export class MpAccountAlreadyLinkedError extends Error {
  constructor() {
    super("La cuenta de Mercado Pago ya está vinculada a otro usuario");
    this.name = "MpAccountAlreadyLinkedError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Tokens ya descifrados, para quien tenga que operar con MP (MOVO-209/212/243). */
export interface CarrierMpCredentials {
  mpUserId: string;
  accessToken: string;
  refreshToken: string;
  publicKey: string | null;
  /** Vencimiento del access_token (`null` si MP no lo informó). Lo mira quien captura (MOVO-212). */
  tokenExpiresAt: Date | null;
  /** Última vez que cambió la vinculación (re-vinculación, refresh de tokens, MOVO-243). */
  updatedAt: Date;
}

/** MOVO-243: una vinculación a renovar, con el refresh_token ya descifrado. */
export interface RefreshCandidate {
  userId: string;
  mpUserId: string;
  refreshToken: string;
  /**
   * Opaco: identifica los tokens que se leyeron. `saveRefreshedTokens`/`markRevoked` solo
   * escriben si la fila sigue con esos mismos tokens, así un re-vincular o desvincular que
   * ocurra mientras se espera a MP no se pisa.
   */
  version: string;
}

export interface RefreshedTokensData {
  accessToken: string;
  refreshToken: string;
  scope: string | null;
  tokenExpiresAt: Date;
}

export interface CarrierMpAccountRepository {
  /** La fila tal cual: `accessToken`/`refreshToken` vienen cifrados. */
  findByUserId(userId: string): Promise<CarrierMpAccount | null>;
  /**
   * Tokens descifrados de una vinculación vigente (no desvinculada ni revocada), o
   * `null`. No mira el vencimiento: eso lo decide quien llama.
   */
  findCredentials(userId: string): Promise<CarrierMpCredentials | null>;
  /**
   * MOVO-268: lo mismo que `findCredentials`, buscando por el user id de MP (el `user_id`
   * de una notificación del webhook) en vez de por el usuario de Movo.
   */
  findCredentialsByMpUserId(mpUserId: string): Promise<(CarrierMpCredentials & { userId: string }) | null>;
  /**
   * Credenciales descifradas SOLO si la vinculación está vigente: ni desvinculada ni
   * revocada ni con el token vencido a `now`, y con `public_key`. Una sola lectura.
   * Es lo que usa MOVO-209 para decidir si se puede cobrar a nombre del transportista.
   */
  findActiveCredentials(userId: string, now: Date): Promise<(CarrierMpCredentials & { publicKey: string }) | null>;
  /**
   * MOVO-116: mismo criterio exacto que `findActiveCredentials` pero sin descifrar
   * tokens: ¿podría hoy cobrarse a nombre de este transportista? Lo usa el bloqueo de
   * `svc-shipments` para no dejar operar a quien después caería en el 409 del hold.
   */
  hasActiveCredentials(userId: string, now: Date): Promise<boolean>;
  /**
   * MOVO-243 AC1: vinculaciones vigentes (ni desvinculadas ni revocadas) cuyo token vence
   * antes de `expiresBefore`, incluidas las ya vencidas (se intenta recuperarlas), las
   * que se intentaron hace más tiempo primero. Descifra solo el `refresh_token`; una fila
   * que no se puede descifrar (otra key, corrupta) se omite y se avisa por `onUnreadable`
   * en vez de frenar a las demás.
   */
  findDueForRefresh(
    expiresBefore: Date,
    limit: number,
    onUnreadable?: (userId: string) => void
  ): Promise<RefreshCandidate[]>;
  /**
   * MOVO-243: anota que se intentó renovar esta vinculación (toca `updated_at`, mismo CAS
   * que `saveRefreshedTokens`). `findDueForRefresh` ordena por el intento más viejo, así
   * una fila que falla siempre rota al final del lote y no acapara los 100 lugares.
   */
  touchRefreshAttempt(userId: string, version: string, now: Date): Promise<void>;
  /**
   * MOVO-243 AC2: reemplaza `access_token`, `refresh_token` y `token_expires_at` si la
   * fila sigue vigente con los tokens de `version`. `false` = alguien la cambió en el
   * medio (re-vinculó, desvinculó) y no se escribió nada.
   */
  saveRefreshedTokens(userId: string, version: string, data: RefreshedTokensData): Promise<boolean>;
  /**
   * MOVO-243 AC3: marca `revoked_at` con la misma condición que `saveRefreshedTokens`.
   * Conserva los tokens (ya no sirven; `findCredentials` filtra por `revoked_at`).
   */
  markRevoked(userId: string, version: string, now: Date): Promise<boolean>;
  /**
   * Vincula (o re-vincula) la cuenta del usuario: pisa tokens y datos, y limpia
   * `revokedAt`/`unlinkedAt`. Tira `MpAccountAlreadyLinkedError` si esa cuenta de MP
   * está activa en otro usuario.
   */
  upsertLinked(userId: string, data: LinkedAccountData, now: Date): Promise<CarrierMpAccount>;
  /** Idempotente: sin fila, o ya desvinculada, no hace nada. */
  unlink(userId: string, now: Date): Promise<void>;
}

/**
 * Vinculación vigente: ni desvinculada ni revocada ni con el token vencido a `now`.
 * Compartido por `findActiveCredentials` (hold) y `hasActiveCredentials` (bloqueo de
 * MOVO-116), así el criterio de "puede cobrar" no se desalinea entre los dos.
 */
function activeAccountWhere(now: Date) {
  return { unlinkedAt: null, revokedAt: null, tokenExpiresAt: { gt: now } };
}

/**
 * `accessToken` y `refreshToken` se guardan cifrados con AES-256-GCM (`token-cipher.ts`,
 * review de PR #223). La `public_key` no: es pública por diseño, la usa el mobile.
 */
export function createCarrierMpAccountRepository(db: PrismaClient, cipher: TokenCipher): CarrierMpAccountRepository {
  const upsert = (userId: string, data: LinkedAccountData, now: Date) => {
    const fields = {
      ...data,
      accessToken: cipher.encrypt(data.accessToken),
      refreshToken: cipher.encrypt(data.refreshToken),
      connectedAt: now,
      revokedAt: null,
      unlinkedAt: null,
    };
    return db.carrierMpAccount.upsert({
      where: { userId },
      create: { userId, ...fields },
      update: fields,
    });
  };

  return {
    findByUserId(userId) {
      return db.carrierMpAccount.findUnique({ where: { userId } });
    },

    async findCredentials(userId) {
      const row = await db.carrierMpAccount.findFirst({ where: { userId, unlinkedAt: null, revokedAt: null } });
      if (!row?.accessToken || !row.refreshToken) return null;
      return {
        mpUserId: row.mpUserId,
        accessToken: cipher.decrypt(row.accessToken),
        refreshToken: cipher.decrypt(row.refreshToken),
        publicKey: row.publicKey,
        tokenExpiresAt: row.tokenExpiresAt,
        updatedAt: row.updatedAt,
      };
    },

    async findCredentialsByMpUserId(mpUserId) {
      const row = await db.carrierMpAccount.findFirst({ where: { mpUserId, unlinkedAt: null, revokedAt: null } });
      if (!row?.accessToken || !row.refreshToken) return null;
      return {
        userId: row.userId,
        mpUserId: row.mpUserId,
        accessToken: cipher.decrypt(row.accessToken),
        refreshToken: cipher.decrypt(row.refreshToken),
        publicKey: row.publicKey,
        tokenExpiresAt: row.tokenExpiresAt,
        updatedAt: row.updatedAt,
      };
    },

    async hasActiveCredentials(userId, now) {
      const row = await db.carrierMpAccount.findFirst({
        where: { userId, ...activeAccountWhere(now) },
        select: { accessToken: true, refreshToken: true, publicKey: true },
      });
      return Boolean(row?.accessToken && row.refreshToken && row.publicKey);
    },

    async findActiveCredentials(userId, now) {
      const row = await db.carrierMpAccount.findFirst({
        where: { userId, ...activeAccountWhere(now) },
      });
      if (!row?.accessToken || !row.refreshToken || !row.publicKey) return null;
      return {
        mpUserId: row.mpUserId,
        accessToken: cipher.decrypt(row.accessToken),
        refreshToken: cipher.decrypt(row.refreshToken),
        publicKey: row.publicKey,
        tokenExpiresAt: row.tokenExpiresAt,
        updatedAt: row.updatedAt,
      };
    },

    async findDueForRefresh(expiresBefore, limit, onUnreadable) {
      const rows = await db.carrierMpAccount.findMany({
        where: {
          unlinkedAt: null,
          revokedAt: null,
          accessToken: { not: null },
          refreshToken: { not: null },
          tokenExpiresAt: { lt: expiresBefore },
        },
        // `updated_at` solo cambia al guardar o al anotar un intento (`touchRefreshAttempt`):
        // la que se intentó hace más tiempo va primera y las que fallan rotan.
        orderBy: [{ updatedAt: "asc" }, { tokenExpiresAt: "asc" }],
        take: limit,
      });
      const candidates: RefreshCandidate[] = [];
      for (const row of rows) {
        if (!row.refreshToken) continue;
        try {
          candidates.push({
            userId: row.userId,
            mpUserId: row.mpUserId,
            refreshToken: cipher.decrypt(row.refreshToken),
            version: row.refreshToken,
          });
        } catch {
          onUnreadable?.(row.userId);
          // Se anota el intento para que rote y no quede siempre primera en el lote.
          await db.carrierMpAccount.updateMany({
            where: { userId: row.userId, refreshToken: row.refreshToken },
            data: { updatedAt: new Date() },
          });
        }
      }
      return candidates;
    },

    async touchRefreshAttempt(userId, version, now) {
      await db.carrierMpAccount.updateMany({
        where: { userId, unlinkedAt: null, revokedAt: null, refreshToken: version },
        data: { updatedAt: now },
      });
    },

    async saveRefreshedTokens(userId, version, data) {
      const result = await db.carrierMpAccount.updateMany({
        where: { userId, unlinkedAt: null, revokedAt: null, refreshToken: version },
        data: {
          accessToken: cipher.encrypt(data.accessToken),
          refreshToken: cipher.encrypt(data.refreshToken),
          tokenExpiresAt: data.tokenExpiresAt,
          // Si MP no devuelve `scope` en el refresh, se conserva el de la vinculación.
          ...(data.scope !== null ? { scope: data.scope } : {}),
        },
      });
      return result.count > 0;
    },

    async markRevoked(userId, version, now) {
      const result = await db.carrierMpAccount.updateMany({
        where: { userId, unlinkedAt: null, revokedAt: null, refreshToken: version },
        data: { revokedAt: now },
      });
      return result.count > 0;
    },

    async upsertLinked(userId, data, now) {
      try {
        return await upsert(userId, data, now);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // El P2002 puede venir del índice parcial de `mp_user_id` o de una carrera
        // contra otro callback del mismo usuario sobre `user_id` (el upsert de Prisma
        // no es un ON CONFLICT atómico). Se distingue mirando la base, no el nombre del
        // constraint en el error, cuya forma cambia con el driver adapter.
        const holder = await db.carrierMpAccount.findFirst({
          where: { mpUserId: data.mpUserId, revokedAt: null, unlinkedAt: null, NOT: { userId } },
          select: { id: true },
        });
        if (holder) throw new MpAccountAlreadyLinkedError();
        return upsert(userId, data, now);
      }
    },

    async unlink(userId, now) {
      await db.carrierMpAccount.updateMany({
        where: { userId, unlinkedAt: null },
        data: { unlinkedAt: now, accessToken: null, refreshToken: null },
      });
    },
  };
}
