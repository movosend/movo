import { ReportReason } from "@movo/shared/dist/types/user";

/** Motivos de reporte (MOVO-175), en el orden en que se ofrecen en el formulario. */
export const REPORT_REASON_OPTIONS: { value: ReportReason; label: string }[] = [
  { value: ReportReason.HARASSMENT, label: "Acoso o maltrato" },
  { value: ReportReason.NO_SHOW, label: "No se presentó" },
  { value: ReportReason.DAMAGED_PACKAGE, label: "Paquete dañado" },
  { value: ReportReason.PAYMENT_ISSUE, label: "Problema con el pago" },
  { value: ReportReason.OTHER, label: "Otro motivo" },
];

export function reportReasonLabel(reason: ReportReason): string {
  return REPORT_REASON_OPTIONS.find((option) => option.value === reason)?.label ?? "Otro motivo";
}
