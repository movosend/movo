import { ChevronRight, type LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

/**
 * Piezas comunes de "Medios de pago" y "Medios de cobro" en "Pagos y cobros" (prototipo de
 * Claude Design "MOVO-112 Pagos y cobros v3"): las dos secciones son la misma lista, con un
 * recuadro de marca, título, detalle y menú, una fila de acción con borde punteado al final,
 * y el mismo estado vacío.
 */

/** Recuadro de la marca: 44×30 en las listas, 52×36 en las hojas de opciones. */
export function PaymentMethodTile({
  size = "md",
  testID,
  children,
}: {
  size?: "md" | "lg";
  testID?: string;
  children: ReactNode;
}) {
  return (
    <View
      testID={testID}
      className={`shrink-0 items-center justify-center border border-border-strong bg-bg-sub ${
        size === "lg" ? "h-9 w-[52px] rounded-[6px]" : "h-[30px] w-11 rounded-[5px]"
      }`}
    >
      {children}
    </View>
  );
}

/** Fila final de la lista ("Agregar tarjeta", "Cambiar cuenta"), con recuadro punteado. */
export function PaymentMethodActionRow({
  icon: Icon,
  label,
  onPress,
  disabled,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      className={`flex-row items-center gap-3 bg-bg-sub px-4 py-3.5 active:bg-bg-mute ${disabled ? "opacity-50" : ""}`}
    >
      <View
        className="h-[30px] w-11 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] border-dashed"
        style={{ borderColor: colors.borderStrong }}
      >
        <Icon size={16} color={colors.fg1} strokeWidth={2} />
      </View>
      <Text className="flex-1 font-sans-semibold text-[15px] text-fg">{label}</Text>
      <ChevronRight size={18} color={colors.fg3} strokeWidth={1.8} />
    </Pressable>
  );
}

/** Estado vacío de una sección: ícono, título, explicación y un botón. */
export function PaymentMethodsEmpty({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  actionDisabled,
  testID,
  actionTestID,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  actionDisabled?: boolean;
  testID: string;
  actionTestID: string;
}) {
  return (
    <View testID={testID} className="items-center gap-2 rounded-2xl border border-border bg-bg-sub px-4 pb-4 pt-6">
      <View className="mb-1 h-12 w-12 items-center justify-center rounded-xl border border-border bg-bg">{icon}</View>
      <Text className="font-sans-semibold text-[15px] text-fg">{title}</Text>
      <Text className="max-w-[260px] text-center font-sans text-[13px] leading-[18px] text-fg-3">{body}</Text>
      <Pressable
        testID={actionTestID}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        accessibilityState={{ disabled: !!actionDisabled }}
        onPress={onAction}
        disabled={actionDisabled}
        className={`mt-2 w-full items-center rounded-full py-3 ${actionDisabled ? "bg-bg-mute" : "bg-fg active:opacity-80"}`}
      >
        <Text className={`font-sans-semibold text-[14px] ${actionDisabled ? "text-fg-3" : "text-bg"}`}>
          {actionLabel}
        </Text>
      </Pressable>
    </View>
  );
}
