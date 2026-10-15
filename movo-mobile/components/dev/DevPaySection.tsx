import { router } from "expo-router";
import { CreditCard } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { PAY_DEMO_SCENARIOS, PAY_DEMO_SHIPMENT_ID } from "../../src/dev/pay-demo-fixtures";

/**
 * Sección de `DevShortcutsScreen` (solo __DEV__) para ver la pantalla de pago con tarjeta guardada
 * + CVV (MOVO-269) sin un envío en `assignment_pending` ni transportista con Mercado Pago. Abre la
 * pantalla real con `?demo=` (datos de prueba, sin backend). El resultado se simula con el CVV:
 * cualquiera reserva, 132 = código incorrecto, 000 = sin fondos, 111 = tarjeta rechazada,
 * 999 = error de plataforma. "Agregar tarjeta nueva" abre la hoja real y sí pega contra el backend.
 */
export function DevPaySection() {
  return (
    <View className="mb-6 rounded-[16px] border border-border bg-bg-sub p-4">
      <View className="mb-3 flex-row items-center gap-2">
        <View className="h-8 w-8 items-center justify-center rounded-full bg-lime-500/15">
          <CreditCard size={16} color="#2BB673" />
        </View>
        <View className="flex-1">
          <Text className="font-sans-semibold text-[15px] text-fg">Pago con tarjeta guardada (MOVO-269)</Text>
          <Text className="font-sans text-[11px] text-fg-3">Datos de prueba, sin backend</Text>
        </View>
      </View>

      <View className="gap-2">
        {PAY_DEMO_SCENARIOS.map((scenario) => (
          <Pressable
            key={scenario.id}
            testID={`dev-pay-${scenario.id}`}
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: "/shipments/[id]/pay",
                params: { id: PAY_DEMO_SHIPMENT_ID, demo: scenario.id },
              } as never)
            }
            className="rounded-[12px] border border-border bg-bg px-4 py-3 active:opacity-75"
          >
            <Text className="font-sans-medium text-[13px] text-fg">{scenario.label}</Text>
            <Text className="mt-0.5 font-sans text-[11px] text-fg-3">{scenario.hint}</Text>
          </Pressable>
        ))}
      </View>

      <Text className="mt-3 font-sans text-[11px] leading-4 text-fg-3">
        CVV de prueba: cualquiera reserva · 132 código incorrecto · 000 sin fondos · 111 tarjeta rechazada · 999 error de
        plataforma.
      </Text>
    </View>
  );
}
