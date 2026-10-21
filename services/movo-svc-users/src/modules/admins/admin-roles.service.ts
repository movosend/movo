import { AccountStatus, AdminCandidate, AdminSummary, ApiError, UserRole } from "@movo/shared";
import {
  AccountStatus as PrismaAccountStatus,
  Prisma,
  PrismaClient,
  UserRole as PrismaUserRole,
} from "../../generated/prisma/client";
import { buildAdminGrantedNotice, EmailProvider } from "../../adapters/email-provider";
import { createUserRepository } from "../../repositories/user-repository";
import { SessionRepository } from "../../repositories/session-repository";
import { fullName, parseAccountStatus } from "../../models/user";

/**
 * Quién pidió la operación (AC6). Desde el panel es el id del admin que `svc-admin` reenvía
 * en `x-user-id`; desde el script, `"cli"`. Solo se registra en el log: la regla de "no
 * revocarse a uno mismo" la aplica `svc-admin`, no este servicio.
 */
export type AdminRoleRequester = string;

/** Lo que usa este servicio del logger. Lo cumplen el de Fastify y el del script. */
export interface AdminRolesLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface AdminRolesServiceDeps {
  db: PrismaClient;
  sessionRepository?: Pick<SessionRepository, "revokePanelSessionsForUser"> | undefined;
  emailProvider: EmailProvider;
  logger: AdminRolesLogger;
}

export interface GrantAdminResult {
  admin: AdminSummary;
  /** `true` si el usuario ya tenía el rol: no se tocó nada ni se mandó el aviso (AC1). */
  alreadyAdmin: boolean;
}

type AdminGrantRow = Prisma.UserRoleGrantGetPayload<{ include: { user: true } }>;

function toAdminSummary(row: AdminGrantRow): AdminSummary {
  return {
    id: row.userId,
    fullName: fullName(row.user),
    email: row.user.email,
    status: parseAccountStatus(row.user.status),
    photoUrl: row.user.photoUrl,
    grantedAt: row.grantedAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Invariante compartido de "nunca cero admins elegibles" (MOVO-290, review PR #247):
 * verifica con bloqueo FOR UPDATE que una operación que desactiva o remueve a un admin
 * (revocación de rol, baja de cuenta en `deleteAccount`, o baneo en MOVO-296) no deje
 * al sistema sin al menos un admin que pueda ingresar al panel (email verificado + `active`).
 *
 * `ORDER BY ur.user_id` previene deadlocks entre transacciones concurrentes.
 */
export async function ensureNotLastEligibleAdmin(
  tx: Prisma.TransactionClient,
  userId: string,
  errorMessage: string = "No se puede revocar el rol al último admin."
): Promise<{ isAdmin: boolean }> {
  const admins = await tx.$queryRaw<{ user_id: string; eligible: boolean }[]>`
    SELECT ur.user_id,
           (u.email_verified AND u.status = 'active') AS eligible
    FROM users.user_roles ur
    JOIN users.users u ON u.id = ur.user_id
    WHERE ur.role = 'admin'
    ORDER BY ur.user_id
    FOR UPDATE OF ur, u
  `;

  const target = admins.find((admin) => admin.user_id === userId);
  if (!target) {
    return { isAdmin: false };
  }

  const remaining = admins.filter((admin) => admin.user_id !== userId && admin.eligible);
  if (remaining.length === 0) {
    throw new ApiError(409, "ADMIN_LAST_ADMIN", errorMessage);
  }

  return { isAdmin: true };
}

/**
 * MOVO-290: alta y baja del rol `admin`. Lo usan los endpoints internos (que llama `svc-admin`
 * desde el panel) y el script de CLI que crea el primer admin, así las reglas viven en un
 * solo lugar.
 */
export function createAdminRolesService(deps: AdminRolesServiceDeps) {
  const { db, sessionRepository, emailProvider, logger } = deps;
  const userRepository = createUserRepository(db);

  async function findGrant(userId: string): Promise<AdminGrantRow | null> {
    return db.userRoleGrant.findUnique({
      where: { userId_role: { userId, role: PrismaUserRole.admin } },
      include: { user: true },
    });
  }

  async function listAdmins(): Promise<AdminSummary[]> {
    const rows = await db.userRoleGrant.findMany({
      where: {
        role: PrismaUserRole.admin,
        user: { status: { not: PrismaAccountStatus.deleted } },
      },
      include: { user: true },
      orderBy: { grantedAt: "asc" },
    });
    return rows.map(toAdminSummary);
  }

  /**
   * Autocompletado del alta de admins: nombre o email, sin cuentas dadas de baja. A diferencia de
   * `GET /users/search` (público, solo por nombre) acá se ve el email porque el panel otorga el rol
   * por email; solo lo alcanza `svc-admin`, que exige rol admin.
   */
  async function searchCandidates(query: string, limit = 8): Promise<AdminCandidate[]> {
    const term = query.trim();
    if (term.length < 2) return [];
    const words = term.split(/\s+/).filter(Boolean);
    const or: Prisma.UserWhereInput[] = [
      { email: { contains: term, mode: "insensitive" } },
      { firstName: { contains: term, mode: "insensitive" } },
      { lastName: { contains: term, mode: "insensitive" } },
    ];
    const [first, ...rest] = words;
    if (first && rest.length > 0) {
      const tail = rest.join(" ");
      or.push({ AND: [{ firstName: { contains: first, mode: "insensitive" } }, { lastName: { contains: tail, mode: "insensitive" } }] });
      or.push({ AND: [{ lastName: { contains: first, mode: "insensitive" } }, { firstName: { contains: tail, mode: "insensitive" } }] });
    }
    const rows = await db.user.findMany({
      where: {
        AND: [
          { status: { not: PrismaAccountStatus.deleted } },
          { roles: { none: { role: PrismaUserRole.admin } } },
          { OR: or },
        ],
      },
      include: { roles: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      fullName: fullName(row),
      email: row.email,
      status: parseAccountStatus(row.status),
      photoUrl: row.photoUrl,
      emailVerified: row.emailVerified,
      isAdmin: row.roles.some((grant) => grant.role === PrismaUserRole.admin),
    }));
  }

  /**
   * Otorga el rol a un usuario existente por email (AC1, AC2). Exige email verificado y
   * cuenta `active`, las mismas condiciones que pide el login del panel (`isPanelEligible`,
   * MOVO-287): un admin que no cumple alguna no podría entrar.
   */
  async function grantAdmin(email: string, requestedBy: AdminRoleRequester): Promise<GrantAdminResult> {
    const user = await userRepository.findByEmail(email.trim());
    if (!user || user.status === AccountStatus.DELETED) {
      throw new ApiError(404, "USER_NOT_FOUND", "No existe un usuario con ese email.");
    }

    // Idempotente (AC1): quien ya es admin no se revalida. Si hoy está suspendido, otorgar
    // no cambia nada y no tiene por qué fallar (review de PR #247).
    let alreadyAdmin = user.roles.includes(UserRole.ADMIN);
    if (!alreadyAdmin) {
      if (!user.emailVerified) {
        throw new ApiError(422, "ADMIN_GRANT_EMAIL_NOT_VERIFIED", "El usuario no verificó su email.");
      }
      if (user.status !== AccountStatus.ACTIVE) {
        throw new ApiError(422, "ADMIN_GRANT_ACCOUNT_NOT_ACTIVE", "La cuenta del usuario no está activa.");
      }
      try {
        await db.userRoleGrant.create({ data: { userId: user.id, role: PrismaUserRole.admin } });
      } catch (error) {
        // Dos otorgamientos simultáneos: el que pierde la carrera choca con la PK
        // (user_id, role) y lo trata como "ya era admin", sin mandar un segundo aviso.
        if (!isUniqueViolation(error)) {
          throw error;
        }
        alreadyAdmin = true;
      }
    }

    const grant = await findGrant(user.id);
    if (!grant) {
      // Lo revocaron entre el INSERT y esta lectura: no hay nada coherente que devolver.
      throw new ApiError(409, "ADMIN_GRANT_CONFLICT", "El rol se revocó mientras se otorgaba. Reintentá.");
    }

    logger.info(
      { action: "admin_role_granted", targetUserId: user.id, requestedBy, alreadyAdmin },
      alreadyAdmin ? "El usuario ya era admin" : "Rol admin otorgado"
    );

    if (!alreadyAdmin) {
      // AC5, best-effort: el rol ya quedó persistido. Un fallo del proveedor no lo revierte
      // ni cambia la respuesta, mismo criterio que el aviso al email anterior (MOVO-139).
      try {
        const message = buildAdminGrantedNotice();
        await emailProvider.send(user.email, message.subject, { text: message.text, html: message.html });
      } catch (error) {
        logger.warn(
          { action: "admin_role_granted_email_failed", targetUserId: user.id, err: String(error) },
          "No se pudo mandar el aviso de rol admin"
        );
      }
    }

    return { admin: toAdminSummary(grant), alreadyAdmin };
  }

  /**
   * Revoca el rol (AC3, AC4). Nunca deja al sistema sin un admin que pueda entrar al panel:
   * la cuenta de "los que quedan" son los admins con email verificado y cuenta `active`, no
   * cualquier fila con el rol. Una cuenta suspendida o dada de baja que conserve el rol no
   * sirve para administrar nada.
   */
  async function revokeAdmin(userId: string, requestedBy: AdminRoleRequester): Promise<void> {
    if (!sessionRepository) {
      throw new Error("Revocar el rol admin requiere el repositorio de sesiones de panel.");
    }
    let isAdmin = true;
    let userExists = false;
    try {
      await db.$transaction(async (tx) => {
        const [lastAdminCheck, existingUser] = await Promise.all([
          ensureNotLastEligibleAdmin(tx, userId, "No se puede revocar el rol al último admin."),
          tx.user.findUnique({ where: { id: userId }, select: { id: true } }),
        ]);
        userExists = Boolean(existingUser);
        if (!lastAdminCheck.isAdmin) {
          isAdmin = false;
          throw new ApiError(404, "ADMIN_NOT_FOUND", "El usuario no es admin.");
        }
        await tx.userRoleGrant.delete({ where: { userId_role: { userId, role: PrismaUserRole.admin } } });
      });
    } catch (error) {
      if (!isAdmin && userExists && sessionRepository) {
        // Corta las sesiones de panel residuales solo si el usuario existe (ej. reintento tras
        // un intento anterior que borró el rol pero falló en Redis). Si Redis falla acá,
        // se loguea como warn y NO pisa el 404 (review de PR #247). Si el usuario no existe,
        // no se escribe panel-revoked-at para UUIDs inexistentes.
        try {
          await sessionRepository.revokePanelSessionsForUser(userId);
        } catch (redisError) {
          logger.warn(
            { action: "admin_role_revoke_session_cut_failed", targetUserId: userId, err: String(redisError) },
            "No se pudieron cortar las sesiones de panel tras reintento de revocación"
          );
        }
      }
      throw error;
    }

    logger.info({ action: "admin_role_revoked", targetUserId: userId, requestedBy }, "Rol admin revocado");

    // AC4, después del commit: si se cortara antes y el DELETE fallara, el último admin
    // quedaría afuera del panel con el rol intacto. Si Redis falla acá, el error sale como
    // 500 y el reintento lo completa (ver la rama de "no es admin" de arriba). Mientras
    // tanto, el refresh de panel ya revalida el rol contra la base (AC5 de MOVO-287) y el
    // access token vive como mucho 15 min.
    if (sessionRepository) {
      try {
        await sessionRepository.revokePanelSessionsForUser(userId);
      } catch (error) {
        logger.error(
          { action: "admin_role_revoked_session_cut_failed", targetUserId: userId, requestedBy, err: String(error) },
          "Rol admin revocado pero no se pudieron cortar las sesiones de panel"
        );
        throw error;
      }
    }
  }

  return { listAdmins, searchCandidates, grantAdmin, revokeAdmin };
}

export type AdminRolesService = ReturnType<typeof createAdminRolesService>;
