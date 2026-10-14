import type { ImageSourcePropType } from "react-native";
import { normalizeSearchText } from "../data/vehicle-catalog";

/**
 * Logos de bancos para las tarjetas guardadas (MOVO-101), con los archivos que aportó el
 * equipo en `assets/bank-logos/`. Mismo patrón que `vehicle-brand-icons.ts`: Metro no
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
  uilo: require("../../assets/bank-logos/uilo.png"),
};

/**
 * Palabras clave del `issuer.name` de MP, en orden: la primera que aparece gana. "Neuquén"
 * va antes que "provincia" porque el BPN es "Banco Provincia del Neuquén".
 */
const ISSUER_KEYWORDS: [string, string][] = [
  ["neuquen", "bpn"],
  ["bpn", "bpn"],
  ["galicia", "galicia"],
  ["santander", "santander"],
  ["bbva", "bbva"],
  ["frances", "bbva"],
  ["nacion", "nacion"],
  ["macro", "macro"],
  ["ciudad", "ciudad"],
  ["credicoop", "credicoop"],
  ["hipotecario", "hipotecario"],
  ["supervielle", "supervielle"],
  ["comafi", "comafi"],
  ["cordoba", "bancor"],
  ["bancor", "bancor"],
  ["corrientes", "corrientes"],
  ["brubank", "brubank"],
  ["naranja", "naranja-x"],
  ["mercado pago", "mercado-pago"],
  ["mercadopago", "mercado-pago"],
  ["personal", "personal-pay"],
  ["uilo", "uilo"],
  ["provincia", "provincia"],
  ["bapro", "provincia"],
];

/** Slug del logo para el `issuer.name` de MP, o `null` si no hay logo para ese banco. */
export function bankSlugFromIssuer(issuerName: string | null | undefined): string | null {
  if (!issuerName) return null;
  const normalized = normalizeSearchText(issuerName);
  const match = ISSUER_KEYWORDS.find(([keyword]) => normalized.includes(keyword));
  return match ? match[1] : null;
}

export function bankLogoFor(issuerName: string | null | undefined): ImageSourcePropType | null {
  const slug = bankSlugFromIssuer(issuerName);
  return slug ? BANK_LOGOS[slug] : null;
}
