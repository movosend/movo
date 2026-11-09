import { describe, expect, it } from "vitest";
import { buildKycEvidence, KYC_IMAGE_TTL_MS } from "../src/modules/kyc/kyc-evidence";

const NOW = new Date("2026-11-09T12:00:00.000Z");

/** Decisión de Didit con la forma que documenta su API (solo `front_image` está confirmado contra un payload real). */
const decision = () => ({
  session_id: "sess-1",
  status: "In Review",
  id_verifications: [
    {
      status: "In Review",
      document_type: "Driver's License",
      document_number: "45346504",
      personal_number: "20453465048",
      first_name: "Lucas",
      last_name: "Dalmagro",
      full_name: "Lucas Dalmagro",
      date_of_birth: "2004-02-26",
      age: 22,
      gender: "M",
      nationality: "ARG",
      issuing_state: "ARG",
      issuing_state_name: "Argentina",
      date_of_issue: "2024-12-02",
      expiration_date: "2029-12-02",
      address: "Calle 1",
      formatted_address: "Calle 1, Córdoba, Argentina",
      place_of_birth: "Córdoba",
      marital_status: "Single",
      front_image: "https://didit.test/front.jpg?sig=abc",
      back_image: "https://didit.test/back.jpg?sig=abc",
      portrait_image: "https://didit.test/portrait.jpg?sig=abc",
      mrz: { surname: "NO DEBE SALIR" },
      extra_fields: { secreto: "NO DEBE SALIR" },
      warnings: [{ feature: "ID_VERIFICATION", risk: "DOCUMENT_EXPIRED", short_description: "Document expired", long_description: "texto largo" }],
    },
  ],
  liveness_checks: [{ status: "Approved", method: "PASSIVE", score: 100, reference_image: "https://didit.test/selfie.jpg?sig=abc", video_url: null, warnings: [] }],
  face_matches: [{ status: "Approved", score: 97.4, source_image: "https://didit.test/source.jpg", target_image: "https://didit.test/target.jpg", warnings: [] }],
  ip_analyses: [
    { status: "Approved", ip_address: "190.1.2.3", ip_country: "Argentina", ip_state: "Córdoba", ip_city: "Córdoba", is_vpn_or_tor: false, is_data_center: false, platform: "mobile", browser_family: "Chrome", os_family: "Android", device_brand: "Samsung", device_model: "A54", warnings: [] },
  ],
  aml_screenings: [{ status: "Approved", total_hits: 0, score: 0, warnings: [] }],
  phone_verifications: [{ status: "Approved", phone_number_prefix: "+54", phone_number: "3511234567", country_name: "Argentina", is_disposable: false, is_virtual: false }],
  email_verifications: [{ status: "Approved", email: "lucas@example.com", is_disposable: false }],
  reviews: [{ user: "persona@didit.me", new_status: "In Review", comment: "Revisar foto", created_at: "2026-11-08T10:00:00Z" }],
});

describe("buildKycEvidence", () => {
  it("mapea documento, puntuaciones, IP, contacto, alertas y revisiones", () => {
    const evidence = buildKycEvidence(decision(), NOW);

    expect(evidence.sessionStatus).toBe("In Review");
    expect(evidence.document).toMatchObject({
      type: "Driver's License",
      number: "45346504",
      personalNumber: "20453465048",
      fullName: "Lucas Dalmagro",
      dateOfBirth: "2004-02-26",
      age: 22,
      issuingCountry: "Argentina",
      issueDate: "2024-12-02",
      expirationDate: "2029-12-02",
      address: "Calle 1, Córdoba, Argentina",
    });
    expect(evidence.faceMatch).toEqual({ status: "Approved", score: 97.4 });
    expect(evidence.liveness).toEqual({ status: "Approved", method: "PASSIVE", score: 100 });
    expect(evidence.ip).toMatchObject({ address: "190.1.2.3", country: "Argentina", city: "Córdoba", isVpnOrTor: false, device: "Samsung A54" });
    expect(evidence.aml).toEqual({ status: "Approved", totalHits: 0, score: 0 });
    expect(evidence.phone).toMatchObject({ value: "+54 3511234567", country: "Argentina", isVirtual: false });
    expect(evidence.email).toMatchObject({ value: "lucas@example.com" });
    expect(evidence.warnings).toEqual([{ feature: "ID_VERIFICATION", risk: "DOCUMENT_EXPIRED", description: "Document expired" }]);
    expect(evidence.reviews).toEqual([{ status: "In Review", comment: "Revisar foto", createdAt: "2026-11-08T10:00:00Z" }]);
  });

  it("las imágenes salen de las claves de Didit, con la selfie de la prueba de vida primero", () => {
    const { images } = buildKycEvidence(decision(), NOW);

    expect(images).toEqual({
      selfie: "https://didit.test/selfie.jpg?sig=abc",
      documentPortrait: "https://didit.test/portrait.jpg?sig=abc",
      documentFront: "https://didit.test/front.jpg?sig=abc",
      documentBack: "https://didit.test/back.jpg?sig=abc",
      livenessVideo: null,
    });
  });

  it("sin la selfie de la prueba de vida usa la del face match, y sin el retrato del documento usa el del face match", () => {
    const body = decision();
    delete (body.liveness_checks[0] as Record<string, unknown>).reference_image;
    delete (body.id_verifications[0] as Record<string, unknown>).portrait_image;

    const { images } = buildKycEvidence(body, NOW);

    expect(images.selfie).toBe("https://didit.test/source.jpg");
    expect(images.documentPortrait).toBe("https://didit.test/target.jpg");
  });

  it("solo acepta links https: base64, http y esquemas raros se descartan", () => {
    const body = decision();
    Object.assign(body.id_verifications[0] as Record<string, unknown>, {
      front_image: "data:image/png;base64,AAAA",
      back_image: "http://didit.test/back.jpg",
      portrait_image: "javascript:alert(1)",
    });
    Object.assign(body.liveness_checks[0] as Record<string, unknown>, { reference_image: "no es una url" });
    Object.assign(body.face_matches[0] as Record<string, unknown>, { source_image: "ftp://x/y", target_image: 5 });

    const { images } = buildKycEvidence(body, NOW);

    expect(images).toEqual({ selfie: null, documentPortrait: null, documentFront: null, documentBack: null, livenessVideo: null });
  });

  it("es una lista blanca: no se cuela ningún campo que no esté mapeado", () => {
    const json = JSON.stringify(buildKycEvidence(decision(), NOW));

    expect(json).not.toContain("NO DEBE SALIR");
    expect(json).not.toContain("persona@didit.me");
    expect(json).not.toContain("texto largo");
    expect(json).not.toContain("mrz");
  });

  it("un cuerpo vacío, nulo o de otra forma da todo en null y sin lanzar", () => {
    for (const body of [{}, null, undefined, "x", [], { id_verifications: "mal", liveness_checks: [1], reviews: { a: 1 } }]) {
      const evidence = buildKycEvidence(body, NOW);
      expect(evidence.document).toBeNull();
      expect(evidence.faceMatch).toBeNull();
      expect(evidence.ip).toBeNull();
      expect(evidence.warnings).toEqual([]);
      expect(evidence.reviews).toEqual([]);
      expect(evidence.images.selfie).toBeNull();
    }
  });

  it("los tipos equivocados son null (un score string no es un número)", () => {
    const body = decision();
    Object.assign(body.face_matches[0] as Record<string, unknown>, { score: "97" });
    Object.assign(body.id_verifications[0] as Record<string, unknown>, { age: "22", document_number: 123 });

    const evidence = buildKycEvidence(body, NOW);

    expect(evidence.faceMatch?.score).toBeNull();
    expect(evidence.document?.age).toBeNull();
    expect(evidence.document?.number).toBeNull();
  });

  it("los links vencen a los 60 minutos de pedirlos", () => {
    const evidence = buildKycEvidence(decision(), NOW);

    expect(evidence.fetchedAt).toBe(NOW.toISOString());
    expect(new Date(evidence.imagesExpireAt).getTime() - NOW.getTime()).toBe(KYC_IMAGE_TTL_MS);
  });
});
