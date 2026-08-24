import { Check } from "lucide-react-native";
import { useEffect } from "react";
import { Text, View } from "react-native";

const AUTO_DISMISS_MS = 3000;

interface SuccessBannerProps {
  message: string | null;
  onDismiss?: () => void;
  /** `0` desactiva el auto-ocultado. */
  autoDismissMs?: number;
  testID?: string;
}

/**
 * Confirmación de éxito a nivel de pantalla — espejo de `ErrorBanner` (MOVO-73) para
 * el otro tono. Nace en MOVO-135: el AC2 pide "confirmación visual" al guardar el
 * perfil, y hasta ahora el repo no tenía ningún patrón para eso (las mutaciones se
 * confirmaban solas cerrando la pantalla, y `Alert.alert` nunca se usó para éxito).
 *
 * A diferencia de `ErrorBanner` —persistente a propósito, porque un error hay que
 * poder leerlo con calma y reintentar— este **sí** se auto-oculta: una confirmación
 * que se queda fija termina leyéndose como estado permanente de la pantalla.
 *
 * Sin librería de toast: es una dependencia nueva que no se justifica por un banner
 * (mismo criterio ya documentado en `profile-settings-section.tsx`).
 */
export function SuccessBanner({
  message,
  onDismiss,
  autoDismissMs = AUTO_DISMISS_MS,
  testID,
}: SuccessBannerProps) {
  useEffect(() => {
    if (!message || autoDismissMs <= 0 || !onDismiss) return;
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [message, autoDismissMs, onDismiss]);

  if (!message) return null;

  return (
    <View
      testID={testID}
      className="mb-4 flex-row items-center gap-2 rounded-[10px] border border-success-300 bg-success-100 px-3.5 py-3"
    >
      <Check size={16} strokeWidth={2.2} color="#16754A" />
      <Text className="flex-1 font-sans text-[13px] text-ink-950">{message}</Text>
    </View>
  );
}
