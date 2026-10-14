import { ActivityIndicator, Pressable, Text } from "react-native";

/**
 * Botones de las hojas de tarjetas (MOVO-101), con las medidas del prototipo: radio de 8,
 * 15px semibold. Distintos de `ConfirmActionSheet` (radio 12, 48px de alto) a propósito,
 * para quedar igual al diseño de "Pagos y cobros".
 */
interface SheetButtonProps {
  label: string;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
  loading?: boolean;
}

export function SheetPrimaryButton({ label, onPress, testID, disabled, loading }: SheetButtonProps) {
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={onPress}
      disabled={off}
      className={`h-[50px] items-center justify-center rounded-lg ${off && !loading ? "bg-bg-mute" : "bg-fg active:opacity-80"}`}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#B4B4BC" />
      ) : (
        <Text className={`font-sans-semibold text-[15px] ${off ? "text-fg-3" : "text-bg"}`}>{label}</Text>
      )}
    </Pressable>
  );
}

export function SheetOutlineButton({
  label,
  onPress,
  testID,
  disabled,
  tone = "default",
}: SheetButtonProps & { tone?: "default" | "danger" }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      className="h-[50px] items-center justify-center rounded-lg border border-border-strong bg-bg active:opacity-80"
    >
      <Text className={`font-sans-semibold text-[15px] ${tone === "danger" ? "text-danger-600" : "text-fg"}`}>
        {label}
      </Text>
    </Pressable>
  );
}

export function SheetDangerButton({ label, onPress, testID, disabled, loading }: SheetButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      onPress={onPress}
      disabled={disabled || loading}
      className={`h-[50px] items-center justify-center rounded-lg bg-danger-500 ${disabled ? "opacity-50" : "active:opacity-80"}`}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <Text className="font-sans-semibold text-[15px] text-white">{label}</Text>
      )}
    </Pressable>
  );
}

export function SheetBackButton({ onPress, testID, disabled }: Omit<SheetButtonProps, "label">) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel="Volver"
      onPress={onPress}
      disabled={disabled}
      className="items-center py-2"
    >
      <Text className="font-sans-medium text-[15px] text-fg-2">Volver</Text>
    </Pressable>
  );
}
