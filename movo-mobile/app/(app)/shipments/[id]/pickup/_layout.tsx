import { router, Stack, useLocalSearchParams } from "expo-router";
import { AlertCircle, Wallet } from "lucide-react-native";
import { createContext, useContext, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ConfirmHandshakeResult } from "../../../../../src/api/shipments-client";
import { usePickupWizard } from "../../../../../src/hooks/use-pickup-wizard";
import { useThemeColors } from "../../../../../src/hooks/use-theme-colors";

/**
 * Único lugar donde `scan.tsx` deja el resultado del handshake para que
 * `success.tsx` lo muestre (MOVO-198) -- expo-router no serializa bien un objeto
 * completo por query params, y los dos viven siempre bajo el mismo `_layout`, así
 * que un Context acotado a este árbol alcanza sin sumar una dependencia de estado
 * global nueva.
 */
const PickupResultContext = createContext<{
  result: ConfirmHandshakeResult | null;
  setResult: (result: ConfirmHandshakeResult) => void;
} | null>(null);

export function usePickupResult() {
  const ctx = useContext(PickupResultContext);
  if (!ctx) {
    throw new Error("usePickupResult debe usarse dentro de PickupWizardLayout");
  }
  return ctx;
}

function GateMessage({
  icon,
  title,
  body,
  ctaLabel,
  onPress,
  testID,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  ctaLabel: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View testID={testID} className="flex-1 items-center justify-center gap-4 px-8">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-bg-mute">{icon}</View>
        <Text className="text-center font-sans-semibold text-h3 text-fg">{title}</Text>
        <Text className="text-center font-sans text-body text-fg-2">{body}</Text>
        <Pressable
          testID={`${testID}-cta`}
          onPress={onPress}
          className="mt-2 w-full items-center justify-center rounded-lg bg-fg py-3.5 active:opacity-80"
        >
          <Text className="font-sans-semibold text-body text-bg">{ctaLabel}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/**
 * Gate del wizard de retiro (MOVO-198 AC1): resuelve si el envío está en
 * condiciones reales de iniciar el retiro ANTES de renderizar cualquiera de los
 * pasos del wizard (rediseño: 5 pasos accionables + confirmación, ver
 * `pickup-wizard-step-header.tsx`). Como todavía no existe ningún CTA de producción que lleve acá (depende del
 * mapa de MOVO-207, sin construir), esta ruta solo se alcanza por navegación
 * manual/deep link -- por eso cada estado "no listo" explica el motivo real en vez
 * de un error genérico, es el único punto de entrada hoy.
 */
export default function PickupWizardLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const { gate: liveGate } = usePickupWizard(id);
  const [result, setResult] = useState<ConfirmHandshakeResult | null>(null);
  // Una vez confirmado el handshake en esta sesión, el envío pasa a `in_transit` y el
  // gate en vivo pasaría a `already_done`, pisando la pantalla de éxito con el mensaje
  // "Ya confirmaste este retiro" (una segunda confirmación redundante). El gate solo
  // protege la ENTRADA al wizard: con resultado en mano ya no se reevalúa.
  const gate = result ? "ready" : liveGate;

  const goToDetail = () => router.replace(`/shipments/${id}`);

  if (gate === "loading") {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator testID="pickup-wizard-loading" color={colors.fg2} />
      </SafeAreaView>
    );
  }

  if (gate === "unfunded") {
    return (
      <GateMessage
        testID="pickup-wizard-unfunded"
        icon={<Wallet size={26} color={colors.fg2} strokeWidth={1.8} />}
        title="Todavía no te toca retirar"
        body="El retiro es a más de unos días y la reserva de fondos se confirma más cerca de la fecha. Volvé a intentarlo cuando se acerque el horario de retiro."
        ctaLabel="Volver al envío"
        onPress={goToDetail}
      />
    );
  }

  if (gate === "already_done") {
    return (
      <GateMessage
        testID="pickup-wizard-already-done"
        icon={<AlertCircle size={26} color={colors.fg2} strokeWidth={1.8} />}
        title="Ya confirmaste este retiro"
        body="El envío ya está en tránsito. No hace falta escanear de nuevo."
        ctaLabel="Ver envío"
        onPress={goToDetail}
      />
    );
  }

  if (gate === "not_found" || gate === "not_carrier" || gate === "invalid_state") {
    const body =
      gate === "not_found"
        ? "No pudimos cargar este envío."
        : gate === "not_carrier"
          ? "No sos el transportista asignado a este envío."
          : "Este envío no está en etapa de retiro.";

    return (
      <GateMessage
        testID="pickup-wizard-blocked"
        icon={<AlertCircle size={26} color={colors.fg2} strokeWidth={1.8} />}
        title="No podés retirar este envío"
        body={body}
        ctaLabel="Volver"
        onPress={() => (router.canGoBack() ? router.back() : goToDetail())}
      />
    );
  }

  return (
    <PickupResultContext.Provider value={{ result, setResult }}>
      <Stack screenOptions={{ headerShown: false }} />
    </PickupResultContext.Provider>
  );
}
