import { LEGAL_DOCUMENT_VERSIONS } from "@movo/shared/dist/config/legal";
import type { PrivateProfile } from "@movo/shared/dist/types/user-profile";
import {
  getPrivacyAcceptanceState,
  getTermsAcceptanceState,
  hasPendingLegalAcceptance,
  legalAcceptanceMeta,
  legalEntrySheetCopy,
} from "../src/lib/legal-acceptance";

// Mediodía UTC, no medianoche: evita que el formateo en una zona horaria detrás de
// UTC (ej. Argentina, UTC-3) haga caer la fecha formateada un día antes.
function profile(overrides: Partial<PrivateProfile> = {}): PrivateProfile {
  return {
    termsAcceptedAt: "2026-01-01T12:00:00.000Z",
    termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
    privacyAcceptedAt: "2026-01-01T12:00:00.000Z",
    privacyVersion: LEGAL_DOCUMENT_VERSIONS.privacy,
    ...overrides,
  } as PrivateProfile;
}

describe("legal-acceptance: estado por documento", () => {
  it("trata un perfil undefined (todavía sin cargar) como pendiente, nunca como aceptado", () => {
    expect(getTermsAcceptanceState(undefined).status).toBe("pending");
    expect(getPrivacyAcceptanceState(undefined).status).toBe("pending");
    expect(hasPendingLegalAcceptance(undefined)).toBe(true);
  });

  it("es 'up_to_date' cuando la fecha existe y la versión coincide con la vigente", () => {
    const state = getTermsAcceptanceState(profile());

    expect(state.status).toBe("up_to_date");
    expect(state.version).toBe(LEGAL_DOCUMENT_VERSIONS.terms);
  });

  it("es 'update_required' (no 'pending') si ya se aceptó una versión vieja", () => {
    const state = getTermsAcceptanceState(profile({ termsVersion: "2020-01-01" }));

    expect(state.status).toBe("update_required");
    expect(state.acceptedAt).toBe("2026-01-01T12:00:00.000Z");
    expect(state.version).toBe("2020-01-01");
  });

  it("es 'pending' sin fecha, aunque la versión sea null", () => {
    const state = getPrivacyAcceptanceState(profile({ privacyAcceptedAt: null, privacyVersion: null }));

    expect(state.status).toBe("pending");
    expect(state.acceptedAt).toBeNull();
    expect(state.version).toBeNull();
  });

  it("hasPendingLegalAcceptance es true si CUALQUIERA de los dos no está 'up_to_date'", () => {
    expect(hasPendingLegalAcceptance(profile())).toBe(false);
    expect(hasPendingLegalAcceptance(profile({ termsVersion: "2020-01-01" }))).toBe(true);
    expect(hasPendingLegalAcceptance(profile({ privacyVersion: "2020-01-01" }))).toBe(true);
    expect(
      hasPendingLegalAcceptance(profile({ termsAcceptedAt: null, termsVersion: null })),
    ).toBe(true);
  });
});

describe("legalAcceptanceMeta", () => {
  it("up_to_date: badge de éxito, firma con fecha real, CTA outline 'Ver documento'", () => {
    const state = getTermsAcceptanceState(profile());
    const meta = legalAcceptanceMeta(state);

    expect(meta.badgeLabel).toBe("Al día");
    expect(meta.badgeTone).toBe("success");
    expect(meta.signatureText).toMatch(/1 de ene de 2026/);
    expect(meta.cardCtaLabel).toBe("Ver documento");
    expect(meta.cardCtaFilled).toBe(false);
  });

  it("pending: badge de advertencia, 'Sin registro', CTA relleno 'Leer y aceptar'", () => {
    const state = getPrivacyAcceptanceState(profile({ privacyAcceptedAt: null, privacyVersion: null }));
    const meta = legalAcceptanceMeta(state);

    expect(meta.badgeLabel).toBe("Pendiente");
    expect(meta.badgeTone).toBe("warning");
    expect(meta.signatureText).toMatch(/sin registro/i);
    expect(meta.cardCtaLabel).toBe("Leer y aceptar");
    expect(meta.cardCtaFilled).toBe(true);
    expect(meta.acceptButtonLabel).toBe("Acepto");
  });

  it("update_required: menciona versión vieja y nueva, CTA 'Revisar y aceptar'", () => {
    const state = getTermsAcceptanceState(profile({ termsVersion: "2020-01-01" }));
    const meta = legalAcceptanceMeta(state);

    expect(meta.badgeLabel).toBe("Nueva versión");
    expect(meta.signatureText).toMatch(/2020-01-01/);
    expect(meta.signatureText).toMatch(new RegExp(LEGAL_DOCUMENT_VERSIONS.terms));
    expect(meta.cardCtaLabel).toBe("Revisar y aceptar");
    expect(meta.acceptButtonLabel).toBe("Acepto la versión nueva");
  });
});

describe("legalEntrySheetCopy", () => {
  it("copy de onboarding cuando nunca se aceptó nada (sin ninguna versión vieja de por medio)", () => {
    const terms = getTermsAcceptanceState(profile({ termsAcceptedAt: null, termsVersion: null }));
    const privacy = getPrivacyAcceptanceState(profile());

    const copy = legalEntrySheetCopy(terms, privacy);

    expect(copy.title).toBe("Antes de empezar");
    expect(copy.body).toMatch(/términos y condiciones/i);
  });

  it("copy de actualización cuando hay al menos una versión vieja aceptada", () => {
    const terms = getTermsAcceptanceState(profile({ termsVersion: "2020-01-01" }));
    const privacy = getPrivacyAcceptanceState(profile());

    const copy = legalEntrySheetCopy(terms, privacy);

    expect(copy.title).toMatch(/actualizamos/i);
  });

  it("menciona los dos documentos si ambos están pendientes", () => {
    const terms = getTermsAcceptanceState(profile({ termsAcceptedAt: null, termsVersion: null }));
    const privacy = getPrivacyAcceptanceState(profile({ privacyAcceptedAt: null, privacyVersion: null }));

    const copy = legalEntrySheetCopy(terms, privacy);

    expect(copy.body).toMatch(/términos y condiciones/i);
    expect(copy.body).toMatch(/política de privacidad/i);
  });
});
