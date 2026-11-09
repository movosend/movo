import "server-only"
import { cache } from "react"
import { cookies } from "next/headers"
import type {
  AdminKycDecisionRequest,
  AdminKycDecisionResponse,
  AdminKycEvidence,
  AdminKycReviewDetail,
  AdminKycReviewPage,
  AdminKycVerificationType,
} from "@movo/shared/src/types/admin-kyc"
import { gateway } from "@/lib/auth/api"
import { ACCESS_COOKIE } from "@/lib/auth/policy"
import {
  mockDecideKycReview,
  mockEnabled,
  mockGetKycEvidence,
  mockGetKycReview,
  mockListKycReviews,
} from "./mock"

export const KYC_PAGE_SIZE = 20
/** Decidir espera a Didit: más margen que el de una lectura (el tope de `svc-admin` hacia `svc-users` es 15 s). */
const DECISION_TIMEOUT_MS = 25_000
/** El detalle espera la decisión completa de Didit (el tope de `svc-admin` hacia `svc-users` es 15 s). */
const EVIDENCE_TIMEOUT_MS = 20_000

const token = async () => (await cookies()).get(ACCESS_COOKIE)?.value
const path = (sessionId: string) =>
  `/admin/kyc/reviews/${encodeURIComponent(sessionId)}`

/** `GET /admin/kyc/reviews`: solo los casos que necesitan revisión manual. */
export async function listKycReviews(input: {
  q: string
  type?: AdminKycVerificationType
  page: number
}): Promise<AdminKycReviewPage> {
  if (mockEnabled()) return mockListKycReviews(input)
  const query = new URLSearchParams({
    page: String(input.page),
    pageSize: String(KYC_PAGE_SIZE),
  })
  if (input.q) query.set("q", input.q)
  if (input.type) query.set("type", input.type)
  return gateway<AdminKycReviewPage>(`/admin/kyc/reviews?${query}`, {
    accessToken: await token(),
  })
}

/** `GET /admin/kyc/reviews/:sessionId`. */
export async function getKycReview(
  sessionId: string
): Promise<AdminKycReviewDetail> {
  if (mockEnabled()) return mockGetKycReview(sessionId)
  return gateway<AdminKycReviewDetail>(path(sessionId), {
    accessToken: await token(),
  })
}

/**
 * `GET /admin/kyc/reviews/:sessionId/evidence`: lo que tiene Didit de la sesión (datos del documento, puntuaciones, IP, alertas
 * e imágenes). Se pide cada vez y no se guarda; las imágenes son links temporales de 60 minutos. Didit tarda más que una lectura.
 */
// `cache`: la foto de la cabecera, las cifras y las secciones del caso lo piden por separado (cada una en su Suspense);
// así comparten una sola llamada a Didit por render.
export const getKycEvidence = cache(
  async (sessionId: string): Promise<AdminKycEvidence> => {
    if (mockEnabled()) return mockGetKycEvidence(sessionId)
    return gateway<AdminKycEvidence>(`${path(sessionId)}/evidence`, {
      accessToken: await token(),
      timeoutMs: EVIDENCE_TIMEOUT_MS,
    })
  }
)

/** `POST /admin/kyc/reviews/:sessionId/decision`. Escritura: sin reintento automático. */
export async function decideKycReview(
  sessionId: string,
  body: AdminKycDecisionRequest
): Promise<AdminKycDecisionResponse> {
  if (mockEnabled()) return mockDecideKycReview(sessionId, body)
  return gateway<AdminKycDecisionResponse>(`${path(sessionId)}/decision`, {
    body,
    accessToken: await token(),
    timeoutMs: DECISION_TIMEOUT_MS,
  })
}
