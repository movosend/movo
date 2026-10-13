import { KycStatus } from "@movo/shared/dist/types/user";
import { licenseGateCopy, resolveTransportGate } from "../src/lib/carrier-requirements";

describe("resolveTransportGate", () => {
  const approved = { kycStatus: KycStatus.APPROVED, licenseKycStatus: KycStatus.APPROVED, identityRejectedByFeed: false };

  it("sin bloqueo con identidad y licencia aprobadas", () => {
    expect(resolveTransportGate(approved)).toBeNull();
  });

  it("bloquea por licencia con la identidad aprobada", () => {
    expect(resolveTransportGate({ ...approved, licenseKycStatus: KycStatus.NOT_STARTED })).toBe("license");
  });

  it("la identidad tiene prioridad sobre la licencia", () => {
    expect(
      resolveTransportGate({
        kycStatus: KycStatus.PENDING,
        licenseKycStatus: KycStatus.NOT_STARTED,
        identityRejectedByFeed: false,
      }),
    ).toBe("identity");
  });

  it("el 403 del feed bloquea por identidad aunque el perfil diga aprobado", () => {
    expect(resolveTransportGate({ ...approved, identityRejectedByFeed: true })).toBe("identity");
  });

  it("sin perfil no bloquea por licencia", () => {
    expect(
      resolveTransportGate({ kycStatus: null, licenseKycStatus: null, identityRejectedByFeed: false }),
    ).toBeNull();
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
