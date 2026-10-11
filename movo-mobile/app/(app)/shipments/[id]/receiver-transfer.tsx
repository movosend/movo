import { RECEIVER_TRANSFER_ALLOWED_SHIPMENT_STATUSES } from "@movo/shared/dist/types/receiver-transfer";
import type { PublicProfile } from "@movo/shared/dist/types/user-profile";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, Clock, MapPin, PenLine } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { TextField } from "../../../../components/ui/text-field";
import { useKeyboardScroll } from "../../../../src/hooks/use-keyboard-scroll";
import { useRequestReceiverTransfer } from "../../../../src/hooks/use-receiver-transfers";
import { useShipment } from "../../../../src/hooks/use-shipments";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";
import { getFirstName } from "../../../../src/lib/profile-format";
import { shortAddressLabel } from "../../../../src/lib/shipment-format";
import { useAuthStore } from "../../../../src/store/auth-store";

/** Plazo de la persona invitada (`RECEIVER_TRANSFER_TIMEOUT_HOURS`, default del backend). */
const INVITE_DEADLINE_HOURS = 6;

/**
 * MOVO-275: el receptor elige a otra persona para que reciba el envío en su lugar.
 * Reusa el buscador del wizard (MOVO-83): el emisor y el transportista aparecen
 * deshabilitados con el motivo (decisión de producto: que nadie se pregunte por qué no
 * los encuentra) y uno mismo no aparece. La dirección de entrega no cambia.
 */
export default function ReceiverTransferScreen() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currentUserId = useAuthStore((s) => s.user?.userId);
  const { data: shipment, isLoading, refetch } = useShipment(id);
  const requestTransfer = useRequestReceiverTransfer();
  const { scrollRef, onScroll, onFocusInput } = useKeyboardScroll();
  const [newReceiver, setNewReceiver] = useState<PublicProfile | null>(null);
  const [reason, setReason] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/shipments/${id}`);
    }
  };

  const canTransfer =
    shipment !== undefined &&
    shipment.receiverId === currentUserId &&
    RECEIVER_TRANSFER_ALLOWED_SHIPMENT_STATUSES.includes(shipment.status) &&
    !shipment.receiverTransfer?.pending &&
    !shipment.receiverTransfer?.completed;

  const disabledReasons: Record<string, string> = {};
  if (shipment) {
    disabledReasons[shipment.senderId] = "Es el emisor de este envío";
    if (shipment.carrierId) disabledReasons[shipment.carrierId] = "Es el transportista de este envío";
  }

  const submit = async () => {
    if (!newReceiver || !id) return;
    setErrorMessage(null);
    try {
      await requestTransfer.mutateAsync({
        shipmentId: id,
        newReceiverId: newReceiver.id,
        reason: reason.trim() || undefined,
      });
      router.dismissTo(`/shipments/${id}`);
    } catch (err) {
      setErrorMessage(friendlyErrorMessage(err, "No pudimos enviar la invitación. Intentá de nuevo."));
      void refetch();
    }
  };

  const handleSubmit = () => {
    if (!newReceiver) return;
    const firstName = getFirstName(newReceiver.fullName) || "esta persona";
    Alert.alert(
      `¿Pasarle la recepción a ${firstName}?`,
      `Le llega una invitación y tiene ${INVITE_DEADLINE_HOURS} h para aceptar. Cuando acepte, el paquete pasa a su nombre y vos seguís viendo el envío en modo lectura. Solo se puede hacer una vez.`,
      [
        { text: "Volver", style: "cancel" },
        { text: "Enviar invitación", onPress: () => void submit() },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="receiver-transfer-back"
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Volver"
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">Que lo reciba otra persona</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator testID="receiver-transfer-loading" color={colors.fg3} />
        </View>
      ) : !canTransfer ? (
        <View testID="receiver-transfer-unavailable" className="flex-1 px-5 pt-4">
          <Text className="mb-1.5 font-sans-semibold text-title text-fg">Ya no podés cambiar quién recibe</Text>
          <Text className="font-sans text-body text-fg-2">
            El envío cambió de estado, ya tiene una solicitud en curso o ya cambió de receptor una vez.
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
            <ErrorBanner testID="receiver-transfer-error" message={errorMessage} />

            <Text className="mt-2 font-sans text-body text-fg-2">
              Elegí a alguien con cuenta en Movo e identidad verificada. Va a recibir el paquete en la misma
              dirección y firmar la entrega con el transportista.
            </Text>

            <View className="gap-1.5">
              <Text className="font-sans-medium text-small text-fg">Quién lo recibe</Text>
              <ReceiverSearchField
                testID="receiver-transfer-search"
                selected={newReceiver}
                onSelect={setNewReceiver}
                onClear={() => setNewReceiver(null)}
                onFocusInput={onFocusInput}
                excludeIds={currentUserId ? [currentUserId] : []}
                disabledReasons={disabledReasons}
              />
            </View>

            <View className="gap-1.5">
              <TextField
                testID="receiver-transfer-reason"
                label="Motivo (opcional)"
                value={reason}
                onChangeText={setReason}
                maxLength={500}
                multiline
                placeholder="Ej: esa semana estoy de viaje"
              />
              <Text className="font-sans text-caption text-fg-3">Lo ven la persona que elegiste y el emisor.</Text>
            </View>

            <View testID="receiver-transfer-next-steps" className="gap-2.5 rounded-[10px] border border-border bg-bg-sub px-3.5 py-3">
              <Text className="font-sans-medium text-caption uppercase text-fg-3">Qué pasa después</Text>
              <View className="flex-row items-start gap-2.5">
                <Clock size={16} color={colors.fg2} strokeWidth={1.8} />
                <Text className="flex-1 font-sans text-[12px] text-fg-2">
                  Le llega una invitación y tiene {INVITE_DEADLINE_HOURS} h para aceptar. Si no acepta, lo seguís
                  recibiendo vos.
                </Text>
              </View>
              <View className="flex-row items-start gap-2.5">
                <MapPin size={16} color={colors.fg2} strokeWidth={1.8} />
                <Text className="flex-1 font-sans text-[12px] text-fg-2">
                  Se entrega en{" "}
                  <Text className="font-sans-semibold text-fg">{shortAddressLabel(shipment.deliveryAddress)}</Text>.
                  La dirección no cambia.
                </Text>
              </View>
              <View className="flex-row items-start gap-2.5">
                <PenLine size={16} color={colors.fg2} strokeWidth={1.8} />
                <Text className="flex-1 font-sans text-[12px] text-fg-2">
                  El emisor y el transportista se enteran. Solo se puede cambiar quién recibe una vez.
                </Text>
              </View>
            </View>
          </ScrollView>

          <PrimaryButton
            testID="receiver-transfer-submit"
            label="Enviar invitación"
            onPress={handleSubmit}
            disabled={!newReceiver || !newReceiver.isVerified}
            loading={requestTransfer.isPending}
          />
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
