import { ApiError } from "@movo/shared/src/errors/api-error"
import type {
  AdminKycDecisionRequest,
  AdminKycDecisionResponse,
  AdminKycEvidence,
  AdminKycReviewDetail,
  AdminKycReviewPage,
  AdminKycVerificationType,
} from "@movo/shared/src/types/admin-kyc"
import { SEEDS } from "@/lib/users/fixtures"
import { mockEnabled } from "@/lib/users/mock"

export { mockEnabled }

/**
 * Fixtures de la cola de KYC (solo con `MOVO_ADMIN_MOCK=1`, mismo criterio que Usuarios y Soporte). El estado vive en memoria
 * del proceso: decidir un caso lo saca de la cola, y reiniciar el servidor lo repone. `MOVO_ADMIN_MOCK_FAIL=kycdecide` hace
 * que la primera decisión falle como un rechazo de Didit (502 `KYC_PROVIDER_ERROR`, reintentable); `kycdecide!` siempre.
 */
const DAY = 86_400_000
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const latency = () => {
  const n = Number(process.env.MOVO_ADMIN_MOCK_LATENCY_MS)
  return Number.isFinite(n) && n >= 0 ? n : 350
}

type Spec = {
  daysAgo: number
  type: AdminKycVerificationType
  reason: string | null
  expires: string | null
  history?: AdminKycReviewDetail["history"]
}
const SPECS: Spec[] = [
  { daysAgo: 6, type: "identity", reason: "Documento ilegible o borroso", expires: "2031-04-12" },
  { daysAgo: 4, type: "license", reason: "La foto del carnet parece una captura de pantalla", expires: "2027-09-30" },
  { daysAgo: 3, type: "identity", reason: "La selfie no coincide con la foto del documento; Documento con posible reflejo", expires: "2029-11-05" },
  { daysAgo: 2, type: "license", reason: "Carnet vencido hace menos de 30 días", expires: "2026-10-20" },
  { daysAgo: 1, type: "identity", reason: null, expires: null },
  { daysAgo: 0, type: "identity", reason: "El nombre del documento no coincide con el de la cuenta", expires: "2030-02-18" },
]

const globalState = globalThis as unknown as {
  __movoKycMock?: { reviews: AdminKycReviewDetail[]; failed: boolean }
}

function seed(): AdminKycReviewDetail[] {
  const now = Date.now()
  return SPECS.map((spec, i) => {
    const user = SEEDS[i + 1] ?? SEEDS[i]!
    const requestedAt = new Date(now - spec.daysAgo * DAY - i * 3_600_000).toISOString()
    return {
      sessionId: `4d1f9c2e-7a3b-4e5d-9c01-${String(100000000000 + i * 7919)}`,
      userId: user.id,
      fullName: user.name,
      photoUrl: null,
      verificationType: spec.type,
      reason: spec.reason,
      requestedAt,
      email: user.email,
      phone: user.phone,
      expirationDate: spec.expires,
      decidable: true,
      history:
        i === 2
          ? [
              {
                sessionId: "0e8a7b6c-1d2f-4a3b-8c4d-000000000001",
                status: "rejected" as const,
                requestedAt: new Date(now - 12 * DAY).toISOString(),
                resolvedAt: new Date(now - 12 * DAY + 600_000).toISOString(),
                reason: "Documento vencido",
              },
              {
                sessionId: "0e8a7b6c-1d2f-4a3b-8c4d-000000000002",
                status: "expired" as const,
                requestedAt: new Date(now - 20 * DAY).toISOString(),
                resolvedAt: null,
                reason: null,
              },
            ]
          : [],
    }
  })
}

const state = () => (globalState.__movoKycMock ??= { reviews: seed(), failed: false })

const find = (sessionId: string) => state().reviews.find((r) => r.sessionId === sessionId)

export async function mockListKycReviews(input: {
  q: string
  type?: AdminKycVerificationType
  page: number
}): Promise<AdminKycReviewPage> {
  await sleep(latency())
  const q = input.q.trim().toLowerCase()
  const open = state()
    .reviews.filter((r) => r.decidable)
    .filter((r) => !input.type || r.verificationType === input.type)
    .filter(
      (r) =>
        !q ||
        r.fullName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.sessionId === input.q.trim()
    )
    .sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : 1))
  const pageSize = 20
  const start = (input.page - 1) * pageSize
  return {
    items: open.slice(start, start + pageSize).map(
      ({ sessionId, userId, fullName, photoUrl, verificationType, reason, requestedAt }) => ({
        sessionId,
        userId,
        fullName,
        photoUrl,
        verificationType,
        reason,
        requestedAt,
      })
    ),
    page: input.page,
    pageSize,
    total: open.length,
  }
}

export async function mockGetKycReview(sessionId: string): Promise<AdminKycReviewDetail> {
  await sleep(latency())
  const review = find(sessionId)
  if (!review) throw new ApiError(404, "KYC_SESSION_NOT_FOUND", "No existe esa verificación.")
  return review
}

export async function mockDecideKycReview(
  sessionId: string,
  body: AdminKycDecisionRequest
): Promise<AdminKycDecisionResponse> {
  await sleep(latency() * 2)
  const spec = (process.env.MOVO_ADMIN_MOCK_FAIL ?? "").split(",").map((s) => s.trim())
  const s = state()
  if (spec.includes("kycdecide!") || (spec.includes("kycdecide") && !s.failed)) {
    s.failed = true
    throw new ApiError(502, "KYC_PROVIDER_ERROR", "Didit rechazó el pedido.")
  }
  const review = find(sessionId)
  if (!review) throw new ApiError(404, "KYC_SESSION_NOT_FOUND", "No existe esa verificación.")
  if (!review.decidable)
    throw new ApiError(409, "KYC_REVIEW_STATUS_CHANGED", "La verificación ya no está en revisión manual.")
  review.decidable = false
  return {
    sessionId,
    userId: review.userId,
    verificationType: review.verificationType,
    status: body.decision,
  }
}

// ---- Detalle de Didit (evidence) ----

const enc = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
/** Ilustración de un rostro: en modo simulado no hay fotos reales (las trae Didit), así se ve el marco y el tamaño. */
const face = (bg: string, skin: string, initials: string) =>
  enc(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="${bg}"/>` +
      `<ellipse cx="150" cy="420" rx="130" ry="120" fill="#5b6270"/><circle cx="150" cy="170" r="78" fill="${skin}"/>` +
      `<path d="M72 150a78 78 0 0 1 156 0c-30-34-126-34-156 0z" fill="#2a2420"/>` +
      `<text x="150" y="190" text-anchor="middle" font-family="Inter,sans-serif" font-size="34" font-weight="600" fill="#0008">${initials}</text></svg>`
  )
const card = (title: string, tint: string, side: "front" | "back") =>
  enc(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 300"><rect width="480" height="300" rx="18" fill="${tint}"/>` +
      `<rect x="0" y="0" width="480" height="54" rx="18" fill="#00000026"/><text x="24" y="35" font-family="Inter,sans-serif" font-size="20" font-weight="600" fill="#fff">${title}</text>` +
      (side === "front"
        ? `<rect x="24" y="80" width="110" height="140" rx="8" fill="#ffffff80"/>` +
          [0, 1, 2, 3, 4].map((i) => `<rect x="160" y="${88 + i * 30}" width="${250 - (i % 2) * 70}" height="12" rx="6" fill="#ffffffb0"/>`).join("")
        : `<rect x="24" y="90" width="432" height="60" rx="6" fill="#ffffff55"/><rect x="24" y="170" width="432" height="14" rx="7" fill="#ffffff90"/><rect x="24" y="196" width="320" height="14" rx="7" fill="#ffffff90"/>`) +
      `</svg>`
  )

const initialsOf = (name: string) =>
  name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()

function evidenceFor(review: AdminKycReviewDetail, i: number): AdminKycEvidence {
  const now = Date.now()
  const [first = "", ...rest] = review.fullName.split(" ")
  const last = rest.join(" ")
  const isLicense = review.verificationType === "license"
  const lowMatch = i === 2
  const expired = i === 3
  const base: AdminKycEvidence = {
    fetchedAt: new Date(now).toISOString(),
    imagesExpireAt: new Date(now + 60 * 60 * 1000).toISOString(),
    sessionStatus: "In Review",
    images: {
      selfie: face("#c9d6e8", lowMatch ? "#d9b08c" : "#e2b894", initialsOf(review.fullName)),
      documentPortrait: face("#e8e2d4", "#e2b894", initialsOf(review.fullName)),
      documentFront: card(isLicense ? "LICENCIA DE CONDUCIR · ARGENTINA" : "DOCUMENTO DE IDENTIDAD · ARGENTINA", isLicense ? "#3b7a8c" : "#4a7a5a", "front"),
      documentBack: card(isLicense ? "LICENCIA DE CONDUCIR" : "DOCUMENTO DE IDENTIDAD", isLicense ? "#2f6678" : "#3d664b", "back"),
      livenessVideo: null,
    },
    document: {
      status: expired ? "Declined" : "In Review",
      type: isLicense ? "Driver's License" : "Identity Card",
      number: String(30_000_000 + i * 1_234_567),
      personalNumber: `20${30_000_000 + i * 1_234_567}${i}`,
      firstName: first,
      lastName: last,
      fullName: review.fullName,
      dateOfBirth: `${1988 + i}-0${(i % 9) + 1}-1${i % 9}`,
      age: 38 - i,
      gender: i % 2 === 0 ? "M" : "F",
      nationality: "ARG",
      issuingCountry: "Argentina",
      issueDate: "2021-03-08",
      expirationDate: review.expirationDate,
      address: "Av. Colón 1234, Córdoba, Argentina",
      placeOfBirth: "Córdoba",
      maritalStatus: i % 2 === 0 ? "Single" : "Married",
    },
    faceMatch: { status: lowMatch ? "In Review" : "Approved", score: lowMatch ? 58.3 : 94.1 },
    liveness: { status: "Approved", method: "PASSIVE", score: 99.6 },
    ip: {
      status: "Approved",
      address: `190.${20 + i}.${100 + i}.${40 + i}`,
      country: "Argentina",
      region: "Córdoba",
      city: "Córdoba",
      isVpnOrTor: false,
      isDataCenter: false,
      platform: "mobile",
      browser: "Chrome Mobile",
      os: i % 2 === 0 ? "Android" : "iOS",
      device: i % 2 === 0 ? "Samsung Galaxy A54" : "Apple iPhone 13",
    },
    aml: { status: "Approved", totalHits: 0, score: 0 },
    phone: { status: "Approved", value: review.phone, country: "Argentina", isDisposable: false, isVirtual: false },
    email: { status: "Approved", value: review.email, country: null, isDisposable: false, isVirtual: null },
    warnings: review.reason
      ? review.reason.split("; ").map((description, n) => ({
          feature: n === 0 && lowMatch ? "FACE_MATCH" : "ID_VERIFICATION",
          risk: n === 0 && lowMatch ? "LOW_FACE_MATCH_SIMILARITY" : "DOCUMENT_QUALITY_ISSUE",
          description,
        }))
      : [],
    reviews: [],
  }
  // Un caso sin nada que mostrar: Didit no informó datos (se ve el estado vacío de cada bloque).
  if (review.reason === null)
    return {
      ...base,
      images: { selfie: base.images.selfie, documentPortrait: null, documentFront: null, documentBack: null, livenessVideo: null },
      document: null,
      faceMatch: null,
      ip: null,
      aml: null,
      phone: null,
      email: null,
    }
  if (i === 0)
    base.reviews = [{ status: "In Review", comment: "Pasó a revisión manual por baja calidad de imagen.", createdAt: new Date(now - 5 * DAY).toISOString() }]
  return base
}

export async function mockGetKycEvidence(sessionId: string): Promise<AdminKycEvidence> {
  await sleep(latency() * 3)
  const spec = (process.env.MOVO_ADMIN_MOCK_FAIL ?? "").split(",").map((s) => s.trim())
  if (spec.includes("kycevidence!")) throw new ApiError(502, "KYC_PROVIDER_ERROR", "Didit no responde.")
  if (spec.includes("kycevidence-missing!"))
    throw new ApiError(422, "KYC_EVIDENCE_NOT_FOUND", "Didit no tiene detalle de esta sesión.")
  const reviews = state().reviews
  const index = reviews.findIndex((r) => r.sessionId === sessionId)
  if (index < 0) throw new ApiError(404, "KYC_SESSION_NOT_FOUND", "No existe esa verificación.")
  return evidenceFor(reviews[index]!, index)
}

