import { LEGAL_DOCUMENT_VERSIONS } from "@movo/shared/dist/config/legal";
import type { PrivateProfile } from "@movo/shared/dist/types/user-profile";

export type LegalDocumentKind = "terms" | "privacy";

export type LegalAcceptanceStatus = "up_to_date" | "pending" | "update_required";

export interface LegalDocumentAcceptanceState {
  status: LegalAcceptanceStatus;
  acceptedAt: string | null;
  version: string | null;
  currentVersion: string;
}

/** Rediseño MOVO-229 (Claude Design "Rediseño página Legal con estados de firma") —
 * a diferencia de la primera pasada (`isCurrent` binario), acá "pendiente porque
 * nunca se aceptó nada" y "pendiente porque la versión aceptada quedó vieja" son
 * estados distintos con copy propio (`legalAcceptanceMeta`) — ver `metaFor` del
 * prototipo. */
function acceptanceState(
  acceptedAt: string | null | undefined,
  version: string | null | undefined,
  currentVersion: string,
): LegalDocumentAcceptanceState {
  let status: LegalAcceptanceStatus;
  if (!acceptedAt || !version) status = "pending";
  else if (version !== currentVersion) status = "update_required";
  else status = "up_to_date";
  return { status, acceptedAt: acceptedAt ?? null, version: version ?? null, currentVersion };
}

/** MOVO-229: `profile` `undefined` (perfil sin cargar todavía) se trata igual que
 * "pendiente" — nunca se afirma que algo está aceptado sin el dato real. */
export function getTermsAcceptanceState(profile: PrivateProfile | undefined): LegalDocumentAcceptanceState {
  return acceptanceState(profile?.termsAcceptedAt, profile?.termsVersion, LEGAL_DOCUMENT_VERSIONS.terms);
}

export function getPrivacyAcceptanceState(profile: PrivateProfile | undefined): LegalDocumentAcceptanceState {
  return acceptanceState(profile?.privacyAcceptedAt, profile?.privacyVersion, LEGAL_DOCUMENT_VERSIONS.privacy);
}

export function getAcceptanceState(kind: LegalDocumentKind, profile: PrivateProfile | undefined): LegalDocumentAcceptanceState {
  return kind === "terms" ? getTermsAcceptanceState(profile) : getPrivacyAcceptanceState(profile);
}

/** `true` si CUALQUIERA de los dos documentos está pendiente — es lo que dispara el
 * sheet de entrada al abrir la app y la insignia del hub de Legal. */
export function hasPendingLegalAcceptance(profile: PrivateProfile | undefined): boolean {
  return getTermsAcceptanceState(profile).status !== "up_to_date" || getPrivacyAcceptanceState(profile).status !== "up_to_date";
}

const ACCEPTANCE_DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" });

export function formatAcceptanceDate(iso: string): string {
  return ACCEPTANCE_DATE_FORMATTER.format(new Date(iso));
}

export interface LegalAcceptanceMeta {
  badgeLabel: string;
  badgeTone: "success" | "warning";
  signatureText: string;
  signatureTone: "muted" | "warning";
  /** Botón del hub: relleno oscuro ("Leer y aceptar"/"Revisar y aceptar") si hay algo
   * pendiente, o outline ("Ver documento") si ya está al día. */
  cardCtaLabel: string;
  cardCtaFilled: boolean;
  /** Botón del sheet de lectura — solo relevante si `status !== "up_to_date"`. */
  acceptButtonLabel: string;
}

/** Espejo de `metaFor()` del prototipo — una función pura por estado, sin lógica de
 * negocio nueva, solo el mapeo texto/tono ya decidido en el diseño. */
export function legalAcceptanceMeta(state: LegalDocumentAcceptanceState): LegalAcceptanceMeta {
  if (state.status === "up_to_date") {
    return {
      badgeLabel: "Al día",
      badgeTone: "success",
      signatureText: `Aceptaste el ${formatAcceptanceDate(state.acceptedAt as string)} · ${state.version}`,
      signatureTone: "muted",
      cardCtaLabel: "Ver documento",
      cardCtaFilled: false,
      acceptButtonLabel: "",
    };
  }
  if (state.status === "pending") {
    return {
      badgeLabel: "Pendiente",
      badgeTone: "warning",
      signatureText: "Sin registro — pendiente de aceptar",
      signatureTone: "warning",
      cardCtaLabel: "Leer y aceptar",
      cardCtaFilled: true,
      acceptButtonLabel: "Acepto",
    };
  }
  return {
    badgeLabel: "Nueva versión",
    badgeTone: "warning",
    signatureText: `Aceptaste ${state.version} el ${formatAcceptanceDate(state.acceptedAt as string)} — hay ${state.currentVersion} disponible`,
    signatureTone: "warning",
    cardCtaLabel: "Revisar y aceptar",
    cardCtaFilled: true,
    acceptButtonLabel: "Acepto la versión nueva",
  };
}

export interface LegalEntrySheetCopy {
  title: string;
  body: string;
}

/** Espejo de `sheetCopy()` del prototipo. Distingue "nunca aceptaste nada" (copy de
 * onboarding, "Antes de empezar") de "cambiamos algo que ya habías aceptado" (copy
 * de actualización) — mismo criterio que separa `pending` de `update_required`. */
export function legalEntrySheetCopy(
  terms: LegalDocumentAcceptanceState,
  privacy: LegalDocumentAcceptanceState,
): LegalEntrySheetCopy {
  const names: string[] = [];
  if (terms.status !== "up_to_date") names.push("los Términos y Condiciones");
  if (privacy.status !== "up_to_date") names.push("la Política de Privacidad");
  const joined = names.length === 2 ? `${names[0]} y ${names[1]}` : (names[0] ?? "");

  const anyPending = terms.status === "pending" || privacy.status === "pending";
  const anyUpdateRequired = terms.status === "update_required" || privacy.status === "update_required";

  if (anyPending && !anyUpdateRequired) {
    return { title: "Antes de empezar", body: `Todavía no aceptaste ${joined}. Los necesitás para usar Movo.` };
  }
  return {
    title: "Actualizamos nuestros documentos legales",
    body: `Cambiamos ${joined}. Para seguir usando Movo, tenés que leerlos y aceptarlos de nuevo.`,
  };
}

/** Referencias cruzadas entre los dos documentos ("Ver también: [Política de
 * Privacidad](./politica-privacidad.md)") — usado por `use-legal-document-links.ts`
 * para resolverlas sin acoplarse a rutas concretas (el sheet del hub las resuelve
 * cambiando de documento in place; las pantallas de `(auth)` navegan a la pantalla
 * hermana). */
export const CROSS_DOCUMENT_KIND: Record<string, LegalDocumentKind> = {
  "./politica-privacidad.md": "privacy",
  "./terminos-y-condiciones.md": "terms",
};

export const LEGAL_DOCUMENT_TITLES: Record<LegalDocumentKind, string> = {
  terms: "Términos y Condiciones",
  privacy: "Política de Privacidad",
};
