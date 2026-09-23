import * as Haptics from "expo-haptics";
import { AlertCircle, CheckCircle2, ChevronRight, Navigation, RefreshCw, WifiOff } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useCarrierTracking } from "../../src/hooks/use-carrier-tracking";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { TrackingPermissionModal } from "./tracking-permission-modal";

export interface TrackingActiveIndicatorProps {
  testID?: string;
}

/**
 * Indicador visual de tracking activo para el transportista (MOVO-203, AC8).
 * Muestra el estado en tiempo real de la emisión de ubicación, el estado de los permisos
 * y si hay posiciones encoladas offline esperando red. Al presionarlo abre un modal
 * con los detalles del servicio y acciones de sincronización.
 */
export function TrackingActiveIndicator({
  testID = "tracking-active-indicator",
}: TrackingActiveIndicatorProps) {
  const colors = useThemeColors();
  const {
    isTracking,
    inTransitCount,
    pendingQueueCount,
    permissionGranted,
    lastReportedAt,
    lastError,
    requestPermission,
    flushQueue,
  } = useCarrierTracking();

  const [detailsVisible, setDetailsVisible] = useState(false);
  const [permissionModalVisible, setPermissionModalVisible] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);

  // Si no hay envíos en camino y no hay posiciones pendientes en cola, no se muestra nada
  if (inTransitCount === 0 && pendingQueueCount === 0 && !isTracking) {
    return null;
  }

  const isPermissionDenied = permissionGranted === false || lastError === "PERMISSION_DENIED";

  const handleOpenDetails = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDetailsVisible(true);
  };

  const handleManualFlush = async () => {
    setIsFlushing(true);
    try {
      await flushQueue();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsFlushing(false);
    }
  };

  const handleRequestPermission = () => {
    setDetailsVisible(false);
    setPermissionModalVisible(true);
  };

  return (
    <>
      <Pressable
        testID={testID}
        onPress={handleOpenDetails}
        className={`mx-5 mb-3 flex-row items-center justify-between rounded-xl px-3.5 py-2.5 border ${
          isPermissionDenied
            ? "border-amber-500/40 bg-amber-500/10 active:bg-amber-500/15"
            : pendingQueueCount > 0
              ? "border-blue-500/40 bg-blue-500/10 active:bg-blue-500/15"
              : "border-lime-500/40 bg-lime-500/10 active:bg-lime-500/15"
        }`}
      >
        <View className="flex-row items-center gap-2.5 flex-1">
          {/* Indicador de estado animado o icono */}
          {isPermissionDenied ? (
            <AlertCircle size={18} color="#F59E0B" strokeWidth={2} />
          ) : pendingQueueCount > 0 ? (
            <WifiOff size={18} color="#3B82F6" strokeWidth={2} />
          ) : (
            <View className="relative items-center justify-center">
              <View className="h-2.5 w-2.5 rounded-full bg-lime-500" />
              <View className="absolute h-4 w-4 rounded-full bg-lime-500/30" />
            </View>
          )}

          <View className="flex-1">
            <Text
              testID={`${testID}-status-text`}
              className={`font-sans-semibold text-[13px] ${
                isPermissionDenied
                  ? "text-amber-500"
                  : pendingQueueCount > 0
                    ? "text-blue-400"
                    : "text-fg"
              }`}
            >
              {isPermissionDenied
                ? "Permiso de ubicación requerido"
                : pendingQueueCount > 0
                  ? "Sin conexión a internet"
                  : "Transmitiendo ubicación en vivo"}
            </Text>
            <Text className="font-sans text-[11px] text-fg-3 leading-4">
              {isPermissionDenied
                ? `${inTransitCount} ${inTransitCount === 1 ? "envío" : "envíos"} en camino`
                : pendingQueueCount > 0
                  ? "Tu ubicación se transmitirá a los participantes de tus envíos una vez que se restablezca"
                  : `${inTransitCount} ${inTransitCount === 1 ? "envío" : "envíos"} en camino`}
            </Text>
          </View>
        </View>

        <ChevronRight size={16} color={colors.fg3} />
      </Pressable>

      {/* Modal de detalles de seguimiento */}
      <Modal
        visible={detailsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailsVisible(false)}
        testID={`${testID}-details-modal`}
      >
        <View className="flex-1 items-center justify-center bg-black/60 px-6">
          <View className="w-full max-w-sm rounded-[24px] border border-border bg-bg p-5 shadow-2xl">
            <View className="flex-row items-center gap-2.5 mb-3">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-lime-500/20">
                <Navigation size={20} color="#C6F24A" strokeWidth={2.2} />
              </View>
              <View>
                <Text className="font-sans-bold text-[17px] text-fg">
                  Seguimiento de entregas
                </Text>
                <Text className="font-sans text-[12px] text-fg-3">
                  Transmisión GPS del transportista
                </Text>
              </View>
            </View>

            {/* Tarjetas de estado */}
            <View className="gap-2.5 my-2">
              <View className="flex-row items-center justify-between rounded-xl bg-bg-mute/60 p-3 border border-border/50">
                <Text className="font-sans text-[13px] text-fg-2">Estado del servicio</Text>
                <Text className="font-sans-semibold text-[13px] text-fg">
                  {isTracking ? "Activo" : "Detenido"}
                </Text>
              </View>

              <View className="flex-row items-center justify-between rounded-xl bg-bg-mute/60 p-3 border border-border/50">
                <Text className="font-sans text-[13px] text-fg-2">Permiso de ubicación</Text>
                <Text
                  className={`font-sans-semibold text-[13px] ${
                    permissionGranted ? "text-lime-500" : "text-amber-500"
                  }`}
                >
                  {permissionGranted ? "Concedido" : "No concedido"}
                </Text>
              </View>

              <View className="flex-row items-center justify-between rounded-xl bg-bg-mute/60 p-3 border border-border/50">
                <Text className="font-sans text-[13px] text-fg-2">Conexión a internet</Text>
                <Text
                  className={`font-sans-semibold text-[13px] ${
                    pendingQueueCount > 0 ? "text-amber-500" : "text-lime-500"
                  }`}
                >
                  {pendingQueueCount > 0 ? "Sin conexión" : "En línea"}
                </Text>
              </View>

              {lastReportedAt ? (
                <View className="flex-row items-center justify-between rounded-xl bg-bg-mute/60 p-3 border border-border/50">
                  <Text className="font-sans text-[13px] text-fg-2">Último reporte</Text>
                  <Text className="font-sans text-[12px] text-fg-3">
                    {new Date(lastReportedAt).toLocaleTimeString("es-AR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Acciones */}
            <View className="mt-4 gap-2">
              {isPermissionDenied ? (
                <Pressable
                  onPress={handleRequestPermission}
                  className="w-full items-center justify-center rounded-xl bg-lime-500 py-3 active:opacity-90"
                >
                  <Text className="font-sans-semibold text-[14px] text-ink-950">
                    Activar permiso de ubicación
                  </Text>
                </Pressable>
              ) : null}

              {pendingQueueCount > 0 ? (
                <Pressable
                  onPress={handleManualFlush}
                  disabled={isFlushing}
                  className="w-full flex-row items-center justify-center gap-2 rounded-xl bg-bg-mute py-3 active:opacity-80"
                >
                  <RefreshCw size={15} color={colors.fg1} className={isFlushing ? "animate-spin" : ""} />
                  <Text className="font-sans-semibold text-[13px] text-fg">
                    {isFlushing ? "Reintentando conexión..." : "Reintentar conexión"}
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => setDetailsVisible(false)}
                className="w-full items-center justify-center rounded-xl py-2.5 active:opacity-70"
              >
                <Text className="font-sans-medium text-[13px] text-fg-3">Cerrar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal explicativo de permisos */}
      <TrackingPermissionModal
        visible={permissionModalVisible}
        onAccept={async () => {
          setPermissionModalVisible(false);
          await requestPermission();
        }}
        onDismiss={() => setPermissionModalVisible(false)}
      />
    </>
  );
}
