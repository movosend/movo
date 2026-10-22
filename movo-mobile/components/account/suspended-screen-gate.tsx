import type { ReactNode } from "react";
import { router } from "expo-router";
import { ShieldAlert } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CarrierRequirementGate } from "../carrier/carrier-requirement-gate";
import { useActiveSuspension } from "../../src/hooks/use-account-restriction";
import {
  suspendedActionMessage,
  type SuspendedAction,
} from "../../src/lib/account-restriction";

export interface SuspendedScreenGateProps {
  action: SuspendedAction;
  children: ReactNode;
  testID?: string;
}

/**
 * Pantalla de un formulario que inicia algo nuevo: el wizard de envío (que también cotiza),
 * ofertar, declarar un viaje e invitar a otro receptor. Con la cuenta suspendida se reemplaza
 * por el bloqueo (MOVO-300 AC2). Los botones de entrada ya están deshabilitados; esto cubre las
 * entradas secundarias y una suspensión que llega con el formulario abierto: en vez de completarlo
 * y recibir el 403 del gateway al final, el usuario ve el motivo apenas se refresca el perfil.
 */
export function SuspendedScreenGate({
  action,
  children,
  testID,
}: SuspendedScreenGateProps) {
  const suspension = useActiveSuspension();
  if (!suspension) return <>{children}</>;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <CarrierRequirementGate
        testID={testID}
        icon={ShieldAlert}
        title="Tu cuenta está suspendida"
        body={suspendedActionMessage(action, suspension)}
        ctaLabel="Ver detalle"
        onPressCta={() => router.replace("/account-status" as any)}
      />
    </SafeAreaView>
  );
}
