import { RECEIVER_TRANSFER_ALLOWED_SHIPMENT_STATUSES } from "@movo/shared/dist/types/receiver-transfer";
import type { PublicProfile } from "@movo/shared/dist/types/user-profile";
import { router, useLocalSearchParams } from "expo-router";
import { BellRing, ChevronLeft, Clock, MapPin, Undo2 } from "lucide-react-native";
import { useState, type ReactNode } from "react";
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
import { ConfirmActionSheet } from "../../../../components/ui/confirm-action-sheet";
import { ErrorBanner } from "../../../../components/ui/error-banner";
import { TextField } from "../../../../components/ui/text-field";
import { useKeyboardScroll } from "../../../../src/hooks/use-keyboard-scroll";
import { usePublicProfile } from "../../../../src/hooks/use-profile";
import { useRequestReceiverTransfer } from "../../../../src/hooks/use-receiver-transfers";
import { useShipment } from "../../../../src/hooks/use-shipments";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";
import { getFirstName } from "../../../../src/lib/profile-format";
import { shortAddressLabel } from "../../../../src/lib/shipment-format";
import { useAuthStore } from "../../../../src/store/auth-store";

/** Plazo de la persona invitada (`RECEIVER_TRANSFER_TIMEOUT_HOURS`, default del backend). */
const INVITE_DEADLINE_HOURS = 6;

function NextStep({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <View className="flex-row items-start gap-3">
      <View className="mt-px h-7 w-7 items-center justify-center rounded-full bg-bg-mute">{icon}</View>
      <Text className="flex-1 pt-1 font-sans text-[13px] leading-[19px] text-fg-2">{children}</Text>
    </View>
  );
}

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
  const { data: senderProfile } = usePublicProfile(shipment?.senderId);
  const { data: carrierProfile } = usePublicProfile(shipment?.carrierId ?? undefined);
  const { scrollRef, onScroll, onFocusInput } = useKeyboardScroll();
  const [newReceiver, setNewReceiver] = useState<PublicProfile | null>(null);
  const [reason, setReason] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);

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

  const senderFirstName = getFirstName(senderProfile?.fullName);
  const carrierFirstName = getFirstName(carrierProfile?.fullName);
  const notifiedLabel = [
    senderFirstName ? `${senderFirstName} (emisor)` : "El emisor",
    shipment?.carrierId ? (carrierFirstName ? `${carrierFirstName} (transportista)` : "el transportista") : null,
  ]
    .filter(Boolean)
    .join(" y ");

  const disabledReasons: Record<string, string> = {};
  if (shipment) {
    disabledReasons[shipment.senderId] = senderFirstName
      ? `${senderFirstName} es el emisor de este envío`
      : "Es el emisor de este envío";
    if (shipment.carrierId)
      disabledReasons[shipment.carrierId] = carrierFirstName
        ? `${carrierFirstName} es el transportista de este envío`
        : "Es el transportista de este envío";
  }

  const submit = async () => {
    if (!newReceiver || !id) return;
    setErrorMessage(null);
    setConfirmVisible(false);
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
    if (newReceiver) setConfirmVisible(true);
  };

  const confirmFirstName = newReceiver ? getFirstName(newReceiver.fullName) || "esta persona" : "";

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

            <View
              testID="receiver-transfer-next-steps"
              className="gap-4 rounded-xl border border-border bg-bg-sub px-4 py-4"
            >
              <Text className="font-sans-medium text-caption uppercase text-fg-3">Qué pasa después</Text>
              <NextStep icon={<Clock size={16} color={colors.fg2} strokeWidth={1.8} />}>
                Le llega una invitación y tiene {INVITE_DEADLINE_HOURS} h para aceptar.
              </NextStep>
              <NextStep icon={<Undo2 size={16} color={colors.fg2} strokeWidth={1.8} />}>
                Si no acepta a tiempo, lo seguís recibiendo vos.
              </NextStep>
              <NextStep icon={<MapPin size={16} color={colors.fg2} strokeWidth={1.8} />}>
                Se entrega en{" "}
                <Text className="font-sans-semibold text-fg">{shortAddressLabel(shipment.deliveryAddress)}</Text>. La
                dirección no cambia.
              </NextStep>
              <NextStep icon={<BellRing size={16} color={colors.fg2} strokeWidth={1.8} />}>
                {notifiedLabel} se enteran. Solo se puede cambiar quién recibe una vez.
              </NextStep>
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

      <ConfirmActionSheet
        visible={confirmVisible}
        title={`¿Pasarle la recepción a ${confirmFirstName}?`}
        description={`Le llega una invitación y tiene ${INVITE_DEADLINE_HOURS} h para aceptar. Cuando acepte, el paquete pasa a su nombre y vos seguís viendo el envío en modo lectura. Solo se puede hacer una vez.`}
        confirmLabel="Enviar invitación"
        isPending={requestTransfer.isPending}
        onConfirm={() => void submit()}
        onClose={() => setConfirmVisible(false)}
        testID="receiver-transfer-confirm-sheet"
      />
    </SafeAreaView>
  );
}
