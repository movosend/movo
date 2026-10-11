import { router, useLocalSearchParams } from "expo-router";
import { CircleCheck, ChevronLeft, Clock, MapPin, Package } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../../components/auth/primary-button";
import { packageTypeLabel } from "../../../components/send/category-grid";
import { CounterpartCard } from "../../../components/shipments/counterpart-card";
import { ConfirmActionSheet } from "../../../components/ui/confirm-action-sheet";
import { ErrorBanner } from "../../../components/ui/error-banner";
import { TextField } from "../../../components/ui/text-field";
import {
  useAcceptReceiverTransfer,
  useReceiverTransfer,
  useRejectReceiverTransfer,
} from "../../../src/hooks/use-receiver-transfers";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { useAuthStore } from "../../../src/store/auth-store";
import { friendlyErrorMessage } from "../../../src/lib/error-messages";
import { getFirstName } from "../../../src/lib/profile-format";
import { redesignationDeadlineLabel } from "../../../src/lib/shipment-format";
import type { PackageType } from "../../../src/store/shipment-wizard-store";

/** Por qué una invitación ya no se puede aceptar, según cómo se cerró. */
function closedInvitationText(status: string, cancelReason: string | null, requesterFirstName: string): string {
  switch (status) {
    case "completed":
      return "Ya aceptaste esta invitación. El paquete lo recibís vos.";
    case "rejected_by_new_receiver":
      return `Rechazaste esta invitación. El paquete lo sigue recibiendo ${requesterFirstName}.`;
    case "expired":
      return `Venció el plazo para aceptar. El paquete lo sigue recibiendo ${requesterFirstName}.`;
    default:
      return cancelReason === "delivery_started"
        ? `La entrega ya empezó, así que el paquete lo recibe ${requesterFirstName}.`
        : `${requesterFirstName} canceló la invitación.`;
  }
}

/**
 * MOVO-275 AC2/AC8: la persona invitada decide si recibe el paquete en lugar del
 * receptor original. Antes de aceptar ve dónde lo recibe (sin eso no se puede decidir),
 * qué es y quiénes participan; todavía no tiene acceso al envío completo.
 */
export default function ReceiverTransferInvitationScreen() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currentUserId = useAuthStore((s) => s.user?.userId ?? null);
  const { data: invitation, isLoading, isError, error, refetch } = useReceiverTransfer(id);
  const accept = useAcceptReceiverTransfer();
  const reject = useRejectReceiverTransfer();
  const [rejectSheetVisible, setRejectSheetVisible] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)/home");
  };

  const handleAccept = async () => {
    if (!id) return;
    setErrorMessage(null);
    try {
      await accept.mutateAsync({ transferId: id });
      setAccepted(true);
    } catch (err) {
      setErrorMessage(friendlyErrorMessage(err, "No pudimos aceptar la invitación. Intentá de nuevo."));
      void refetch();
    }
  };

  const handleReject = async () => {
    if (!id) return;
    setErrorMessage(null);
    try {
      await reject.mutateAsync({ transferId: id, reason: rejectReason.trim() || undefined });
      setRejectSheetVisible(false);
      void refetch();
    } catch (err) {
      setRejectSheetVisible(false);
      setErrorMessage(friendlyErrorMessage(err, "No pudimos rechazar la invitación. Intentá de nuevo."));
      void refetch();
    }
  };

  const requesterFirstName = getFirstName(invitation?.requesterName) || "El receptor";
  const deadlineLabel = redesignationDeadlineLabel(invitation?.newReceiverDeadline);
  const isPending = invitation?.status === "pending_new_receiver" && deadlineLabel !== null;
  const isInvitee = invitation !== undefined && invitation.newReceiverId === currentUserId;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="transfer-invitation-back"
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Volver"
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">Invitación para recibir</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator testID="transfer-invitation-loading" color={colors.fg3} />
        </View>
      ) : isError || !invitation ? (
        <View className="gap-3 px-5 pt-2">
          <ErrorBanner
            testID="transfer-invitation-error"
            message={friendlyErrorMessage(error, "No pudimos cargar la invitación.")}
          />
          <Pressable onPress={() => refetch()} className="self-start rounded-lg bg-bg-mute px-3 py-1.5">
            <Text className="font-sans-medium text-small text-fg">Reintentar</Text>
          </Pressable>
        </View>
      ) : accepted ? (
        <View testID="transfer-invitation-accepted" className="flex-1 justify-center gap-4 px-6">
          <View className="h-14 w-14 items-center justify-center rounded-full bg-lime-500">
            <CircleCheck size={28} color="#0A0A0B" strokeWidth={2} />
          </View>
          <Text className="font-sans-semibold text-title text-fg">Ahora recibís este paquete</Text>
          <Text className="font-sans text-body text-fg-2">
            {requesterFirstName}, el emisor y el transportista ya saben que lo recibís vos. Cuando llegue, escaneá
            el QR del transportista para confirmar la entrega.
          </Text>
          <PrimaryButton
            testID="transfer-invitation-view-shipment"
            label="Ver el envío"
            onPress={() => router.replace(`/shipments/${invitation.shipmentId}`)}
          />
        </View>
      ) : (
        <>
          <ScrollView className="flex-1 px-5" contentContainerClassName="gap-4 pb-8" showsVerticalScrollIndicator={false}>
            <ErrorBanner testID="transfer-invitation-action-error" message={errorMessage} />

            {!isPending ? (
              <View
                testID="transfer-invitation-closed"
                className="gap-1 rounded-xl border border-border bg-bg-sub px-3.5 py-3"
              >
                <Text className="font-sans-semibold text-small text-fg">Esta invitación ya no está vigente</Text>
                <Text className="font-sans text-small text-fg-2">
                  {closedInvitationText(invitation.status, invitation.cancelReason, requesterFirstName)}
                </Text>
              </View>
            ) : null}

            <View className="gap-1.5">
              <Text testID="transfer-invitation-title" className="font-sans-semibold text-title text-fg">
                {requesterFirstName} te pidió que recibas su paquete
              </Text>
              {invitation.reason ? (
                <Text className="font-sans text-body italic text-fg-2">“{invitation.reason}”</Text>
              ) : null}
              <Text className="font-sans text-small text-fg-2">
                Si aceptás, el paquete pasa a tu nombre: lo recibís vos en la dirección de entrega y firmás la entrega
                con el transportista escaneando su QR.
              </Text>
            </View>

            <View className="gap-2.5 rounded-[14px] border border-border bg-bg px-4 py-3.5">
              <View className="flex-row items-start gap-2.5">
                <MapPin size={16} color={colors.fg2} strokeWidth={1.8} />
                <View className="flex-1">
                  <Text className="font-sans-medium text-caption uppercase text-fg-3">Dónde lo recibís</Text>
                  <Text testID="transfer-invitation-address" className="font-sans-semibold text-small text-fg">
                    {invitation.shipment.deliveryAddress}
                  </Text>
                </View>
              </View>
              <View className="flex-row items-start gap-2.5">
                <Package size={16} color={colors.fg2} strokeWidth={1.8} />
                <View className="flex-1">
                  <Text className="font-sans-medium text-caption uppercase text-fg-3">Paquete</Text>
                  <Text className="font-sans-semibold text-small text-fg">
                    {packageTypeLabel(invitation.shipment.packageType as PackageType)}
                  </Text>
                  <Text className="font-sans text-caption text-fg-2">
                    {invitation.shipment.weightKg} kg · {invitation.shipment.lengthCm} × {invitation.shipment.widthCm}{" "}
                    × {invitation.shipment.heightCm} cm
                  </Text>
                </View>
              </View>
            </View>

            <View className="gap-2">
              <Text className="font-sans-medium text-caption uppercase text-fg-3">Emisor</Text>
              <CounterpartCard userId={invitation.shipment.senderId} testID="transfer-invitation-sender" />
            </View>
            {invitation.shipment.carrierId ? (
              <View className="gap-2">
                <Text className="font-sans-medium text-caption uppercase text-fg-3">Transportista</Text>
                <CounterpartCard userId={invitation.shipment.carrierId} testID="transfer-invitation-carrier" />
              </View>
            ) : null}
          </ScrollView>

          {isPending && isInvitee ? (
            <View className="gap-3 border-t border-border bg-bg px-5 pb-4 pt-3.5">
              <View className="flex-row items-center gap-1.5">
                <Clock size={14} color={colors.fg3} strokeWidth={2} />
                <Text testID="transfer-invitation-deadline" className="font-sans text-caption text-fg-3">
                  {deadlineLabel} para aceptar
                </Text>
              </View>
              <View className="flex-row gap-3">
                <Pressable
                  testID="transfer-invitation-reject"
                  onPress={() => setRejectSheetVisible(true)}
                  disabled={accept.isPending}
                  accessibilityRole="button"
                  className="h-12 flex-1 items-center justify-center rounded-lg border border-border-strong bg-bg"
                >
                  <Text className="font-sans-semibold text-body text-fg">Rechazar</Text>
                </Pressable>
                <Pressable
                  testID="transfer-invitation-accept"
                  onPress={() => void handleAccept()}
                  disabled={accept.isPending}
                  accessibilityRole="button"
                  className="h-12 flex-[1.4] flex-row items-center justify-center gap-2 rounded-lg bg-lime-500"
                >
                  {accept.isPending ? <ActivityIndicator color="#0A0A0B" /> : null}
                  <Text className="font-sans-semibold text-body text-ink-950">Aceptar y recibir</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <ConfirmActionSheet
            visible={rejectSheetVisible}
            title="¿Rechazar la invitación?"
            description={`El paquete lo sigue recibiendo ${requesterFirstName}. Le avisamos a esa persona y al emisor.`}
            confirmLabel="Rechazar invitación"
            tone="danger"
            isPending={reject.isPending}
            onConfirm={() => void handleReject()}
            onClose={() => setRejectSheetVisible(false)}
            testID="transfer-invitation-reject-sheet"
          >
            <TextField
              testID="transfer-invitation-reject-reason"
              label="Motivo (opcional)"
              value={rejectReason}
              onChangeText={setRejectReason}
              maxLength={500}
              multiline
            />
          </ConfirmActionSheet>
        </>
      )}
    </SafeAreaView>
  );
}
