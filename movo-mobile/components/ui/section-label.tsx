import type { ReactNode } from "react";
import { Text } from "react-native";

/** Eyebrow de sección (mayúsculas, 11px, `fg-3`). Antes duplicado en `carrier/offers/[id].tsx`
 * y `transport/[id]/offer.tsx`; MOVO-214 lo reusa en el detalle del pago. */
export function SectionLabel({
  children,
  className,
  noMargin = false,
}: {
  children: ReactNode;
  className?: string;
  noMargin?: boolean;
}) {
  return (
    <Text
      className={`font-sans-medium text-[11px] uppercase tracking-wide text-fg-3 ${noMargin ? "" : "mb-2.5"}${className ? ` ${className}` : ""}`}
    >
      {children}
    </Text>
  );
}
