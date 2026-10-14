import type { ImageSourcePropType } from "react-native";
import { normalizeSearchText } from "../data/vehicle-catalog";

/**
 * Logos de bancos para las tarjetas guardadas (MOVO-101), en `assets/bank-logos/`: los
 * íconos de las apps oficiales de cada banco en el App Store (512 px, bajados a 256), que
 * son isotipos cuadrados nítidos a los tamaños en que se muestran. Mismo patrón que `vehicle-brand-icons.ts`: Metro no
 * soporta `require()` dinámico, así que cada logo tiene su línea. Sin entrada, `BankLogo`
 * cae a las iniciales del banco (como el prototipo), nunca rompe.
 */
const BANK_LOGOS: Record<string, ImageSourcePropType> = {
  bancor: require("../../assets/bank-logos/bancor.png"),
  bbva: require("../../assets/bank-logos/bbva.png"),
  bpn: require("../../assets/bank-logos/bpn.png"),
  brubank: require("../../assets/bank-logos/brubank.png"),
  ciudad: require("../../assets/bank-logos/ciudad.png"),
  comafi: require("../../assets/bank-logos/comafi.png"),
  corrientes: require("../../assets/bank-logos/corrientes.png"),
  credicoop: require("../../assets/bank-logos/credicoop.png"),
  galicia: require("../../assets/bank-logos/galicia.png"),
  hipotecario: require("../../assets/bank-logos/hipotecario.png"),
  macro: require("../../assets/bank-logos/macro.png"),
  "mercado-pago": require("../../assets/bank-logos/mercado-pago.png"),
  nacion: require("../../assets/bank-logos/nacion.png"),
  "naranja-x": require("../../assets/bank-logos/naranja-x.png"),
  "personal-pay": require("../../assets/bank-logos/personal-pay.png"),
  provincia: require("../../assets/bank-logos/provincia.png"),
  santander: require("../../assets/bank-logos/santander.png"),
  supervielle: require("../../assets/bank-logos/supervielle.png"),
  uala: require("../../assets/bank-logos/uala.png"),
};

/**
 * Patrones del `issuer.name` de MP, en orden: el primero que encaja gana. Van por palabra
 * completa (`\b`) y, donde la palabra sola es ambigua, con la frase: "nacion" a secas
 * encajaba dentro de "Internacional" y "provincia" en "Banco Provincia de Tierra del Fuego".
 * "Neuquén" va antes que "provincia" porque el BPN es "Banco Provincia del Neuquén".
 */
const ISSUER_PATTERNS: [RegExp, string][] = [
  [/\bneuquen\b/, "bpn"],
  [/\bbpn\b/, "bpn"],
  [/\bgalicia\b/, "galicia"],
  [/\bsantander\b/, "santander"],
  [/\bbbva\b/, "bbva"],
  [/\bfrances\b/, "bbva"],
  [/\bbanco (de la )?nacion\b/, "nacion"],
  [/\bmacro\b/, "macro"],
  [/\bbanco (de la )?ciudad\b/, "ciudad"],
  [/\bcredicoop\b/, "credicoop"],
  [/\bhipotecario\b/, "hipotecario"],
  [/\bsupervielle\b/, "supervielle"],
  [/\bcomafi\b/, "comafi"],
  [/\bcordoba\b/, "bancor"],
  [/\bbancor\b/, "bancor"],
  [/\bbanco de corrientes\b/, "corrientes"],
  [/\bbrubank\b/, "brubank"],
  [/\bnaranja\b/, "naranja-x"],
  [/\bmercado ?pago\b/, "mercado-pago"],
  [/\bpersonal pay\b/, "personal-pay"],
  [/\buala\b/, "uala"],
  [/\bprovincia de buenos aires\b/, "provincia"],
  [/^banco provincia$/, "provincia"],
  [/\bbapro\b/, "provincia"],
];

/** Slug del logo para el `issuer.name` de MP, o `null` si no hay logo para ese banco. */
export function bankSlugFromIssuer(issuerName: string | null | undefined): string | null {
  if (!issuerName) return null;
  const normalized = normalizeSearchText(issuerName).trim();
  const match = ISSUER_PATTERNS.find(([pattern]) => pattern.test(normalized));
  return match ? match[1] : null;
}

export function bankLogoFor(issuerName: string | null | undefined): ImageSourcePropType | null {
  const slug = bankSlugFromIssuer(issuerName);
  return slug ? BANK_LOGOS[slug] : null;
}
