import * as Haptics from "expo-haptics";
import { CheckCircle2, Navigation, ShieldCheck } from "lucide-react-native";
import { Modal, Pressable, Text, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

export interface TrackingPermissionModalProps {
  visible: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  testID?: string;
}

/**
 * Pantalla explicativa previa a solicitar el permiso de ubicación del sistema (MOVO-203, AC4).
 * Explica al transportista el propósito y acotación temporal del tracking antes de disparar
 * el diálogo nativo de iOS / Android para maximizar la tasa de aceptación.
 */
export function TrackingPermissionModal({
  visible,
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
            Ubicación en vivo durante el envío
          </Text>

          <Text className="mt-2 font-sans text-[14px] leading-relaxed text-fg-2">
            Para que el emisor y el receptor puedan ver el avance del paquete en el mapa,
            Movo necesita compartir tu ubicación mientras realizás el viaje.
          </Text>

          {/* Puntos destacados */}
          <View className="mt-4 gap-2.5 rounded-xl bg-bg-mute/60 p-3.5 border border-border/50">
            <View className="flex-row items-center gap-2.5">
              <CheckCircle2 size={16} color={colors.fg1} strokeWidth={2} />
              <Text className="flex-1 font-sans text-[12px] text-fg-1">
                Visible solo mientras el envío esté <Text className="font-sans-semibold">En camino</Text>.
              </Text>
            </View>

            <View className="flex-row items-center gap-2.5">
              <ShieldCheck size={16} color={colors.fg1} strokeWidth={2} />
              <Text className="flex-1 font-sans text-[12px] text-fg-1">
                Se detiene automáticamente al confirmar la entrega.
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
                Entendido, activar ubicación
              </Text>
            </Pressable>

            <Pressable
              onPress={handleDismiss}
              testID={`${testID}-dismiss-btn`}
              className="w-full items-center justify-center rounded-xl py-2.5 active:opacity-70"
            >
              <Text className="font-sans-medium text-[13px] text-fg-3">
                Continuar sin compartir ubicación
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
