/**
 * Contrato de la cola de revisión de KYC del panel (`/kyc`). La implementa `svc-users` (dueño de
 * `users.kyc_verification`) y la expone `svc-admin`. La cola muestra SOLO los intentos en
 * `manual_review`: lo aprobado, rechazado o vencido no se lista acá (el historial de cada
 * persona vive en la ficha de usuario, `AdminKycCard`).
 *
 * Nada de lo que viaja acá es dato biométrico ni imagen del documento (AC9 de MOVO-72): solo
 * lo que ya guarda `raw_decision` redactado (motivos y vencimiento).
 */

export type AdminKycVerificationType = "identity" | "license";

export const ADMIN_KYC_REVIEW_DEFAULT_PAGE_SIZE = 20;
export const ADMIN_KYC_REVIEW_MAX_PAGE_SIZE = 50;

/** Decisión que puede tomar un admin sobre un caso en revisión. */
export type AdminKycDecision = "approved" | "rejected";

/** Largo del motivo que el admin escribe al decidir (queda en Didit y en la bitácora). */
export const ADMIN_KYC_DECISION_REASON_MIN_LENGTH = 10;
export const ADMIN_KYC_DECISION_REASON_MAX_LENGTH = 500;

/** Una fila de la cola: un intento en revisión. */
export interface AdminKycReviewRow {
  /** `session_id` de Didit: identifica el intento en todas las rutas. */
  sessionId: string;
  userId: string;
  fullName: string;
  photoUrl: string | null;
  verificationType: AdminKycVerificationType;
  /** Motivos que Didit marcó para la revisión, si se pudieron derivar. */
  reason: string | null;
  /** Cuándo se abrió la sesión de verificación en Didit. */
  requestedAt: string;
  /**
   * Cuándo pasó a revisión manual (la persona puede terminar la verificación horas después de abrir la sesión). `null` si el
   * intento ya no está en revisión: al decidirse, ese dato se reemplaza por el de la decisión.
   */
  inReviewSince: string | null;
}

/** `GET /admin/kyc/reviews`. */
export interface AdminKycReviewPage {
  items: AdminKycReviewRow[];
  page: number;
  pageSize: number;
  /** Total de casos en revisión que cumplen el filtro. */
  total: number;
}

/** Un intento previo del mismo usuario y tipo, para dar contexto al decidir. */
export interface AdminKycReviewHistoryItem {
  sessionId: string;
  status: "not_started" | "pending" | "approved" | "rejected" | "expired" | "manual_review";
  requestedAt: string;
  resolvedAt: string | null;
  reason: string | null;
}

/** `GET /admin/kyc/reviews/:sessionId`. */
export interface AdminKycReviewDetail extends AdminKycReviewRow {
  /** Estado actual del intento (ya no es `manual_review` si alguien lo decidió). */
  status: AdminKycReviewHistoryItem["status"];
  /** Cuándo se resolvió, si ya se resolvió. */
  resolvedAt: string | null;
  email: string;
  phone: string;
  /** Vencimiento del documento, si Didit lo informó. */
  expirationDate: string | null;
  /** `true` si el caso se puede decidir: sigue en `manual_review` y es el último intento del usuario. */
  decidable: boolean;
  /** Intentos anteriores del usuario para el mismo tipo, del más nuevo al más viejo. */
  history: AdminKycReviewHistoryItem[];
}

/** `POST /admin/kyc/reviews/:sessionId/decision`. */
export interface AdminKycDecisionRequest {
  decision: AdminKycDecision;
  reason: string;
}

export interface AdminKycDecisionResponse {
  sessionId: string;
  userId: string;
  verificationType: AdminKycVerificationType;
  status: AdminKycDecision;
}

/**
 * Detalle que trae Didit de una sesión (`GET /admin/kyc/reviews/:sessionId/evidence`). Se pide a Didit **cada vez que se abre
 * el caso y no se guarda en Movo**: ni los datos del documento ni las imágenes (AC9 de MOVO-72). Las imágenes son links
 * temporales de Didit que vencen a los 60 minutos. Todo campo que Didit no informa viaja en `null`.
 */
export interface AdminKycEvidence {
  fetchedAt: string;
  /** Hasta cuándo sirven los links de las imágenes. */
  imagesExpireAt: string;
  /** Estado que Didit tiene hoy para la sesión (vocabulario de Didit: "In Review", "Approved"…). */
  sessionStatus: string | null;
  images: AdminKycEvidenceImages;
  document: AdminKycEvidenceDocument | null;
  faceMatch: { status: string | null; score: number | null } | null;
  liveness: { status: string | null; method: string | null; score: number | null } | null;
  ip: AdminKycEvidenceIp | null;
  aml: { status: string | null; totalHits: number | null; score: number | null } | null;
  phone: AdminKycEvidenceContact | null;
  email: AdminKycEvidenceContact | null;
  /** Todas las alertas de todas las verificaciones de la sesión, con el feature de origen. */
  warnings: AdminKycEvidenceWarning[];
  /** Revisiones que ya hizo el equipo de Didit sobre esta sesión (sin quién las hizo). */
  reviews: AdminKycEvidenceReview[];
}

export interface AdminKycEvidenceImages {
  /** Selfie de la verificación (la de la prueba de vida). */
  selfie: string | null;
  /** Foto del rostro recortada del documento. */
  documentPortrait: string | null;
  documentFront: string | null;
  documentBack: string | null;
  /** Video de la prueba de vida activa, si la hubo. */
  livenessVideo: string | null;
}

export interface AdminKycEvidenceDocument {
  status: string | null;
  type: string | null;
  number: string | null;
  personalNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  dateOfBirth: string | null;
  age: number | null;
  gender: string | null;
  nationality: string | null;
  issuingCountry: string | null;
  issueDate: string | null;
  expirationDate: string | null;
  address: string | null;
  placeOfBirth: string | null;
  maritalStatus: string | null;
}

export interface AdminKycEvidenceIp {
  status: string | null;
  address: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  isVpnOrTor: boolean | null;
  isDataCenter: boolean | null;
  platform: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
}

export interface AdminKycEvidenceContact {
  status: string | null;
  /** Teléfono o email que verificó Didit. */
  value: string | null;
  country: string | null;
  isDisposable: boolean | null;
  isVirtual: boolean | null;
}

export interface AdminKycEvidenceWarning {
  /** De dónde viene: `ID_VERIFICATION`, `FACE_MATCH`, `LIVENESS`, `IP_ANALYSIS`… */
  feature: string;
  risk: string;
  description: string;
}

export interface AdminKycEvidenceReview {
  /** Estado al que llevó la revisión. */
  status: string | null;
  comment: string | null;
  createdAt: string | null;
}

