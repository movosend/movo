import type { ReactNode } from "react";
import { Text, View } from "react-native";

export interface PriceBreakdownLine {
  label: string;
  /** `null` = el monto todavía no se conoce (se muestra "—", nunca un número supuesto). */
  value: string | null;
  /** MOVO-308: `danger` pinta el monto en rojo (penalidad cobrada). */
  tone?: "danger";
  testID?: string;
}

export interface PriceBreakdownTotal {
  label: string;
  value: string;
  /** `highlight`: franja lima con el monto grande; `muted`: mismo monto sobre `bg-mute`;
   * `pending`: todavía no hay monto, solo un texto chico. */
  variant: "highlight" | "muted" | "pending";
  testID?: string;
}

interface PriceBreakdownCardProps {
  header: { label: string; value: ReactNode };
  lines: PriceBreakdownLine[];
  total: PriceBreakdownTotal;
  /** Va arriba de todo, antes del encabezado (aviso de cobro demorado). */
  banner?: ReactNode;
  /** Entre el encabezado y las líneas (estado "estamos cobrando"). */
  status?: ReactNode;
  /** Franja inferior, después del total (fecha de acreditación). */
  footer?: ReactNode;
  testID?: string;
}

/**
 * Desglose "Cómo se reparte" (MOVO-186): el monto que paga el emisor, lo que se descuenta
 * y lo que queda. Lo usan el detalle de una oferta (`carrier/offers/[id].tsx`) y el detalle
 * del pago de un envío entregado (MOVO-214), así el transportista lee el mismo formato
 * antes de ofertar y después de cobrar.
 */
export function PriceBreakdownCard({
  header,
  lines,
  total,
  banner,
  status,
  footer,
  testID,
}: PriceBreakdownCardProps) {
  return (
    <View
      testID={testID}
      className="overflow-hidden rounded-md border border-border"
    >
      {banner}
      <View className="flex-row items-center justify-between gap-3 bg-bg-mute px-3.5 py-3.5">
        <Text className="font-sans text-small text-fg-2">{header.label}</Text>
        {typeof header.value === "string" ? (
          <Text className="font-sans-semibold text-body text-fg">
            {header.value}
          </Text>
        ) : (
          header.value
        )}
      </View>
      {status}
      {lines.length > 0 ? (
        <View className="gap-2.5 px-3.5 py-3.5">
          {lines.map((line) => (
            <View
              key={line.label}
              className="flex-row items-center justify-between gap-3"
            >
              <Text className="flex-shrink font-sans text-small text-fg-3">
                {line.label}
              </Text>
              <Text
                testID={line.testID}
                className={
                  line.tone === "danger"
                    ? "font-sans-medium text-small text-danger-600"
                    : "font-sans text-small text-fg-3"
                }
              >
                {line.value ?? "—"}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <View
        className={`flex-row items-center justify-between gap-3 px-3.5 py-3.5 ${
          total.variant === "highlight"
            ? "bg-lime-500"
            : total.variant === "pending"
              ? "border-t border-border bg-bg-mute"
              : "bg-bg-mute"
        }`}
      >
        {/* Sobre lima el texto va en tinta fija: `text-fg` se vuelve blanco en modo oscuro. */}
        <Text
          className={`font-sans-medium text-[11px] uppercase tracking-wide ${
            total.variant === "highlight" ? "text-ink-950/65" : "text-fg-2"
          }`}
        >
          {total.label}
        </Text>
        <Text
          testID={total.testID}
          className={
            total.variant === "highlight"
              ? "font-sans-semibold text-[26px] text-ink-950"
              : total.variant === "muted"
                ? "font-sans-semibold text-[26px] text-fg"
                : "font-sans text-small text-fg-3"
          }
        >
          {total.value}
        </Text>
      </View>
      {footer}
    </View>
  );
}
