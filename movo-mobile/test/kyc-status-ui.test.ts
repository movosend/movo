import { KycStatus } from "@movo/shared/dist/types/user";
import {
  kycStatusIcon,
  kycStatusLabel,
  kycStatusTone,
} from "../src/lib/kyc-status-ui";

// MOVO-78: fuente única de tono/ícono/label por estado de KYC, consumida por el banner
// de home.tsx, el resultado de kyc.tsx y el badge de perfil — este test cubre los 6
// valores del enum para que ninguno quede sin mapear silenciosamente.
describe("kyc-status-ui", () => {
  it.each([
    [KycStatus.APPROVED, "success", "Verificado"],
    [KycStatus.PENDING, "warning", "Verificación en curso"],
    [KycStatus.MANUAL_REVIEW, "warning", "En revisión"],
    [KycStatus.REJECTED, "danger", "Rechazado"],
    [KycStatus.EXPIRED, "danger", "Verificación vencida"],
    [KycStatus.NOT_STARTED, "neutral", "Sin verificar"],
  ])("%s -> tono %s, label %p", (status, tone, label) => {
    expect(kycStatusTone(status)).toBe(tone);
    expect(kycStatusLabel(status)).toBe(label);
    expect(kycStatusIcon(status)).toBeTruthy();
  });
});
