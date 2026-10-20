import {
  ADMIN_USER_MODERATION_LIMIT,
  AdminContactField,
  AdminContactUpdateResult,
  AdminKycCard,
  AdminKycStatus,
  AdminSessionsRevokeResult,
  AdminUserDevices,
  AdminUserListItem,
  AdminUserMatch,
  AdminUserModeration,
  AdminUserPage,
  AdminUserProfile,
  AdminUserReport,
  AdminUserRoleName,
  AdminUserVehicle,
  ApiError,
} from "@movo/shared";
import {
  AccountStatus as PrismaAccountStatus,
  KycStatus as PrismaKycStatus,
  Prisma,
  PrismaClient,
  UserRole as PrismaUserRole,
  VerificationType,
} from "../../generated/prisma/client";
import { buildContactChangedBySupportNotice, EmailProvider } from "../../adapters/email-provider";
import { SessionRepository } from "../../repositories/session-repository";
import { fullName } from "../../models/user";
import { normalizePhoneToE164Ar } from "../auth/auth.service";
import { describeDecisionWarnings } from "../kyc/kyc.service";

export const ADMIN_USERS_DEFAULT_PAGE_SIZE = 10;
export const ADMIN_USERS_MAX_PAGE_SIZE = 50;
/** Teléfono o DNI parcial: con menos dígitos casi todo coincide. */
export const ADMIN_USERS_MIN_DIGITS = 3;

/** Lo que usa este servicio del logger de Fastify. */
export interface AdminUsersLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface AdminUsersServiceDeps {
  db: PrismaClient;
  sessionRepository: Pick<
    SessionRepository,
    "revokeAllForUser" | "revokeAccessTokensIssuedBefore" | "revokePanelSessionsForUser"
  >;
  emailProvider: EmailProvider;
  logger: AdminUsersLogger;
}

export interface AdminContactUpdateInput {
  field: AdminContactField;
  newValue: string;
  expectedCurrent: string;
}

/** Lo que responde el endpoint interno: además del resultado público, si falló algún aviso. */
export interface AdminContactUpdateOutcome extends AdminContactUpdateResult {
  noticeFailed: boolean;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_AR_PATTERN = /^\+549\d{10}$/;
// Teléfono o DNI escrito con separadores: "+54 9 351-123", "33.812.405", "(0351) 456".
const DIGIT_QUERY_PATTERN = /^[\d\s.+()-]+$/;

// `translate` en vez de la extensión `unaccent`, que no está instalada: mismas letras que
// pliega `foldAccents` del lado de JS (NFD), así "Núñez" y "nunez" coinciden.
const ACCENTED = "áàäâãéèëêíìïîóòöôõúùüûñç";
const PLAIN = "aaaaaeeeeiiiiooooouuuunc";

function foldAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

const folded = (column: Prisma.Sql) => Prisma.sql`translate(lower(${column}), ${ACCENTED}, ${PLAIN})`;

/**
 * Dígitos a buscar dentro de `users.phone` (E.164). Un número completo se normaliza con la misma
 * función del login, sacando antes el 0 de larga distancia que el login no contempla ("0351…");
 * uno parcial se busca tal cual (sin ese 0), porque quitarle un "54" o un "9" del principio
 * cambiaría qué dígitos son.
 */
function phoneDigitsOf(query: string, digits: string): string {
  const withoutTrunk = digits.replace(/^0/, "");
  if (query.trim().startsWith("+") || digits.length >= 10) {
    return normalizePhoneToE164Ar(withoutTrunk).slice(1);
  }
  return withoutTrunk;
}

interface SearchRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  dni: string | null;
  photo_url: string | null;
  status: string;
  banned_until: Date | null;
  kyc_status_identity: string;
  kyc_status_license: string;
  created_at: Date;
  roles: string[];
  matched_by: AdminUserMatch | null;
}

/**
 * Condición de cada criterio del buscador y el `matchedBy` resultante. Sin `q` ninguno aplica y
 * se listan todas las cuentas (incluidas las dadas de baja).
 */
function buildMatchExpression(rawQuery: string): Prisma.Sql | null {
  const query = rawQuery.trim().replace(/\s+/g, " ");
  if (!query) return null;

  const namePattern = `%${escapeLike(foldAccents(query))}%`;
  const nameMatch = Prisma.sql`(
    ${folded(Prisma.sql`u.first_name`)} LIKE ${namePattern}
    OR ${folded(Prisma.sql`u.last_name`)} LIKE ${namePattern}
    OR ${folded(Prisma.sql`u.first_name || ' ' || u.last_name`)} LIKE ${namePattern}
    OR ${folded(Prisma.sql`u.last_name || ' ' || u.first_name`)} LIKE ${namePattern}
  )`;
  const emailMatch = Prisma.sql`lower(u.email) LIKE ${`%${escapeLike(query.toLowerCase())}%`}`;

  const digits = query.replace(/\D/g, "");
  const isDigitQuery = DIGIT_QUERY_PATTERN.test(query) && digits.length >= ADMIN_USERS_MIN_DIGITS;
  const dniMatch = isDigitQuery
    ? Prisma.sql`regexp_replace(coalesce(u.dni, ''), '\\D', '', 'g') LIKE ${`%${digits}%`}`
    : Prisma.sql`FALSE`;
  const phoneMatch = isDigitQuery
    ? Prisma.sql`u.phone LIKE ${`%${phoneDigitsOf(query, digits)}%`}`
    : Prisma.sql`FALSE`;

  // Prioridad del chip del panel: nombre, email, DNI, teléfono.
  return Prisma.sql`CASE
    WHEN ${nameMatch} THEN 'name'
    WHEN ${emailMatch} THEN 'email'
    WHEN ${dniMatch} THEN 'dni'
    WHEN ${phoneMatch} THEN 'phone'
  END`;
}

const MATCH_ORDER = Prisma.sql`CASE m.matched_by WHEN 'name' THEN 0 WHEN 'email' THEN 1 WHEN 'dni' THEN 2 ELSE 3 END`;

function toListItem(row: SearchRow): AdminUserListItem {
  return {
    id: row.id,
    fullName: fullName({ firstName: row.first_name, lastName: row.last_name }),
    email: row.email,
    phone: row.phone,
    dni: row.dni,
    photoUrl: row.photo_url,
    roles: row.roles as AdminUserRoleName[],
    accountStatus: row.status as AdminUserListItem["accountStatus"],
    bannedUntil: row.banned_until?.toISOString() ?? null,
    kycIdentity: row.kyc_status_identity as AdminKycStatus,
    kycLicense: row.kyc_status_license as AdminKycStatus,
    createdAt: row.created_at.toISOString(),
    matchedBy: row.matched_by,
  };
}

/** Los motivos solo se muestran cuando explican un resultado negativo o una revisión. */
const STATUSES_WITH_REASON: ReadonlySet<PrismaKycStatus> = new Set([PrismaKycStatus.rejected, PrismaKycStatus.manual_review]);

type KycAttemptRow = Prisma.KycVerificationGetPayload<Record<string, never>>;

function toKycCard(status: PrismaKycStatus, attempts: KycAttemptRow[]): AdminKycCard {
  const last = attempts[attempts.length - 1];
  return {
    status,
    lastSessionId: last?.externalSessionId ?? null,
    // De la más vieja a la más nueva: el panel toma la última como "último intento".
    attempts: attempts.map((attempt) => ({
      status: attempt.status,
      requestedAt: attempt.requestedAt.toISOString(),
      resolvedAt: attempt.resolvedAt?.toISOString() ?? null,
      reason: STATUSES_WITH_REASON.has(attempt.status) ? describeDecisionWarnings(attempt.rawDecision) : null,
    })),
  };
}

function isUniqueViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const userNotFound = () => new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");

/**
 * MOVO-294: lecturas de la ficha del panel y acciones de soporte sobre la cuenta. Solo lo llama
 * `svc-admin` por los endpoints internos, que ya exigió el rol admin, aplicó la regla de conflicto
 * de interés y escribe la bitácora: acá no se decide quién puede, solo se aplica.
 */
export function createAdminUsersService(deps: AdminUsersServiceDeps) {
  const { db, sessionRepository, emailProvider, logger } = deps;

  async function findUserOrThrow(id: string) {
    const user = await db.user.findUnique({ where: { id }, include: { roles: true } });
    if (!user) throw userNotFound();
    return user;
  }

  async function assertExists(id: string): Promise<void> {
    const found = await db.user.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw userNotFound();
  }

  /** Las acciones de soporte no operan sobre una cuenta dada de baja (anonimizada). */
  function assertNotDeleted(user: { status: PrismaAccountStatus }): void {
    if (user.status === PrismaAccountStatus.deleted) {
      throw new ApiError(409, "USER_DELETED", "La cuenta está dada de baja.");
    }
  }

  async function revokeSessions(userId: string, isAdmin: boolean): Promise<number> {
    let revoked = await sessionRepository.revokeAllForUser(userId);
    // Sin la marca, el access token ya emitido seguiría valiendo hasta sus 60 min (ADR-004).
    await sessionRepository.revokeAccessTokensIssuedBefore(userId);
    // Las sesiones del panel viven aparte (MOVO-287): si es admin también se cortan.
    if (isAdmin) revoked += await sessionRepository.revokePanelSessionsForUser(userId);
    return revoked;
  }

  async function sendNotice(to: string, field: AdminContactField, newValue: string): Promise<boolean> {
    const { subject, text, html } = buildContactChangedBySupportNotice(field, newValue);
    try {
      await emailProvider.send(to, subject, { text, html });
      return true;
    } catch (error) {
      logger.warn({ action: "admin_contact_notice_failed", field, err: String(error) }, "No se pudo mandar el aviso del cambio de contacto");
      return false;
    }
  }

  return {
    /** `GET /internal/admin/users`: paginado por número porque el panel muestra "1–10 de N". */
    async search(query: string, page: number, pageSize: number): Promise<AdminUserPage> {
      const match = buildMatchExpression(query);
      const matched = Prisma.sql`
        SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.dni, u.photo_url, u.status::text AS status,
               u.banned_until, u.kyc_status_identity::text AS kyc_status_identity,
               u.kyc_status_license::text AS kyc_status_license, u.created_at,
               ${match ?? Prisma.sql`NULL::text`} AS matched_by
        FROM users.users u`;
      const filter = match ? Prisma.sql`WHERE m.matched_by IS NOT NULL` : Prisma.empty;
      const order = match
        ? Prisma.sql`ORDER BY ${MATCH_ORDER}, m.created_at DESC, m.id DESC`
        : Prisma.sql`ORDER BY m.created_at DESC, m.id DESC`;

      const [rows, [counted]] = await Promise.all([
        db.$queryRaw<SearchRow[]>`
          SELECT m.*,
                 COALESCE((SELECT array_agg(r.role::text ORDER BY r.role) FROM users.user_roles r WHERE r.user_id = m.id), '{}') AS roles
          FROM (${matched}) m
          ${filter}
          ${order}
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        db.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total FROM (${matched}) m ${filter}`,
      ]);
      return { items: rows.map(toListItem), page, pageSize, total: Number(counted?.total ?? 0) };
    },

    async getProfile(id: string): Promise<AdminUserProfile> {
      const user = await findUserOrThrow(id);
      return {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: fullName(user),
        email: user.email,
        emailVerified: user.emailVerified,
        phone: user.phone,
        phoneVerified: user.phoneVerified,
        dni: user.dni,
        birthdate: user.birthdate?.toISOString().slice(0, 10) ?? null,
        photoUrl: user.photoUrl,
        createdAt: user.createdAt.toISOString(),
        deletedAt: user.deletedAt?.toISOString() ?? null,
        roles: [...user.roles]
          .sort((a, b) => a.grantedAt.getTime() - b.grantedAt.getTime())
          .map((grant) => ({ role: grant.role, grantedAt: grant.grantedAt.toISOString() })),
        accountStatus: user.status,
        bannedUntil: user.bannedUntil?.toISOString() ?? null,
      };
    },

    /** Identidad y licencia. La tarjeta de Mercado Pago la arma `svc-admin` con `svc-payments`. */
    async getKyc(id: string): Promise<{ identity: AdminKycCard; license: AdminKycCard }> {
      const user = await db.user.findUnique({
        where: { id },
        select: {
          kycStatusIdentity: true,
          kycStatusLicense: true,
          driversLicense: { select: { expirationDate: true } },
          kycVerifications: { orderBy: [{ requestedAt: "asc" }, { id: "asc" }] },
        },
      });
      if (!user) throw userNotFound();
      const ofType = (type: VerificationType) => user.kycVerifications.filter((attempt) => attempt.verificationType === type);
      return {
        identity: toKycCard(user.kycStatusIdentity, ofType(VerificationType.identity)),
        license: {
          ...toKycCard(user.kycStatusLicense, ofType(VerificationType.license)),
          expiresAt: user.driversLicense?.expirationDate?.toISOString().slice(0, 10) ?? null,
        },
      };
    },

    async getVehicle(id: string): Promise<AdminUserVehicle> {
      const user = await db.user.findUnique({ where: { id }, select: { vehicleProfile: true } });
      if (!user) throw userNotFound();
      const vehicle = user.vehicleProfile;
      return {
        vehicle: vehicle
          ? { brand: vehicle.brand, model: vehicle.model, licensePlate: vehicle.licensePlate, cargoCapacityLabel: vehicle.cargoCapacityLabel }
          : null,
      };
    },

    /** Reportes y bloqueos en las dos direcciones: cada lista con las más recientes, `totals` con todas. */
    async getModeration(id: string): Promise<AdminUserModeration> {
      await assertExists(id);
      const party = { select: { id: true, firstName: true, lastName: true } } as const;
      const reportInclude = {
        reporter: party,
        reported: party,
        _count: { select: { entries: true, photos: true } },
      } satisfies Prisma.UserReportInclude;
      const recent = { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: ADMIN_USER_MODERATION_LIMIT };

      const [received, made, blocksMade, blocksReceived, totals] = await Promise.all([
        db.userReport.findMany({ where: { reportedId: id }, include: reportInclude, ...recent }),
        db.userReport.findMany({ where: { reporterId: id }, include: reportInclude, ...recent }),
        db.userBlock.findMany({ where: { blockerId: id }, include: { blocked: party }, ...recent }),
        db.userBlock.findMany({ where: { blockedId: id }, include: { blocker: party }, ...recent }),
        Promise.all([
          db.userReport.count({ where: { reportedId: id } }),
          db.userReport.count({ where: { reporterId: id } }),
          db.userBlock.count({ where: { blockerId: id } }),
          db.userBlock.count({ where: { blockedId: id } }),
        ]),
      ]);

      type ReportRow = (typeof received)[number];
      const toReport = (row: ReportRow, counterpart: ReportRow["reporter"]): AdminUserReport => ({
        id: row.id,
        reason: row.reason,
        status: row.status,
        counterpart: { id: counterpart.id, fullName: fullName(counterpart) },
        details: row.details,
        createdAt: row.createdAt.toISOString(),
        extraEntries: row._count.entries,
        // Solo la cantidad: las fotos son evidencia privada (presigned) y no salen de acá.
        photos: row._count.photos,
      });

      return {
        reports: {
          received: received.map((row) => toReport(row, row.reporter)),
          made: made.map((row) => toReport(row, row.reported)),
        },
        blocks: {
          made: blocksMade.map((row) => ({ user: { id: row.blocked.id, fullName: fullName(row.blocked) }, createdAt: row.createdAt.toISOString() })),
          received: blocksReceived.map((row) => ({ user: { id: row.blocker.id, fullName: fullName(row.blocker) }, createdAt: row.createdAt.toISOString() })),
        },
        totals: { reportsReceived: totals[0], reportsMade: totals[1], blocksMade: totals[2], blocksReceived: totals[3] },
      };
    },

    /** Nunca el token de Expo ni la clave pública del handshake. */
    async getDevices(id: string): Promise<AdminUserDevices> {
      const user = await db.user.findUnique({
        where: { id },
        select: {
          pushTokens: { orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { id: true, platform: true, deviceId: true, updatedAt: true } },
          deviceKey: { select: { updatedAt: true } },
        },
      });
      if (!user) throw userNotFound();
      return {
        devices: user.pushTokens.map((token) => ({ id: token.id, platform: token.platform, deviceId: token.deviceId, updatedAt: token.updatedAt.toISOString() })),
        // Una rotación pisa la misma fila: la fecha vigente es la del último upsert.
        handshakeKey: user.deviceKey ? { registeredAt: user.deviceKey.updatedAt.toISOString() } : null,
      };
    },

    /** Nombres para las contrapartes que muestran otros servicios (envíos, calificaciones, admins). */
    async getNames(ids: string[]): Promise<{ id: string; fullName: string }[]> {
      if (ids.length === 0) return [];
      const rows = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } });
      return rows.map((row) => ({ id: row.id, fullName: fullName(row) }));
    },

    /** No bloquea el login: para impedir que vuelva a entrar está la sanción (MOVO-36). */
    async revokeAllSessions(id: string, requestedBy: string): Promise<AdminSessionsRevokeResult> {
      const user = await findUserOrThrow(id);
      assertNotDeleted(user);
      const isAdmin = user.roles.some((grant) => grant.role === PrismaUserRole.admin);
      const revokedRefreshTokens = await revokeSessions(id, isAdmin);
      logger.info({ action: "admin_sessions_revoked", targetUserId: id, requestedBy, revokedRefreshTokens }, "Sesiones cerradas desde el panel");
      return { revokedRefreshTokens };
    },

    /**
     * Cambio de email o teléfono por soporte. El valor nuevo queda sin verificar (un admin no
     * puede probar que la persona es dueña de la casilla o del número) y se cierran las sesiones
     * porque cambió una credencial. `expectedCurrent` evita pisar un cambio que hizo el propio
     * usuario u otro admin mientras el diálogo estaba abierto.
     */
    async updateContact(id: string, input: AdminContactUpdateInput, requestedBy: string): Promise<AdminContactUpdateOutcome> {
      const user = await findUserOrThrow(id);
      assertNotDeleted(user);

      const isEmail = input.field === "email";
      // La normalización del login es la que vale, aunque el panel ya mande el valor normalizado.
      const normalize = (value: string) => (isEmail ? value.trim().toLowerCase() : normalizePhoneToE164Ar(value));
      const newValue = normalize(input.newValue);
      if (isEmail ? !EMAIL_PATTERN.test(newValue) : !E164_AR_PATTERN.test(newValue)) {
        throw new ApiError(400, "VALIDATION_FAILED", isEmail ? "Ingresá un email válido." : "Ingresá un teléfono válido.");
      }
      const current = isEmail ? user.email : user.phone;
      if (normalize(input.expectedCurrent) !== normalize(current)) {
        throw new ApiError(409, "CONTACT_CHANGED", "El dato cambió mientras lo editabas. Revisalo y volvé a intentar.");
      }
      if (newValue === normalize(current)) {
        throw new ApiError(400, "CONTACT_UNCHANGED", "El valor nuevo es igual al actual.");
      }

      const inUse = isEmail
        ? new ApiError(409, "EMAIL_ALREADY_IN_USE", "Ese email ya está en uso por otra cuenta.")
        : new ApiError(409, "PHONE_ALREADY_IN_USE", "Ese teléfono ya está en uso por otra cuenta.");
      // Sin revelar de quién es: el chequeo explícito cubre el casing del email (el índice único
      // sobre LOWER(email) lo cubre también en la base, para la carrera).
      const taken = await db.user.findFirst({
        where: isEmail ? { email: { equals: newValue, mode: "insensitive" }, id: { not: id } } : { phone: newValue, id: { not: id } },
        select: { id: true },
      });
      if (taken) throw inUse;

      let updated;
      try {
        // Condicionado al valor que se leyó: si cambió entre la lectura y el UPDATE, no pisa nada.
        const { count } = await db.user.updateMany({
          where: { id, ...(isEmail ? { email: current } : { phone: current }) },
          data: isEmail ? { email: newValue, emailVerified: false, emailVerifiedAt: null } : { phone: newValue, phoneVerified: false },
        });
        if (count === 0) throw new ApiError(409, "CONTACT_CHANGED", "El dato cambió mientras lo editabas. Revisalo y volvé a intentar.");
        updated = await findUserOrThrow(id);
      } catch (error) {
        if (isUniqueViolation(error)) throw inUse;
        throw error;
      }

      const isAdmin = updated.roles.some((grant) => grant.role === PrismaUserRole.admin);
      const revokedRefreshTokens = await revokeSessions(id, isAdmin);

      // Best-effort: el cambio ya está aplicado; si un aviso falla queda registrado en la bitácora.
      const recipients = isEmail ? [current, newValue] : [updated.email];
      const sent = await Promise.all(recipients.map((to) => sendNotice(to, input.field, newValue)));

      logger.info({ action: "admin_contact_updated", targetUserId: id, requestedBy, field: input.field }, "Contacto cambiado desde el panel");
      return {
        email: updated.email,
        emailVerified: updated.emailVerified,
        phone: updated.phone,
        phoneVerified: updated.phoneVerified,
        revokedRefreshTokens,
        noticeFailed: sent.includes(false),
      };
    },
  };
}

export type AdminUsersService = ReturnType<typeof createAdminUsersService>;
