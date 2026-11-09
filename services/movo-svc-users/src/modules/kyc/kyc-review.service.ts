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
import { DiditClient } from "../../adapters/didit-client";
import { fullName } from "../../models/user";
import { buildMatchExpression } from "../admin-users/admin-users.service";
import { buildKycEvidence } from "./kyc-evidence";
import { describeDecisionWarnings } from "./kyc.service";

const notFound = () => new ApiError(404, "KYC_SESSION_NOT_FOUND", "No existe esa verificación.");

function expirationDateOf(rawDecision: unknown): string | null {
  const value = (rawDecision as { expiration_date?: unknown } | null | undefined)?.expiration_date;
  return typeof value === "string" ? value : null;
}

interface QueueRow {
  external_session_id: string;
  user_id: string;
  verification_type: string;
  requested_at: Date;
  resolved_at: Date | null;
  raw_decision: unknown;
  first_name: string;
  last_name: string;
  email: string;
  photo_url: string | null;
}

/**
 * Lecturas de la cola de revisión manual de KYC del panel. La cola lista solo intentos en `manual_review` que todavía se
 * pueden decidir: el último de su usuario y tipo (si el usuario abrió una sesión más nueva, el viejo queda superado, ver
 * `kyc.service.ts#decideManualReview`) y de una cuenta que no se dio de baja. La decisión en sí vive en el servicio de KYC.
 */
export function createKycReviewService(db: PrismaClient, diditClient: DiditClient) {
  return {
    /**
     * `GET /internal/admin/kyc/reviews`: el que más espera primero, contando desde que pasó a revisión (`resolved_at`, que
     * la transición a `manual_review` graba) y no desde que se abrió la sesión. Filtra, pagina y cuenta en SQL: el último
     * intento por usuario y tipo sale de un `DISTINCT ON`, como la bandeja de KYC de la home. La búsqueda reutiliza la del
     * buscador de usuarios (sin acentos, nombre completo en cualquier orden, email, DNI y teléfono) y suma el id de sesión.
     */
    async list(input: {
      type?: AdminKycVerificationType | undefined;
      q: string;
      page: number;
      pageSize: number;
    }): Promise<AdminKycReviewPage> {
      const term = input.q.trim();
      const match = buildMatchExpression(term);
      const filters = [
        Prisma.sql`l.status::text = 'manual_review'`,
        Prisma.sql`u.deleted_at IS NULL`,
        ...(input.type ? [Prisma.sql`l.verification_type::text = ${input.type}`] : []),
        ...(match ? [Prisma.sql`((${match}) IS NOT NULL OR l.external_session_id = ${term})`] : []),
      ];
      const queue = Prisma.sql`
        WITH latest AS (
          SELECT DISTINCT ON (v.user_id, v.verification_type)
                 v.id, v.user_id, v.verification_type, v.external_session_id, v.status,
                 v.requested_at, v.resolved_at, v.raw_decision
          FROM users.kyc_verification v
          ORDER BY v.user_id, v.verification_type, v.requested_at DESC, v.id DESC
        )
        SELECT l.id, l.external_session_id, l.user_id, l.verification_type::text AS verification_type,
               l.requested_at, l.resolved_at, l.raw_decision, u.first_name, u.last_name, u.email, u.photo_url
        FROM latest l
        JOIN users.users u ON u.id = l.user_id
        WHERE ${Prisma.join(filters, " AND ")}`;

      const [rows, [counted]] = await Promise.all([
        db.$queryRaw<QueueRow[]>`
          SELECT * FROM (${queue}) q
          ORDER BY COALESCE(q.resolved_at, q.requested_at) ASC, q.id ASC
          LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}`,
        db.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total FROM (${queue}) q`,
      ]);

      const items: AdminKycReviewRow[] = rows.map((row) => ({
        sessionId: row.external_session_id,
        userId: row.user_id,
        // Una cuenta que todavía no tiene el nombre del documento (justo lo que esta cola revisa) se muestra por su email.
        fullName: fullName({ firstName: row.first_name, lastName: row.last_name }) || row.email,
        photoUrl: row.photo_url,
        verificationType: row.verification_type as AdminKycVerificationType,
        reason: describeDecisionWarnings(row.raw_decision),
        requestedAt: row.requested_at.toISOString(),
        inReviewSince: (row.resolved_at ?? row.requested_at).toISOString(),
      }));
      return { items, page: input.page, pageSize: input.pageSize, total: Number(counted?.total ?? 0) };
    },

    /** `GET /internal/admin/kyc/reviews/:sessionId`. También sirve un intento ya resuelto (con `decidable: false`). */
    async detail(sessionId: string): Promise<AdminKycReviewDetail> {
      const row = await db.kycVerification.findUnique({
        where: { externalSessionId: sessionId },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, photoUrl: true } },
        },
      });
      if (!row) throw notFound();

      const attempts = await db.kycVerification.findMany({
        where: { userId: row.userId, verificationType: row.verificationType },
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      });
      const isLatest = attempts[0]?.id === row.id;
      const inReview = row.status === (KycStatus.MANUAL_REVIEW as PrismaKycStatus);
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
        sessionId: row.externalSessionId,
        userId: row.userId,
        fullName: fullName(row.user) || row.user.email,
        photoUrl: row.user.photoUrl,
        verificationType: row.verificationType as AdminKycVerificationType,
        reason: describeDecisionWarnings(row.rawDecision),
        requestedAt: row.requestedAt.toISOString(),
        // En revisión, `resolvedAt` es cuándo entró a revisión; resuelto, es cuándo se decidió.
        inReviewSince: inReview ? (row.resolvedAt ?? row.requestedAt).toISOString() : null,
        status: row.status,
        resolvedAt: inReview ? null : (row.resolvedAt?.toISOString() ?? null),
        email: row.user.email,
        firstName: row.user.firstName,
        lastName: row.user.lastName,
        phone: row.user.phone,
        expirationDate: expirationDateOf(row.rawDecision),
        decidable: inReview && isLatest,
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
