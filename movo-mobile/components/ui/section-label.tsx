import type { ReactNode } from "react";
import { Text } from "react-native";

/** Eyebrow de sección (mayúsculas, 11px, `fg-3`). Antes duplicado en `carrier/offers/[id].tsx`
 * y `transport/[id]/offer.tsx`; MOVO-214 lo reusa en el detalle del pago. */
export function SectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Text
      className={`font-sans-medium text-[11px] uppercase tracking-wide text-fg-3 ${className ?? "mb-2.5"}`}
    >
      {children}
    </Text>
  );
}
