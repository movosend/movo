import { router, useLocalSearchParams } from "expo-router";
import { CheckCircle2, ChevronLeft, MapPin, QrCode } from "lucide-react-native";
import { useEffect, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CounterpartCard } from "../../../../../components/shipments/counterpart-card";
import { PackageCard } from "../../../../../components/shipments/package-card";
import { PrimaryButton } from "../../../../../components/auth/primary-button";
import { ErrorBanner } from "../../../../../components/ui/error-banner";
import { SkeletonBlock } from "../../../../../components/ui/skeleton-block";
import { useEvidenceStatus, useShipment } from "../../../../../src/hooks/use-shipments";
import { usePickupProximityCheck } from "../../../../../src/hooks/use-pickup-proximity-check";
import { useThemeColors } from "../../../../../src/hooks/use-theme-colors";
import {
  formatPickupDateLabel,
  formatPickupWindowLabel,
  shortAddressLabel,
} from "../../../../../src/lib/shipment-format";

function Eyebrow({ children }: { children: ReactNode }) {
  return <Text className="mb-1.5 font-sans-medium text-caption uppercase text-fg-3">{children}</Text>;
}

/**
 * Paso 1 del wizard de retiro (MOVO-198 AC2/AC4/AC6/AC7): resumen del retiro,
 * validación de proximidad, y el aviso explícito de pedirle el QR al emisor antes de
 * escanear. Decide el paso siguiente sin archivo propio en el ticket original -- es
 * la ruta índice de `pickup/`.
 */
export default function PickupSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const { data: shipment, isLoading, isError } = useShipment(id);
  const evidenceStatus = useEvidenceStatus(id);
  const proximity = usePickupProximityCheck(shipment?.pickupLat ?? 0, shipment?.pickupLng ?? 0);

  useEffect(() => {
    if (shipment) void proximity.check();
    // Solo una vez, apenas se resuelve el envío -- "Reintentar" dispara el resto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!shipment]);

  if (isLoading || !shipment) {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="gap-4 px-5 pt-4">
          <SkeletonBlock className="h-32 w-full rounded-[14px]" />
          <SkeletonBlock className="h-20 w-full rounded-[14px]" />
          <SkeletonBlock className="h-16 w-full rounded-[14px]" />
        </View>
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView className="flex-1 bg-bg px-5 pt-4">
        <ErrorBanner testID="pickup-summary-error" message="No pudimos cargar este envío." />
      </SafeAreaView>
    );
  }

  const dateLabel = formatPickupDateLabel(shipment.pickupDate);
  const windowLabel = formatPickupWindowLabel(shipment.pickupTimeWindowStart, shipment.pickupTimeWindowEnd);

  function handleContinue() {
    const satisfied = evidenceStatus.data?.satisfied === true;
    router.push(`/shipments/${id}/pickup/${satisfied ? "scan" : "evidence"}`);
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="pickup-summary-back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace(`/shipments/${id}`))}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute active:opacity-75"
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">Retirar paquete</Text>
      </View>

      <ScrollView contentContainerClassName="gap-5 px-5 pb-6" showsVerticalScrollIndicator={false}>
        <View className="gap-1.5 rounded-[14px] border border-border bg-bg px-4 py-3.5">
          <Eyebrow>Retiro</Eyebrow>
          <Text className="font-sans-semibold text-[15px] text-fg">
            {shortAddressLabel(shipment.pickupAddress)}
          </Text>
          <Text className="font-sans text-small text-fg-2">
            {[dateLabel, windowLabel].filter(Boolean).join(" · ")}
          </Text>
        </View>

        <View>
          <Eyebrow>Emisor</Eyebrow>
          <CounterpartCard
            testID="pickup-summary-sender"
            userId={shipment.senderId}
            onPress={() => router.push(`/profile/${shipment.senderId}`)}
          />
        </View>

        <View>
          <Eyebrow>Paquete</Eyebrow>
          <PackageCard testID="pickup-summary-package" shipment={shipment} />
        </View>

        <View className="flex-row items-start gap-3 rounded-[14px] border border-warning-300 bg-warning-100 px-4 py-3.5">
          <QrCode size={20} color="#0A0A0B" strokeWidth={1.8} />
          <Text testID="pickup-summary-qr-reminder" className="flex-1 font-sans text-small text-ink-950">
            Antes de escanear, pedile al emisor que genere el código QR de retiro desde
            su app -- sin eso no vas a tener nada que escanear en el próximo paso.
          </Text>
        </View>

        <View className="gap-3 rounded-[14px] border border-border px-4 py-3.5">
          <View className="flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-bg-mute">
              {proximity.status === "checking" ? (
                <ActivityIndicator testID="pickup-proximity-spinner" size="small" color={colors.fg2} />
              ) : proximity.status === "within_range" ? (
                <CheckCircle2 size={20} color="#16754A" strokeWidth={2} />
              ) : (
                <MapPin size={20} color={colors.fg2} strokeWidth={1.8} />
              )}
            </View>
            <Text className="flex-1 font-sans text-small text-fg-2">
              {proximity.status === "checking"
                ? "Confirmando que estás en el punto de retiro…"
                : proximity.status === "within_range"
                  ? "Estás en el punto de retiro."
                  : proximity.status === "out_of_range"
                    ? `Estás a ${Math.round(proximity.distanceMeters ?? 0)}m del punto de retiro -- acercate para continuar.`
                    : proximity.status === "denied"
                      ? "Necesitamos tu ubicación para confirmar que estás en el punto de retiro."
                      : proximity.status === "error"
                        ? "No pudimos confirmar tu ubicación."
                        : "Vamos a confirmar tu ubicación."}
            </Text>
          </View>
          {proximity.status !== "within_range" && proximity.status !== "checking" ? (
            <Pressable
              testID="pickup-proximity-retry"
              onPress={() => void proximity.check()}
              className="self-start rounded-lg bg-bg-mute px-3 py-1.5"
            >
              <Text className="font-sans-medium text-small text-fg">Reintentar</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <PrimaryButton
        testID="pickup-summary-continue"
        label="Continuar"
        disabled={proximity.status !== "within_range"}
        onPress={handleContinue}
      />
    </SafeAreaView>
  );
}
