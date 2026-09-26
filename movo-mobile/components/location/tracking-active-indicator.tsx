import { AlertCircle, Navigation, WifiOff } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useCarrierTracking } from "../../src/hooks/use-carrier-tracking";
import { TrackingPermissionModal } from "./tracking-permission-modal";

export interface TrackingActiveIndicatorProps {
  testID?: string;
  className?: string;
}

/**
 * Indicador visual meramente informativo de tracking activo para el transportista (MOVO-203, AC8; MOVO-242).
 * Muestra el estado en tiempo real de la emisión de ubicación, la falta de conexión o
 * la degradación funcional a foreground cuando falta permiso en segundo plano (AC3).
 * Si faltan permisos de ubicación, permite tocar para abrir el modal explicativo respectivo.
 */
export function TrackingActiveIndicator({
  testID = "tracking-active-indicator",
  className = "w-full mb-6",
}: TrackingActiveIndicatorProps) {
  const {
    isTracking,
    inTransitCount,
    pendingQueueCount,
    permissionGranted,
    backgroundPermissionGranted,
    lastError,
    requestPermission,
    requestBackgroundPermission,
  } = useCarrierTracking();

  const [modalStage, setModalStage] = useState<"foreground" | "background">("foreground");
  const [permissionModalVisible, setPermissionModalVisible] = useState(false);

  // Si no hay envíos en camino y no hay tracking activo, no se muestra nada
  if (inTransitCount === 0 && pendingQueueCount === 0 && !isTracking) {
    return null;
  }

  const isForegroundDenied = permissionGranted === false || lastError === "PERMISSION_DENIED";
  const isBackgroundMissing =
    !isForegroundDenied && isTracking && backgroundPermissionGranted === false;

  const isInteractive = isForegroundDenied || isBackgroundMissing;

  const handlePress = () => {
    if (isForegroundDenied) {
      setModalStage("foreground");
      setPermissionModalVisible(true);
    } else if (isBackgroundMissing) {
      setModalStage("background");
      setPermissionModalVisible(true);
    }
  };

  const handleModalAccept = async () => {
    setPermissionModalVisible(false);
    if (modalStage === "foreground") {
      await requestPermission();
    } else {
      await requestBackgroundPermission();
    }
  };

  return (
    <>
      <Pressable
        testID={testID}
        disabled={!isInteractive}
        onPress={isInteractive ? handlePress : undefined}
        accessibilityRole={isInteractive ? "button" : "text"}
        accessibilityLabel={
          isForegroundDenied
            ? "Permiso de ubicación requerido. Toca para activar."
            : isBackgroundMissing
              ? "Transmitiendo solo con app abierta. Toca para activar en segundo plano."
              : pendingQueueCount > 0
                ? "Sin conexión a internet"
                : "Transmitiendo ubicación en vivo"
        }
        className={`flex-row items-center gap-2.5 rounded-xl px-3.5 py-2.5 border ${
          isForegroundDenied
            ? "border-amber-500/40 bg-amber-500/10 active:bg-amber-500/15"
            : isBackgroundMissing
              ? "border-sky-500/40 bg-sky-500/10 active:bg-sky-500/15"
              : pendingQueueCount > 0
                ? "border-blue-500/40 bg-blue-500/10"
                : "border-lime-500/40 bg-lime-500/10"
        } ${className}`}
      >
        {/* Indicador de estado o icono */}
        {isForegroundDenied ? (
          <AlertCircle size={18} color="#F59E0B" strokeWidth={2} />
        ) : isBackgroundMissing ? (
          <Navigation size={18} color="#0EA5E9" strokeWidth={2} />
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
              isForegroundDenied
                ? "text-amber-500"
                : isBackgroundMissing
                  ? "text-sky-400"
                  : pendingQueueCount > 0
                    ? "text-blue-400"
                    : "text-fg"
            }`}
          >
            {isForegroundDenied
              ? "Permiso de ubicación requerido"
              : isBackgroundMissing
                ? "Transmitiendo solo con app abierta"
                : pendingQueueCount > 0
                  ? "Sin conexión a internet"
                  : "Transmitiendo ubicación en vivo"}
          </Text>
          <Text className="font-sans text-[11px] text-fg-3 leading-4">
            {isForegroundDenied
              ? "Toca para activar el permiso de ubicación"
              : isBackgroundMissing
                ? "Toca para activar en segundo plano y apagar la pantalla sin pausar"
                : pendingQueueCount > 0
                  ? "Tu ubicación se transmitirá a los participantes de tus envíos una vez que se restablezca"
                  : `${inTransitCount} ${inTransitCount === 1 ? "envío pendiente" : "envíos pendientes"} de entrega`}
          </Text>
        </View>
      </Pressable>

      {/* Modal explicativo de permisos en dos etapas */}
      <TrackingPermissionModal
        visible={permissionModalVisible}
        stage={modalStage}
        onAccept={handleModalAccept}
        onDismiss={() => setPermissionModalVisible(false)}
      />
    </>
  );
}
