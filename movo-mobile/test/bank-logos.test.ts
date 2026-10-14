import { bankLogoFor, bankSlugFromIssuer } from "../src/lib/bank-logos";

describe("bank-logos (MOVO-101)", () => {
  it.each([
    ["Banco Galicia", "galicia"],
    ["Santander", "santander"],
    ["BBVA Francés", "bbva"],
    ["Banco Nación", "nacion"],
    ["Banco Macro", "macro"],
    ["Banco Provincia de Buenos Aires", "provincia"],
    ["Banco Provincia", "provincia"],
    ["Banco de la Nación Argentina", "nacion"],
    ["Banco de la Ciudad de Buenos Aires", "ciudad"],
    ["Banco Provincia del Neuquén", "bpn"],
    ["Banco Ciudad", "ciudad"],
    ["Banco Credicoop", "credicoop"],
    ["Banco Hipotecario", "hipotecario"],
    ["Banco Supervielle", "supervielle"],
    ["Banco Comafi", "comafi"],
    ["Banco de Córdoba", "bancor"],
    ["Banco de Corrientes", "corrientes"],
    ["Brubank", "brubank"],
    ["Tarjeta Naranja", "naranja-x"],
    ["Mercado Pago", "mercado-pago"],
    ["Personal Pay", "personal-pay"],
    ["Ualá", "uala"],
  ])("%s → %s", (issuer, slug) => {
    expect(bankSlugFromIssuer(issuer)).toBe(slug);
    expect(bankLogoFor(issuer)).toBeTruthy();
  });

  it("sin logo para el banco o sin banco devuelve null (se muestran las iniciales)", () => {
    expect(bankSlugFromIssuer("Banco Patagonia")).toBeNull();
    expect(bankLogoFor(null)).toBeNull();
  });

  it.each([
    "Banco Internacional",
    "Banco Provincia de Tierra del Fuego",
    "Banco Personal Empresas",
    "Banco Ciudadela",
    "Macroeconómica S.A.",
  ])("no confunde '%s' con otro banco (se matchea por palabra completa)", (issuer) => {
    expect(bankSlugFromIssuer(issuer)).toBeNull();
  });
});
