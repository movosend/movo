import { ApiError } from "@movo/shared/dist/errors/api-error";
import { KycStatus } from "@movo/shared/dist/types/user";
import {
  carrierRequirementsFromError,
  licenseGateCopy,
  licenseRowCopy,
  mpRowCopy,
  resolveTransportGate,
} from "../src/lib/carrier-requirements";

describe("resolveTransportGate", () => {
  const approved = { kycStatus: KycStatus.APPROVED, licenseKycStatus: KycStatus.APPROVED, mpStatus: "linked" as const };

  it("sin bloqueo con identidad, licencia y Mercado Pago", () => {
    expect(resolveTransportGate(approved)).toBeNull();
  });

  it("bloquea por licencia con la identidad aprobada", () => {
    expect(resolveTransportGate({ ...approved, licenseKycStatus: KycStatus.NOT_STARTED })).toEqual(["license"]);
  });

  it.each(["unlinked", "invalid"] as const)("bloquea por Mercado Pago %s", (mpStatus) => {
    expect(resolveTransportGate({ ...approved, mpStatus })).toEqual(["mp_account"]);
  });

  it("devuelve todo lo que falta, licencia primero", () => {
    expect(
      resolveTransportGate({ ...approved, licenseKycStatus: KycStatus.MANUAL_REVIEW, mpStatus: "unlinked" }),
    ).toEqual(["license", "mp_account"]);
  });

  it("la identidad tiene prioridad sobre licencia y Mercado Pago", () => {
    expect(
      resolveTransportGate({
        kycStatus: KycStatus.PENDING,
        licenseKycStatus: KycStatus.NOT_STARTED,
        mpStatus: "unlinked",
      }),
    ).toBe("identity");
  });

  it("sin perfil ni estado de Mercado Pago todavía no bloquea", () => {
    expect(resolveTransportGate({ kycStatus: null, licenseKycStatus: null, mpStatus: null })).toBeNull();
    expect(resolveTransportGate({ kycStatus: null, licenseKycStatus: null })).toBeNull();
  });
});

describe("carrierRequirementsFromError", () => {
  it("MOVO-278: una disputa abierta no abre la checklist, aunque también falten otros requisitos", () => {
    const error = new ApiError(403, "CARRIER_DISPUTE_OPEN", "x", {
      missingRequirements: ["no_open_dispute", "license"],
    });
    expect(carrierRequirementsFromError(error)).toBeNull();
  });

  it("MOVO-278: un code de licencia que trae la disputa en details solo lista los pasos de la checklist", () => {
    const error = new ApiError(403, "CARRIER_LICENSE_NOT_APPROVED", "x", {
      missingRequirements: ["license", "no_open_dispute"],
    });
    expect(carrierRequirementsFromError(error)).toEqual(["license"]);
  });

  it("lee todos los faltantes de details.missingRequirements, en el orden de la checklist", () => {
    const error = new ApiError(403, "CARRIER_LICENSE_NOT_APPROVED", "x", {
      missingRequirements: ["mp_account", "license"],
    });
    expect(carrierRequirementsFromError(error)).toEqual(["license", "mp_account"]);
  });

  it("sin details deduce el requisito del code", () => {
    expect(carrierRequirementsFromError(new ApiError(403, "CARRIER_LICENSE_NOT_APPROVED", "x"))).toEqual(["license"]);
    expect(carrierRequirementsFromError(new ApiError(403, "CARRIER_MP_ACCOUNT_NOT_LINKED", "x"))).toEqual([
      "mp_account",
    ]);
  });

  it("ignora valores desconocidos en details", () => {
    const error = new ApiError(403, "CARRIER_MP_ACCOUNT_NOT_LINKED", "x", { missingRequirements: ["otra_cosa"] });
    expect(carrierRequirementsFromError(error)).toEqual(["mp_account"]);
  });

  it("decide por code, no por status HTTP", () => {
    expect(carrierRequirementsFromError(new ApiError(409, "CARRIER_MP_ACCOUNT_NOT_LINKED", "x"))).toEqual([
      "mp_account",
    ]);
  });

  it.each([
    new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "x"),
    new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "x"),
    new ApiError(403, "CARRIER_NOT_VERIFIED", "x"),
    new Error("boom"),
    null,
  ])("%p no es un requisito", (error) => {
    expect(carrierRequirementsFromError(error)).toBeNull();
  });
});

describe("licenseRowCopy / mpRowCopy (filas de la checklist)", () => {
  it("licencia aprobada: Listo y sin CTA", () => {
    expect(licenseRowCopy(KycStatus.APPROVED)).toMatchObject({ state: "done", pillLabel: "Listo", ctaLabel: null });
  });

  it("licencia sin iniciar: textos del prototipo", () => {
    expect(licenseRowCopy(KycStatus.NOT_STARTED)).toMatchObject({
      state: "pending",
      pillLabel: "Pendiente",
      body: "Verificamos que puedas manejar el vehículo con el que viajás.",
      ctaLabel: "Verificar mi licencia",
    });
  });

  it("licencia en revisión: pill 'En revisión' y CTA 'Ver estado'", () => {
    expect(licenseRowCopy(KycStatus.MANUAL_REVIEW)).toMatchObject({
      state: "review",
      pillLabel: "En revisión",
      ctaLabel: "Ver estado",
    });
  });

  it("licencia sin terminar ofrece continuar; rechazada y vencida, verificar de nuevo", () => {
    expect(licenseRowCopy(KycStatus.PENDING).ctaLabel).toBe("Continuar verificación");
    expect(licenseRowCopy(KycStatus.REJECTED).ctaLabel).toBe("Verificar mi licencia");
    expect(licenseRowCopy(KycStatus.EXPIRED).body).toBe(licenseGateCopy(KycStatus.EXPIRED).body);
  });

  it("Mercado Pago vinculada: Listo y sin CTA", () => {
    expect(mpRowCopy("linked")).toMatchObject({
      state: "done",
      body: "Vinculada. Tus cobros van a esa cuenta.",
      ctaLabel: null,
    });
  });

  it("Mercado Pago sin vincular: textos del prototipo", () => {
    expect(mpRowCopy("unlinked")).toMatchObject({
      state: "pending",
      body: "Ahí te acreditamos lo que cobrás por cada envío.",
      ctaLabel: "Vincular Mercado Pago",
    });
  });

  it("Mercado Pago inválida explica que dejó de estar vigente", () => {
    expect(mpRowCopy("invalid").body).toContain("dejó de estar vigente");
    expect(mpRowCopy("invalid").ctaLabel).toBe("Vincular Mercado Pago");
  });
});

describe("licenseGateCopy", () => {
  it.each([KycStatus.NOT_STARTED, KycStatus.PENDING, KycStatus.REJECTED, KycStatus.EXPIRED])(
    "%s usa el título del ticket",
    (status) => {
      expect(licenseGateCopy(status).title).toBe("¡Verificá tu licencia para transportar paquetes!");
    },
  );

  it("en revisión no pide verificar de nuevo", () => {
    const copy = licenseGateCopy(KycStatus.MANUAL_REVIEW);
    expect(copy.title).toBe("Estamos revisando tu licencia");
    expect(copy.ctaLabel).toBe("Ver estado");
  });

  it("sin iniciar ofrece 'Verificar licencia'", () => {
    expect(licenseGateCopy(KycStatus.NOT_STARTED).ctaLabel).toBe("Verificar licencia");
  });
});
