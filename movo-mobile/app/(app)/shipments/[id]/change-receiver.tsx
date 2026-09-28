import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { PublicProfile } from "@movo/shared/dist/types/user-profile";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, Clock, MapPin } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../../../components/auth/primary-button";
import { ReceiverSearchField } from "../../../../components/send/receiver-search-field";
import { ErrorBanner } from "../../../../components/ui/error-banner";
import { useKeyboardScroll } from "../../../../src/hooks/use-keyboard-scroll";
import {
  useRedesignateReceiver,
  useShipment,
  useShipmentEvents,
} from "../../../../src/hooks/use-shipments";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";
import { redesignationDeadlineLabel, shortAddressLabel } from "../../../../src/lib/shipment-format";
import { useAuthStore } from "../../../../src/store/auth-store";

/**
 * MOVO-253: el emisor elige otro receptor para un envío rechazado. Reusa el buscador
 * del wizard de creación (MOVO-83); la dirección de entrega no cambia (decisión de
 * producto), así que solo se elige la persona. Quienes ya rechazaron este envío salen
 * de los resultados — el backend igual los rechazaría con 422.
 */
export default function ChangeReceiverScreen() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currentUserId = useAuthStore((s) => s.user?.userId);
  const { data: shipment, isLoading, refetch } = useShipment(id);
  const { data: events } = useShipmentEvents(id);
  const redesignate = useRedesignateReceiver();
  const { scrollRef, onScroll, onFocusInput } = useKeyboardScroll();
  const [receiver, setReceiver] = useState<PublicProfile | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/shipments/${id}`);
    }
  };

  const rejectedByIds = (events ?? [])
    .filter((event) => event.toStatus === ShipmentStatus.REJECTED_BY_RECEIVER && event.actorId)
    .map((event) => event.actorId as string);
  const excludeIds = currentUserId ? [...rejectedByIds, currentUserId] : rejectedByIds;

  const deadlineLabel = redesignationDeadlineLabel(shipment?.receiverRedesignationDeadline);
  const canRedesignate =
    shipment !== undefined &&
    shipment.senderId === currentUserId &&
    shipment.status === ShipmentStatus.REJECTED_BY_RECEIVER &&
    deadlineLabel !== null;

  const handleSubmit = async () => {
    if (!receiver || !id) return;
    setErrorMessage(null);
    try {
      await redesignate.mutateAsync({ id, receiverId: receiver.id });
      router.replace(`/shipments/${id}`);
    } catch (err) {
      setErrorMessage(friendlyErrorMessage(err, "No pudimos cambiar el receptor. Intentá de nuevo."));
      void refetch();
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="change-receiver-back"
          onPress={handleBack}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">Elegir otro receptor</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator testID="change-receiver-loading" color={colors.fg3} />
        </View>
      ) : !canRedesignate ? (
        <View testID="change-receiver-unavailable" className="flex-1 px-5 pt-4">
          <Text className="mb-1.5 font-sans-semibold text-title text-fg">
            Ya no podés elegir otro receptor
          </Text>
          <Text className="font-sans text-body text-fg-2">
            El plazo para elegir a otra persona venció o el envío cambió de estado.
          </Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 16 : 0}
        >
          <ScrollView
            ref={scrollRef}
            onScroll={onScroll}
            scrollEventThrottle={16}
            className="flex-1 px-5"
            contentContainerClassName="gap-5 pb-8"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <ErrorBanner testID="change-receiver-error" message={errorMessage} />

            <View>
              <Text className="mb-1.5 mt-2 font-sans-semibold text-title text-fg">
                ¿Quién lo recibe ahora?
              </Text>
              <Text className="font-sans text-body text-fg-2">
                La persona que elijas va a tener que confirmar el envío, igual que al crearlo.
              </Text>
            </View>

            <ReceiverSearchField
              testID="change-receiver-search"
              selected={receiver}
              onSelect={setReceiver}
              onClear={() => setReceiver(null)}
              onFocusInput={onFocusInput}
              excludeIds={excludeIds}
            />

            <View className="gap-2.5 rounded-[10px] border border-border bg-bg-sub px-3.5 py-3">
              <View className="flex-row items-start gap-2.5">
                <MapPin size={16} color={colors.fg2} strokeWidth={1.8} />
                <Text className="flex-1 font-sans text-[12px] text-fg-2">
                  Se entrega en{" "}
                  <Text className="font-sans-semibold text-fg">
                    {shortAddressLabel(shipment.deliveryAddress)}
                  </Text>
                  . La dirección no cambia.
                </Text>
              </View>
              <View className="flex-row items-start gap-2.5">
                <Clock size={16} color={colors.fg2} strokeWidth={1.8} />
                <Text testID="change-receiver-deadline" className="flex-1 font-sans text-[12px] text-fg-2">
                  {deadlineLabel}. Si no elegís a nadie, el envío se cancela.
                </Text>
              </View>
            </View>
          </ScrollView>

          <PrimaryButton
            testID="change-receiver-submit"
            label="Enviar al nuevo receptor"
            onPress={() => void handleSubmit()}
            disabled={!receiver || !receiver.isVerified}
            loading={redesignate.isPending}
          />
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
