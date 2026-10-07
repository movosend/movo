import { router, Stack, useLocalSearchParams } from "expo-router";
import { AlertCircle } from "lucide-react-native";
import { createContext, useContext, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ConfirmHandshakeResult } from "../../../../../src/api/shipments-client";
import { useDeliveryWizard } from "../../../../../src/hooks/use-delivery-wizard";
import { useThemeColors } from "../../../../../src/hooks/use-theme-colors";

/**
 * Único lugar donde `qr.tsx` deja el resultado del handshake para que `success.tsx`
 * lo muestre (MOVO-199, calcado de `PickupResultContext` de MOVO-198) -- expo-router
 * no serializa bien un objeto completo por query params, y los dos viven siempre
 * bajo el mismo `_layout`, así que un Context acotado a este árbol alcanza sin sumar
 * una dependencia de estado global nueva.
 */
const DeliveryResultContext = createContext<{
  result: ConfirmHandshakeResult | null;
  setResult: (result: ConfirmHandshakeResult) => void;
} | null>(null);

export function useDeliveryResult() {
  const ctx = useContext(DeliveryResultContext);
  if (!ctx) {
    throw new Error("useDeliveryResult debe usarse dentro de DeliveryWizardLayout");
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
 * Gate del wizard de entrega (MOVO-199 AC1, calcado de `pickup/_layout.tsx`
 * MOVO-198): resuelve si el envío está en condiciones reales de iniciar la entrega
 * ANTES de renderizar cualquiera de los pasos del wizard (5 pasos accionables +
 * confirmación: geo/proximidad → resumen → aviso → evidencia → QR → éxito). El punto de
 * entrada real es el mapa de ruta (`MOVO-207`, `app/(app)/route/index.tsx`) -- por
 * eso cada estado "no listo" explica el motivo real en vez de un error genérico.
 */
export default function DeliveryWizardLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const { gate: liveGate } = useDeliveryWizard(id);
  const [result, setResult] = useState<ConfirmHandshakeResult | null>(null);
  // El gate solo protege la ENTRADA al wizard: una vez que dio `ready`, queda fijo
  // por el resto de la sesión. Si se reevaluara en vivo, cualquier refetch del envío
  // que vea `delivered` (el handshake ya se confirmó) antes de que el paso del QR/escaneo
  // guarde su resultado pasaría el gate a `already_done`, desmontaría el `<Stack>` y
  // pisaría la pantalla de éxito con "Ya confirmaste esta entrega". Un cambio de estado
  // real a mitad del wizard (ej. cancelación) igual lo rechaza el backend al generar
  // o confirmar el handshake.
  const [reachedReady, setReachedReady] = useState(false);
  if (liveGate === "ready" && !reachedReady) setReachedReady(true);
  const gate = reachedReady || liveGate === "ready" ? "ready" : liveGate;

  const goToDetail = () => router.replace(`/shipments/${id}`);

  if (gate === "loading") {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator testID="delivery-wizard-loading" color={colors.fg2} />
      </SafeAreaView>
    );
  }

  if (gate === "already_done") {
    return (
      <GateMessage
        testID="delivery-wizard-already-done"
        icon={<AlertCircle size={26} color={colors.fg2} strokeWidth={1.8} />}
        title="Ya confirmaste esta entrega"
        body="El envío ya figura como entregado. No hace falta generar el código de nuevo."
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
          : "Este envío no está en etapa de entrega.";

    return (
      <GateMessage
        testID="delivery-wizard-blocked"
        icon={<AlertCircle size={26} color={colors.fg2} strokeWidth={1.8} />}
        title="No podés entregar este envío"
        body={body}
        ctaLabel="Volver"
        onPress={() => (router.canGoBack() ? router.back() : goToDetail())}
      />
    );
  }

  return (
    <DeliveryResultContext.Provider value={{ result, setResult }}>
      <Stack screenOptions={{ headerShown: false }} />
    </DeliveryResultContext.Provider>
  );
}
