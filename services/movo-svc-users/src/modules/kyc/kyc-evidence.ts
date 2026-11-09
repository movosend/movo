import type {
  AdminKycEvidence,
  AdminKycEvidenceContact,
  AdminKycEvidenceDocument,
  AdminKycEvidenceIp,
  AdminKycEvidenceReview,
} from "@movo/shared";
import { extractDecisionWarnings } from "./kyc.service";

/** Los links de imágenes de Didit vencen a los 60 minutos (documentado en su API de decisión de sesión). */
export const KYC_IMAGE_TTL_MS = 60 * 60 * 1000;

const MAX_TEXT = 300;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
/** Primer elemento de una lista de resultados por feature (Didit trae uno por nodo del workflow). */
const firstOf = (value: unknown): Json | null => (Array.isArray(value) && isObject(value[0]) ? value[0] : null);

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, MAX_TEXT) : null;
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const bool = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);
/** Solo links `https`: una imagen en base64 o un esquema raro nunca llega al panel. */
const url = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
};
/** El primero que venga informado, para tolerar que Didit nombre distinto un mismo dato según la versión. */
const pick = <T>(...values: (T | null)[]): T | null => values.find((v) => v !== null) ?? null;

function toDocument(id: Json | null): AdminKycEvidenceDocument | null {
  if (!id) return null;
  return {
    status: str(id.status),
    type: str(id.document_type),
    number: str(id.document_number),
    personalNumber: str(id.personal_number),
    firstName: str(id.first_name),
    lastName: str(id.last_name),
    fullName: str(id.full_name),
    dateOfBirth: str(id.date_of_birth),
    age: num(id.age),
    gender: str(id.gender),
    nationality: str(id.nationality),
    issuingCountry: pick(str(id.issuing_state_name), str(id.issuing_state)),
    issueDate: str(id.date_of_issue),
    expirationDate: str(id.expiration_date),
    address: pick(str(id.formatted_address), str(id.address)),
    placeOfBirth: str(id.place_of_birth),
    maritalStatus: str(id.marital_status),
  };
}

function toIp(ip: Json | null): AdminKycEvidenceIp | null {
  if (!ip) return null;
  const device = [str(ip.device_brand), str(ip.device_model)].filter((part): part is string => part !== null).join(" ");
  return {
    status: str(ip.status),
    address: str(ip.ip_address),
    country: pick(str(ip.ip_country), str(ip.ip_country_code)),
    region: str(ip.ip_state),
    city: str(ip.ip_city),
    isVpnOrTor: bool(ip.is_vpn_or_tor),
    isDataCenter: bool(ip.is_data_center),
    platform: str(ip.platform),
    browser: str(ip.browser_family),
    os: str(ip.os_family),
    device: device || null,
  };
}

function toPhone(phone: Json | null): AdminKycEvidenceContact | null {
  if (!phone) return null;
  const prefixed = [str(phone.phone_number_prefix), str(phone.phone_number)].filter((p): p is string => p !== null).join(" ");
  return {
    status: str(phone.status),
    value: pick(str(phone.full_number), prefixed || null),
    country: pick(str(phone.country_name), str(phone.country_code)),
    isDisposable: bool(phone.is_disposable),
    isVirtual: bool(phone.is_virtual),
  };
}

function toEmail(email: Json | null): AdminKycEvidenceContact | null {
  if (!email) return null;
  return {
    status: str(email.status),
    value: str(email.email),
    country: null,
    isDisposable: bool(email.is_disposable),
    isVirtual: null,
  };
}

function toReviews(value: unknown): AdminKycEvidenceReview[] {
  if (!Array.isArray(value)) return [];
  // Sin el autor (`user`): es una persona del equipo de Didit, no un dato que el panel necesite.
  return value.filter(isObject).map((review) => ({
    status: pick(str(review.new_status), str(review.status)),
    comment: str(review.comment),
    createdAt: str(review.created_at),
  }));
}

/**
 * Arma el detalle que se muestra en el panel a partir de la decisión completa de Didit (`GET /v3/session/{id}/decision/`).
 * Es una **lista blanca**: solo pasan los campos de abajo, ya tipados, y nunca el cuerpo tal cual. No persiste nada ni loguea
 * (los links de imagen son credenciales temporales). Un campo ausente o de otro tipo es `null`, nunca un error: Didit puede
 * cambiar o no informar un dato sin que se caiga la pantalla. Los nombres de los campos de imagen y de puntuación están
 * tomados de la documentación de Didit; solo `front_image` está confirmado contra un payload real.
 */
export function buildKycEvidence(body: unknown, now: Date = new Date()): AdminKycEvidence {
  const root: Json = isObject(body) ? body : {};
  const id = firstOf(root.id_verifications);
  const liveness = firstOf(root.liveness_checks);
  const faceMatch = firstOf(root.face_matches);
  const ip = firstOf(root.ip_analyses);
  const aml = firstOf(root.aml_screenings);

  return {
    fetchedAt: now.toISOString(),
    imagesExpireAt: new Date(now.getTime() + KYC_IMAGE_TTL_MS).toISOString(),
    sessionStatus: str(root.status),
    images: {
      selfie: pick(url(liveness?.reference_image), url(faceMatch?.source_image), url(faceMatch?.user_image)),
      documentPortrait: pick(url(id?.portrait_image), url(faceMatch?.target_image), url(faceMatch?.ref_image)),
      documentFront: pick(url(id?.front_image), url(id?.full_front_image)),
      documentBack: pick(url(id?.back_image), url(id?.full_back_image)),
      livenessVideo: url(liveness?.video_url),
    },
    document: toDocument(id),
    faceMatch: faceMatch ? { status: str(faceMatch.status), score: num(faceMatch.score) } : null,
    liveness: liveness ? { status: str(liveness.status), method: str(liveness.method), score: num(liveness.score) } : null,
    ip: toIp(ip),
    aml: aml ? { status: str(aml.status), totalHits: num(aml.total_hits), score: num(aml.score) } : null,
    phone: toPhone(firstOf(root.phone_verifications)),
    email: toEmail(firstOf(root.email_verifications)),
    warnings: extractDecisionWarnings(root),
    reviews: toReviews(root.reviews),
  };
}
