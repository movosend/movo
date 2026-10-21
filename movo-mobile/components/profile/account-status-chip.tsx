import type { PublicAccountStatus } from "@movo/shared/dist/types/account-sanctions";
import { Ban, ShieldAlert } from "lucide-react-native";
import { Text, View } from "react-native";

export interface AccountStatusChipProps {
  status: PublicAccountStatus | undefined;
  /** Margen u otra clase del contenedor, para que una cuenta activa no deje un hueco. */
  className?: string;
  testID?: string;
}

const META = {
  suspended: {
    label: "Cuenta suspendida",
    Icon: ShieldAlert,
    iconColor: "#A97714",
    bgClassName: "bg-warning-100",
    textClassName: "text-warning-700",
  },
  disabled: {
    label: "Cuenta inhabilitada",
    Icon: Ban,
    iconColor: "#C22F35",
    bgClassName: "bg-danger-100",
    textClassName: "text-danger-600",
  },
} as const;

/**
 * Estado de la cuenta de otra persona (MOVO-300 AC5, decisión 5 de MOVO-36): en su perfil
 * público y en la tarjeta de la contraparte de un envío. Nunca el motivo ni el plazo: el
 * `PublicProfile` no los trae. Una cuenta activa no muestra nada.
 */
export function AccountStatusChip({
  status,
  className = "",
  testID,
}: AccountStatusChipProps) {
  if (status !== "suspended" && status !== "disabled") return null;
  const { label, Icon, iconColor, bgClassName, textClassName } = META[status];
  return (
    <View
      testID={testID}
      className={`flex-row items-center gap-1 self-start rounded-full px-2.5 py-1 ${bgClassName} ${className}`}
    >
      <Icon size={11} color={iconColor} strokeWidth={2.2} />
      <Text className={`font-sans-medium text-[11px] ${textClassName}`}>
        {label}
      </Text>
    </View>
  );
}
