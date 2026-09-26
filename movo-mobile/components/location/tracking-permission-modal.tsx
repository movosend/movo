import * as Haptics from "expo-haptics";
import { CheckCircle2, Navigation, ShieldCheck } from "lucide-react-native";
import { Modal, Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

export interface TrackingPermissionModalProps {
  visible: boolean;
  stage?: "foreground" | "background";
  onAccept: () => void;
  onDismiss: () => void;
  testID?: string;
}

/**
 * Pantalla explicativa previa a solicitar el permiso de ubicación del sistema (MOVO-203, AC4; MOVO-242, AC2).
 * Explica al transportista el propósito y acotación temporal del tracking antes de disparar
 * el diálogo nativo de iOS / Android para maximizar la tasa de aceptación, tanto en primer plano
 * como en segundo plano.
 */
export function TrackingPermissionModal({
  visible,
  stage = "foreground",
  onAccept,
  onDismiss,
  testID = "tracking-permission-modal",
}: TrackingPermissionModalProps) {
  const colors = useThemeColors();

  const handleAccept = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onAccept();
  };

  const handleDismiss = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onDismiss();
  };

  const isBackground = stage === "background";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleDismiss}
      testID={testID}
    >
      <View className="flex-1 items-center justify-center bg-black/60 px-6">
        <View className="w-full max-w-sm rounded-[24px] border border-border bg-bg p-6 shadow-2xl">
          {/* Icono de navegación con fondo lime */}
          <View className="mb-4 h-14 w-14 items-center justify-center rounded-2xl bg-lime-500/20">
            <Navigation size={28} color="#C6F24A" strokeWidth={2.2} />
          </View>

          <Text className="font-sans-bold text-[20px] leading-tight text-fg">
            {isBackground
              ? "Ubicación en segundo plano"
              : "Ubicación en vivo durante el envío"}
          </Text>

          <Text className="mt-2 font-sans text-[14px] leading-relaxed text-fg-2">
            {isBackground
              ? "Para mantener informados al emisor y destinatario mientras conducís con la pantalla apagada o usás otra app (como Waze o Maps), Movo necesita acceso a tu ubicación en segundo plano durante el viaje."
              : "Para que el emisor y el receptor puedan ver el avance del paquete en el mapa, Movo necesita compartir tu ubicación mientras realizás el viaje."}
          </Text>

          {/* Puntos destacados */}
          <View className="mt-4 gap-2.5 rounded-xl bg-bg-mute/60 p-3.5 border border-border/50">
            <View className="flex-row items-center gap-2.5">
              <CheckCircle2 size={16} color={colors.fg1} strokeWidth={2} />
              <Text className="flex-1 font-sans text-[12px] text-fg-1">
                {isBackground
                  ? "Permite apagar la pantalla o alternar apps de navegación sin pausar el viaje."
                  : "Visible solo mientras el envío esté En camino."}
              </Text>
            </View>

            <View className="flex-row items-center gap-2.5">
              <ShieldCheck size={16} color={colors.fg1} strokeWidth={2} />
              <Text className="flex-1 font-sans text-[12px] text-fg-1">
                {isBackground
                  ? "Se detiene automáticamente al completar el viaje o entregar los paquetes."
                  : "Se detiene automáticamente al confirmar la entrega."}
              </Text>
            </View>
          </View>

          {/* Botones de acción */}
          <View className="mt-6 gap-2.5">
            <Pressable
              onPress={handleAccept}
              testID={`${testID}-accept-btn`}
              className="w-full items-center justify-center rounded-xl bg-lime-500 py-3.5 active:opacity-90"
            >
              <Text className="font-sans-semibold text-[15px] text-ink-950">
                {isBackground ? "Permitir en segundo plano" : "Entendido, activar ubicación"}
              </Text>
            </Pressable>

            <Pressable
              onPress={handleDismiss}
              testID={`${testID}-dismiss-btn`}
              className="w-full items-center justify-center rounded-xl py-2.5 active:opacity-70"
            >
              <Text className="font-sans-medium text-[13px] text-fg-3">
                {isBackground
                  ? "Continuar solo con app abierta"
                  : "Continuar sin compartir ubicación"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
