import {
  AdminKycEvidence,
  AdminKycReviewDetail,
  AdminKycReviewHistoryItem,
  AdminKycReviewPage,
  AdminKycReviewRow,
  AdminKycVerificationType,
  ApiError,
  KycStatus,
} from "@movo/shared";
import { KycStatus as PrismaKycStatus, Prisma, PrismaClient } from "../../generated/prisma/client";
import { fullName } from "../../models/user";
import { DiditClient } from "../../adapters/didit-client";
import { buildKycEvidence } from "./kyc-evidence";
import { describeDecisionWarnings } from "./kyc.service";

type ReviewRow = Prisma.KycVerificationGetPayload<{
  include: { user: { select: { id: true; firstName: true; lastName: true; email: true; phone: true; photoUrl: true } } };
}>;

const REVIEW_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  photoUrl: true,
} as const;

const notFound = () => new ApiError(404, "KYC_SESSION_NOT_FOUND", "No existe esa verificación.");

function toRow(row: ReviewRow): AdminKycReviewRow {
  return {
    sessionId: row.externalSessionId,
    userId: row.userId,
    fullName: fullName(row.user),
    photoUrl: row.user.photoUrl,
    verificationType: row.verificationType as AdminKycVerificationType,
    reason: describeDecisionWarnings(row.rawDecision),
    requestedAt: row.requestedAt.toISOString(),
  };
}

function expirationDateOf(rawDecision: unknown): string | null {
  const value = (rawDecision as { expiration_date?: unknown } | null | undefined)?.expiration_date;
  return typeof value === "string" ? value : null;
}

/**
 * Lecturas de la cola de revisión manual de KYC del panel. Solo lista intentos en
 * `manual_review`, y solo los que todavía se pueden decidir: el último intento de su usuario
 * y tipo (si el usuario abrió una sesión más nueva, el viejo queda superado, ver
 * `kyc.service.ts#decideManualReview`). La decisión en sí vive en el servicio de KYC.
 */
export function createKycReviewService(db: PrismaClient, diditClient: DiditClient) {
  /** Ids de los intentos que ya no son el último de su usuario y tipo. */
  async function supersededIds(rows: { id: string; userId: string; verificationType: string; requestedAt: Date }[]) {
    if (rows.length === 0) return new Set<string>();
    const newer = await db.kycVerification.findMany({
      where: { userId: { in: [...new Set(rows.map((row) => row.userId))] } },
      select: { userId: true, verificationType: true, requestedAt: true },
    });
    const superseded = new Set<string>();
    for (const row of rows) {
      const hasNewer = newer.some(
        (other) =>
          other.userId === row.userId &&
          other.verificationType === row.verificationType &&
          other.requestedAt.getTime() > row.requestedAt.getTime()
      );
      if (hasNewer) superseded.add(row.id);
    }
    return superseded;
  }

  return {
    /** `GET /internal/admin/kyc/reviews`: el más viejo primero (el que más espera). */
    async list(input: {
      type?: AdminKycVerificationType | undefined;
      q: string;
      page: number;
      pageSize: number;
    }): Promise<AdminKycReviewPage> {
      const term = input.q.trim();
      const where: Prisma.KycVerificationWhereInput = {
        status: KycStatus.MANUAL_REVIEW as PrismaKycStatus,
        ...(input.type ? { verificationType: input.type } : {}),
        ...(term
          ? {
              OR: [
                { externalSessionId: { equals: term } },
                { user: { email: { contains: term, mode: "insensitive" } } },
                { user: { firstName: { contains: term, mode: "insensitive" } } },
                { user: { lastName: { contains: term, mode: "insensitive" } } },
              ],
            }
          : {}),
      };
      const rows = await db.kycVerification.findMany({
        where,
        include: { user: { select: REVIEW_USER_SELECT } },
        orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
      });
      const superseded = await supersededIds(rows);
      const open = rows.filter((row) => !superseded.has(row.id));
      const start = (input.page - 1) * input.pageSize;
      return {
        items: open.slice(start, start + input.pageSize).map(toRow),
        page: input.page,
        pageSize: input.pageSize,
        total: open.length,
      };
    },

    /** `GET /internal/admin/kyc/reviews/:sessionId`. También sirve un intento ya resuelto (con `decidable: false`). */
    async detail(sessionId: string): Promise<AdminKycReviewDetail> {
      const row = await db.kycVerification.findUnique({
        where: { externalSessionId: sessionId },
        include: { user: { select: REVIEW_USER_SELECT } },
      });
      if (!row) throw notFound();

      const attempts = await db.kycVerification.findMany({
        where: { userId: row.userId, verificationType: row.verificationType },
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      });
      const isLatest = attempts[0]?.id === row.id;
      const history: AdminKycReviewHistoryItem[] = attempts
        .filter((attempt) => attempt.id !== row.id)
        .map((attempt) => ({
          sessionId: attempt.externalSessionId,
          status: attempt.status,
          requestedAt: attempt.requestedAt.toISOString(),
          resolvedAt: attempt.resolvedAt?.toISOString() ?? null,
          reason: describeDecisionWarnings(attempt.rawDecision),
        }));

      return {
        ...toRow(row),
        email: row.user.email,
        phone: row.user.phone,
        expirationDate: expirationDateOf(row.rawDecision),
        decidable: row.status === (KycStatus.MANUAL_REVIEW as PrismaKycStatus) && isLatest,
        history,
      };
    },

    /**
     * `GET /internal/admin/kyc/reviews/:sessionId/evidence`: el detalle completo que tiene Didit (datos del documento,
     * puntuaciones, IP, alertas y las imágenes como links temporales). Se pide a Didit cada vez y **no se guarda ni se
     * loguea nada** (AC9). 404 `KYC_SESSION_NOT_FOUND` si Movo no conoce el intento, 422 `KYC_EVIDENCE_NOT_FOUND` si Didit
     * no conoce la sesión y 502 `KYC_PROVIDER_ERROR` si Didit no responde.
     */
    async evidence(sessionId: string): Promise<AdminKycEvidence> {
      const attempt = await db.kycVerification.findUnique({ where: { externalSessionId: sessionId }, select: { id: true } });
      if (!attempt) throw notFound();
      const decision = await diditClient.getSessionDecision(sessionId);
      if (!decision) throw new ApiError(422, "KYC_EVIDENCE_NOT_FOUND", "Didit no tiene detalle de esta sesión.");
      return buildKycEvidence(decision.decision);
    },
  };
}
