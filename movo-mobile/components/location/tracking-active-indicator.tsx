import { AlertCircle, WifiOff } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useCarrierTracking } from "../../src/hooks/use-carrier-tracking";
import { TrackingPermissionModal } from "./tracking-permission-modal";

export interface TrackingActiveIndicatorProps {
  testID?: string;
}

/**
 * Indicador visual meramente informativo de tracking activo para el transportista (MOVO-203, AC8).
 * Muestra el estado en tiempo real de la emisión de ubicación o la falta de conexión.
 * Si faltan permisos de ubicación, permite tocara para abrir el modal explicativo.
 */
export function TrackingActiveIndicator({
  testID = "tracking-active-indicator",
}: TrackingActiveIndicatorProps) {
  const {
    isTracking,
    inTransitCount,
    pendingQueueCount,
    permissionGranted,
    lastError,
    requestPermission,
  } = useCarrierTracking();

  const [permissionModalVisible, setPermissionModalVisible] = useState(false);

  // Si no hay envíos en camino y no hay tracking activo, no se muestra nada
  if (inTransitCount === 0 && pendingQueueCount === 0 && !isTracking) {
    return null;
  }

  const isPermissionDenied = permissionGranted === false || lastError === "PERMISSION_DENIED";

  return (
    <>
      <Pressable
        testID={testID}
        disabled={!isPermissionDenied}
        onPress={isPermissionDenied ? () => setPermissionModalVisible(true) : undefined}
        accessibilityRole={isPermissionDenied ? "button" : "text"}
        accessibilityLabel={
          isPermissionDenied
            ? "Permiso de ubicación requerido. Toca para activar."
            : pendingQueueCount > 0
              ? "Sin conexión a internet"
              : "Transmitiendo ubicación en vivo"
        }
        className={`mx-5 mb-3 flex-row items-center gap-2.5 rounded-xl px-3.5 py-2.5 border ${
          isPermissionDenied
            ? "border-amber-500/40 bg-amber-500/10 active:bg-amber-500/15"
            : pendingQueueCount > 0
              ? "border-blue-500/40 bg-blue-500/10"
              : "border-lime-500/40 bg-lime-500/10"
        }`}
      >
        {/* Indicador de estado o icono */}
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
              ? "Toca para activar el permiso de ubicación"
              : pendingQueueCount > 0
                ? "Tu ubicación se transmitirá a los participantes de tus envíos una vez que se restablezca"
                : `${inTransitCount} ${inTransitCount === 1 ? "envío" : "envíos"} en camino`}
          </Text>
        </View>
      </Pressable>

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
