import { Banknote, CreditCard } from "lucide-react-native";
import type { ComponentType } from "react";
import { Pressable, Text, View } from "react-native";
import type { ShipmentPaymentMethod } from "../../src/api/shipments-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { SectionLabel } from "../ui/section-label";

export interface PaymentMethodSelectorProps {
  value: ShipmentPaymentMethod;
  onChange: (value: ShipmentPaymentMethod) => void;
  /** MOVO-37: el emisor tiene saldo pendiente con Movo, así que efectivo no se puede elegir (403
   * `CASH_PAYMENT_SENDER_HAS_DEBT`). Con tarjeta sí: la deuda se cobra en ese pago. */
  cashBlockedByDebt: boolean;
  onPayBalance: () => void;
  testID?: string;
}

interface OptionProps {
  label: string;
  description: string;
  Icon: ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}

function Option({ label, description, Icon, selected, disabled, onPress, testID }: OptionProps) {
  const colors = useThemeColors();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      className={`flex-1 gap-1.5 rounded-[12px] px-3.5 py-3 ${
        selected ? "border-[1.5px] border-fg bg-bg" : "border border-border bg-bg"
      } ${disabled ? "opacity-50" : "active:opacity-80"}`}
    >
      <Icon size={20} strokeWidth={1.8} color={colors.fg1} />
      <Text className="font-sans-semibold text-[14px] text-fg">{label}</Text>
      <Text className="font-sans text-[12px] leading-[16px] text-fg-3">{description}</Text>
    </Pressable>
  );
}

/**
 * MOVO-37 (M1): modalidad de pago del envío, en el resumen del wizard. Se elige al crear: una vez que el envío recibe
 * ofertas no se puede cambiar (409 `SHIPMENT_PAYMENT_METHOD_LOCKED`).
 */
export function PaymentMethodSelector({
  value,
  onChange,
  cashBlockedByDebt,
  onPayBalance,
  testID = "payment-method-selector",
}: PaymentMethodSelectorProps) {
  return (
    <View testID={testID}>
      <SectionLabel>¿Cómo vas a pagar?</SectionLabel>
      <View className="flex-row gap-2.5">
        <Option
          testID={`${testID}-card`}
          label="Tarjeta"
          description="Reservás el pago con tu tarjeta cuando elegís una oferta."
          Icon={CreditCard}
          selected={value === "card"}
          onPress={() => onChange("card")}
        />
        <Option
          testID={`${testID}-cash`}
          label="Efectivo"
          description="Le pagás en mano al transportista cuando retira el paquete."
          Icon={Banknote}
          selected={value === "cash"}
          disabled={cashBlockedByDebt}
          onPress={() => onChange("cash")}
        />
      </View>
      {cashBlockedByDebt ? (
        <View
          testID={`${testID}-debt`}
          className="mt-2.5 rounded-[10px] border border-warning-300 bg-warning-100 px-3.5 py-3"
        >
          <Text className="font-sans text-[13px] leading-[18px] text-ink-950/80">
            Tenés un saldo pendiente con Movo. Para pagar en efectivo, primero saldalo; con tarjeta podés seguir
            enviando.
          </Text>
          <Pressable
            testID={`${testID}-pay-balance`}
            onPress={onPayBalance}
            accessibilityRole="button"
            className="mt-2 self-start rounded-full border border-ink-950/30 px-3.5 py-1.5"
          >
            <Text className="font-sans-semibold text-[12px] text-ink-950">Pagar mi saldo</Text>
          </Pressable>
        </View>
      ) : value === "cash" ? (
        <View testID={`${testID}-cash-info`} className="mt-2.5 rounded-[10px] bg-bg-mute px-3.5 py-3">
          <Text className="font-sans text-[13px] leading-[18px] text-fg-2">
            Le pagás al transportista el monto acordado completo, en efectivo, cuando le entregás el paquete. No
            reservamos nada en tu tarjeta.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
