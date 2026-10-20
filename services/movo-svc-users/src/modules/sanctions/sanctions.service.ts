import { FastifyBaseLogger } from "fastify";
import Redis from "ioredis";
import {
  AccountRestrictionMark,
  AccountSanction,
  AccountSanctionClosedCause,
  AccountSanctionType,
  ACCOUNT_SANCTION_NOTE_MAX_LENGTH,
  ACCOUNT_SANCTION_REASON_MAX_LENGTH,
  accountRestrictionKey,
  ApiError,
  ApplyAccountSanctionRequest,
} from "@movo/shared";
import {
  AccountSanctionClosedCause as PrismaClosedCause,
  AccountSanctionType as PrismaSanctionType,
  AccountStatus as PrismaAccountStatus,
  Prisma,
  PrismaClient,
  UserRole as PrismaUserRole,
} from "../../generated/prisma/client";
import { buildAccountSanctionNotice, AccountSanctionNotice, EmailProvider } from "../../adapters/email-provider";
import { SessionRepository } from "../../repositories/session-repository";
import { ensureNotLastEligibleAdmin } from "../admins/admin-roles.service";
import { PushSender, sendTriggerPush } from "../notifications/send-trigger-push";

/** Cuántas sanciones procesa el barrido por pasada, para no cargar todo en memoria. */
const SWEEP_BATCH_SIZE = 200;

const EXPIRED_LIFT_REASON = "Vencimiento automático de la suspensión.";
const REPLACED_LIFT_REASON = "Reemplazada por una nueva suspensión.";
const ESCALATED_LIFT_REASON = "Escalada a inhabilitación.";

export interface SanctionsServiceDeps {
  db: PrismaClient;
  redis: Redis;
  sessionRepository: Pick<
    SessionRepository,
    "revokeAllForUser" | "revokePanelSessionsForUser" | "revokeAccessTokensIssuedBefore"
  >;
  notifications: PushSender;
  emailProvider: EmailProvider;
  logger: FastifyBaseLogger;
}

type SanctionRow = Prisma.AccountSanctionGetPayload<object>;

function toAccountSanction(row: SanctionRow): AccountSanction {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as AccountSanctionType,
    reason: row.reason,
    internalNote: row.internalNote,
    startedAt: row.startedAt.toISOString(),
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    appliedBy: row.appliedBy,
    liftedAt: row.liftedAt ? row.liftedAt.toISOString() : null,
    liftedBy: row.liftedBy,
    liftReason: row.liftReason,
    closedCause: row.closedCause as AccountSanctionClosedCause | null,
  };
}

function markFor(type: AccountSanctionType): AccountRestrictionMark {
  return type === "disable" ? "disabled" : "suspended";
}

function requireText(value: string | undefined, field: string, max: number): string {
  const text = (value ?? "").trim();
  if (text.length === 0) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} es obligatorio.`);
  }
  if (text.length > max) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} no puede superar los ${max} caracteres.`);
  }
  return text;
}

/**
 * MOVO-296: sanciones de cuenta. La tabla `users.account_sanctions` es el historial y la
 * fuente de verdad; `User.status`/`bannedUntil` son la caché de la sanción vigente y la marca
 * en Redis (`account:restriction:<userId>`) es lo que lee el gateway (MOVO-298). Los efectos
 * fuera de Postgres (marca, sesiones, avisos) corren después del commit y son best-effort: la
 * marca la reconcilia el barrido, y un aviso que falla no deshace la sanción.
 */
export function createSanctionsService(deps: SanctionsServiceDeps) {
  const { db, redis, sessionRepository, notifications, emailProvider, logger } = deps;

  // ── Marca en Redis ────────────────────────────────────────────────────────────────

  async function writeMark(userId: string, type: AccountSanctionType, endsAt: Date | null, now = new Date()) {
    const key = accountRestrictionKey(userId);
    if (type === "suspension" && endsAt) {
      const ttlMs = endsAt.getTime() - now.getTime();
      if (ttlMs <= 0) {
        await redis.unlink(key);
        return;
      }
      await redis.set(key, markFor(type), "PX", ttlMs);
      return;
    }
    await redis.set(key, markFor(type));
  }

  async function clearMark(userId: string) {
    await redis.unlink(accountRestrictionKey(userId));
  }

  /** AC6: reescribe la marca de cada sanción vigente, por si Redis perdió datos. */
  async function rewriteMarks(now = new Date()): Promise<number> {
    let written = 0;
    let cursor: string | undefined;
    for (;;) {
      const rows = await db.accountSanction.findMany({
        where: { liftedAt: null },
        orderBy: { id: "asc" },
        take: SWEEP_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const row of rows) {
        await writeMark(row.userId, row.type as AccountSanctionType, row.endsAt, now);
        written += 1;
      }
      if (rows.length < SWEEP_BATCH_SIZE) {
        return written;
      }
      cursor = rows[rows.length - 1]?.id;
    }
  }

  // ── Avisos al usuario (push + email) ──────────────────────────────────────────────

  async function pushNotice(userId: string, notice: AccountSanctionNotice, event: string) {
    const onErrorContext = { event: `${event}_push_failed`, message: "no se pudo enviar el push de la sanción" };
    switch (notice.kind) {
      case "suspended":
        return sendTriggerPush({
          notifications,
          userId,
          triggerKey: "accountSuspended",
          params: { reason: notice.reason, until: notice.until ? notice.until.toISOString() : null },
          data: { type: "account_suspended" },
          logger,
          onErrorContext,
        });
      case "disabled":
        return sendTriggerPush({
          notifications,
          userId,
          triggerKey: "accountDisabled",
          params: { reason: notice.reason },
          data: { type: "account_disabled" },
          logger,
          onErrorContext,
        });
      case "lifted":
        return sendTriggerPush({
          notifications,
          userId,
          triggerKey: "accountSanctionLifted",
          params: undefined,
          data: { type: "account_sanction_lifted" },
          logger,
          onErrorContext,
        });
      case "expired":
        return sendTriggerPush({
          notifications,
          userId,
          triggerKey: "accountSuspensionExpired",
          params: undefined,
          data: { type: "account_suspension_expired" },
          logger,
          onErrorContext,
        });
    }
  }

  async function notifyUser(userId: string, notice: AccountSanctionNotice, event: string) {
    await pushNotice(userId, notice, event);
    try {
      const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (user) {
        const message = buildAccountSanctionNotice(notice);
        await emailProvider.send(user.email, message.subject, { text: message.text, html: message.html });
      }
    } catch (err) {
      logger.warn({ err, event: `${event}_email_failed`, userId }, "no se pudo enviar el mail de la sanción");
    }
  }

  // ── Aplicar ───────────────────────────────────────────────────────────────────────

  /**
   * AC2/AC3: suspender (con fin o indefinida) o inhabilitar. Suspender a un suspendido
   * reemplaza la sanción vigente; inhabilitar a un suspendido la escala; inhabilitar a un
   * inhabilitado es 409. Sancionar al último admin elegible es 409 (`ADMIN_LAST_ADMIN`).
   */
  async function applySanction(
    userId: string,
    input: ApplyAccountSanctionRequest,
    adminId: string
  ): Promise<AccountSanction> {
    const now = new Date();
    const reason = requireText(input.reason, "El motivo", ACCOUNT_SANCTION_REASON_MAX_LENGTH);
    const internalNote =
      input.internalNote !== undefined && input.internalNote.trim().length > 0
        ? requireText(input.internalNote, "La nota interna", ACCOUNT_SANCTION_NOTE_MAX_LENGTH)
        : null;

    let endsAt: Date | null = null;
    if (input.type === "disable") {
      if (input.endsAt !== undefined) {
        throw new ApiError(400, "VALIDATION_FAILED", "La inhabilitación es permanente: no lleva fecha de fin.");
      }
    } else if (input.endsAt !== undefined) {
      endsAt = new Date(input.endsAt);
      if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= now.getTime()) {
        throw new ApiError(400, "VALIDATION_FAILED", "El fin de la suspensión tiene que ser una fecha futura.");
      }
    }

    const created = await db.$transaction(async (tx) => {
      // Un admin se chequea ANTES de bloquear su fila: `ensureNotLastEligibleAdmin` bloquea a
      // todos los admins en orden de id, y bloquear antes la fila propia invertiría el orden
      // contra otra sanción concurrente sobre otro admin (deadlock).
      const isAdmin = await tx.userRoleGrant.findUnique({
        where: { userId_role: { userId, role: PrismaUserRole.admin } },
        select: { userId: true },
      });
      if (isAdmin) {
        const current = await tx.user.findUnique({ where: { id: userId }, select: { status: true, bannedUntil: true } });
        // Si ya está afuera del panel (inhabilitado o con una suspensión vigente), sancionarlo
        // de nuevo no le saca a nadie un admin elegible.
        const alreadyOut =
          current !== null &&
          (current.status === PrismaAccountStatus.banned ||
            (current.status === PrismaAccountStatus.suspended &&
              (current.bannedUntil === null || current.bannedUntil.getTime() > now.getTime())));
        if (!alreadyOut) {
          await ensureNotLastEligibleAdmin(tx, userId, "No se puede sancionar al último admin.");
        }
      }

      const locked = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM users.users WHERE id = ${userId}::uuid FOR UPDATE
      `;
      const target = locked[0];
      if (!target || target.status === PrismaAccountStatus.deleted) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }

      const open = await tx.accountSanction.findFirst({ where: { userId, liftedAt: null } });
      if (open) {
        if (open.type === PrismaSanctionType.disable) {
          throw new ApiError(409, "ACCOUNT_ALREADY_DISABLED", "La cuenta ya está inhabilitada.");
        }
        // Una suspensión vencida que el barrido todavía no cerró se cierra como vencida, no
        // como reemplazada.
        const expired = open.endsAt !== null && open.endsAt.getTime() <= now.getTime();
        const escalated = input.type === "disable";
        await tx.accountSanction.update({
          where: { id: open.id },
          data: {
            liftedAt: expired ? open.endsAt : now,
            liftedBy: expired ? null : adminId,
            liftReason: expired ? EXPIRED_LIFT_REASON : escalated ? ESCALATED_LIFT_REASON : REPLACED_LIFT_REASON,
            closedCause: expired
              ? PrismaClosedCause.expired
              : escalated
                ? PrismaClosedCause.escalated
                : PrismaClosedCause.replaced,
          },
        });
      }

      const row = await tx.accountSanction.create({
        data: {
          userId,
          type: input.type === "disable" ? PrismaSanctionType.disable : PrismaSanctionType.suspension,
          reason,
          internalNote,
          startedAt: now,
          endsAt,
          appliedBy: adminId,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          status: input.type === "disable" ? PrismaAccountStatus.banned : PrismaAccountStatus.suspended,
          bannedUntil: endsAt,
        },
      });
      return row;
    });

    logger.info(
      { action: "account_sanction_applied", targetUserId: userId, sanctionId: created.id, type: input.type, adminId },
      "Sanción de cuenta aplicada"
    );

    // Después del commit. Un fallo de Redis no revierte la sanción (la verdad está en
    // Postgres): se loguea y el barrido reescribe la marca.
    try {
      await writeMark(userId, input.type, endsAt, now);
    } catch (err) {
      logger.error({ err, userId, event: "account_sanction_mark_failed" }, "No se pudo escribir la marca de restricción");
    }
    try {
      // Sancionar a un admin corta su sesión de panel (también la suspensión: un admin
      // suspendido deja de ser elegible para el panel).
      await sessionRepository.revokePanelSessionsForUser(userId);
      if (input.type === "disable") {
        await sessionRepository.revokeAllForUser(userId);
        await sessionRepository.revokeAccessTokensIssuedBefore(userId);
      }
    } catch (err) {
      logger.error({ err, userId, event: "account_sanction_session_cut_failed" }, "No se pudieron cortar las sesiones");
    }

    await notifyUser(
      userId,
      input.type === "disable" ? { kind: "disabled", reason } : { kind: "suspended", reason, until: endsAt },
      "account_sanction_applied"
    );

    return toAccountSanction(created);
  }

  // ── Levantar ──────────────────────────────────────────────────────────────────────

  /** AC2: levanta la sanción con un motivo; la cuenta vuelve a `active` y se borra la marca. */
  async function liftSanction(
    userId: string,
    sanctionId: string,
    input: { reason: string },
    adminId: string
  ): Promise<AccountSanction> {
    const reason = requireText(input.reason, "El motivo del levantamiento", ACCOUNT_SANCTION_REASON_MAX_LENGTH);
    const now = new Date();

    const lifted = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM users.users WHERE id = ${userId}::uuid FOR UPDATE
      `;
      const target = locked[0];
      if (!target) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }
      const sanction = await tx.accountSanction.findFirst({ where: { id: sanctionId, userId } });
      if (!sanction) {
        throw new ApiError(404, "SANCTION_NOT_FOUND", "La sanción no existe.");
      }
      if (sanction.liftedAt) {
        throw new ApiError(409, "SANCTION_ALREADY_CLOSED", "La sanción ya está cerrada.");
      }
      const row = await tx.accountSanction.update({
        where: { id: sanctionId },
        data: { liftedAt: now, liftedBy: adminId, liftReason: reason, closedCause: PrismaClosedCause.lifted },
      });
      if (target.status === PrismaAccountStatus.suspended || target.status === PrismaAccountStatus.banned) {
        await tx.user.update({ where: { id: userId }, data: { status: PrismaAccountStatus.active, bannedUntil: null } });
      }
      return row;
    });

    logger.info(
      { action: "account_sanction_lifted", targetUserId: userId, sanctionId, adminId },
      "Sanción de cuenta levantada"
    );
    try {
      await clearMark(userId);
    } catch (err) {
      logger.error({ err, userId, event: "account_sanction_mark_failed" }, "No se pudo borrar la marca de restricción");
    }
    await notifyUser(userId, { kind: "lifted" }, "account_sanction_lifted");
    return toAccountSanction(lifted);
  }

  // ── Historial ─────────────────────────────────────────────────────────────────────

  async function listSanctions(userId: string): Promise<AccountSanction[]> {
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
    }
    const rows = await db.accountSanction.findMany({ where: { userId }, orderBy: { startedAt: "desc" } });
    return rows.map(toAccountSanction);
  }

  // ── Vencimiento automático ────────────────────────────────────────────────────────

  /**
   * AC7: pasa a `active` las suspensiones vencidas, cierra la sanción en el historial (con el
   * fin como fecha de cierre) y avisa al usuario. Idempotente entre réplicas: el cierre es un
   * `updateMany` condicionado a que siga abierta, y solo avisa quien lo ganó.
   */
  async function expireDueSuspensions(now = new Date()): Promise<number> {
    let expired = 0;
    for (;;) {
      const due = await db.accountSanction.findMany({
        where: { type: PrismaSanctionType.suspension, liftedAt: null, endsAt: { lte: now } },
        orderBy: { endsAt: "asc" },
        take: SWEEP_BATCH_SIZE,
      });
      let closedInPass = 0;
      for (const sanction of due) {
        const won = await db.$transaction(async (tx) => {
          const closed = await tx.accountSanction.updateMany({
            where: { id: sanction.id, liftedAt: null },
            data: {
              liftedAt: sanction.endsAt,
              liftReason: EXPIRED_LIFT_REASON,
              closedCause: PrismaClosedCause.expired,
            },
          });
          if (closed.count === 0) {
            return false;
          }
          await tx.user.updateMany({
            where: { id: sanction.userId, status: PrismaAccountStatus.suspended },
            data: { status: PrismaAccountStatus.active, bannedUntil: null },
          });
          return true;
        });
        if (!won) {
          continue;
        }
        closedInPass += 1;
        expired += 1;
        try {
          await clearMark(sanction.userId);
        } catch (err) {
          logger.error(
            { err, userId: sanction.userId, event: "account_sanction_mark_failed" },
            "No se pudo borrar la marca de restricción"
          );
        }
        await notifyUser(sanction.userId, { kind: "expired" }, "account_suspension_expired");
      }
      if (due.length < SWEEP_BATCH_SIZE || closedInPass === 0) {
        return expired;
      }
    }
  }

  return { applySanction, liftSanction, listSanctions, expireDueSuspensions, rewriteMarks };
}

export type SanctionsService = ReturnType<typeof createSanctionsService>;
