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

const SHORT_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

/**
 * Fecha de cada envío del historial de un reporte (MOVO-256): "Hoy 18:54" si es de
 * hoy, "26 sept" si es de este año y "26 sept 2025" si no. Hora local del dispositivo.
 */
export function formatReportTimestamp(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const sameDay =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) {
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `Hoy ${hh}:${mm}`;
  }
  const dayMonth = `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? dayMonth : `${dayMonth} ${date.getFullYear()}`;
}
