import { router } from "expo-router";
import { Banknote } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

/**
 * MOVO-37: en la pantalla de éxito de la entrega de un envío en efectivo no hay cobro que seguir (el transportista
 * cobró en mano al retirar). En su lugar, avisa que la comisión de Movo quedó en su cuenta corriente. Vive en la hoja
 * blanca de `HandshakeConfirmationResult`, como `DeliveryPaymentStatus`: colores fijos.
 */
export function DeliveryCashCommissionNote({ testID }: { testID?: string }) {
  return (
    <View testID={testID} className="flex-row items-center justify-between gap-3 rounded-[14px] border border-ink-950/10 p-3.5">
      <View className="flex-1 flex-row items-center gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-full bg-ink-100">
          <Banknote size={16} color="#3A3A40" strokeWidth={2} />
        </View>
        <View className="flex-1">
          <Text className="font-sans-semibold text-[14px] leading-5 text-ink-950">Cobraste en efectivo</Text>
          <Text className="mt-0.5 font-sans text-[12.5px] leading-[18px] text-ink-500">
            La comisión de Movo quedó como saldo en tu cuenta.
          </Text>
        </View>
      </View>
      <Pressable
        testID={testID ? `${testID}-balance` : undefined}
        onPress={() => router.push("/profile/payments?tab=balance")}
        accessibilityRole="link"
        hitSlop={8}
      >
        <Text className="font-sans-semibold text-[12.5px] text-ink-950 underline">Ver saldo</Text>
      </Pressable>
    </View>
  );
}
