import type { PublicProfile } from "@movo/shared/dist/types/user-profile";
import { ShieldCheck, UserRound } from "lucide-react-native";
import { Text, View } from "react-native";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import type { OnFocusInput } from "../../../src/hooks/use-keyboard-scroll";
import { useShipmentWizardStore } from "../../../src/store/shipment-wizard-store";
import { ReceiverSearchField } from "../receiver-search-field";

/** AC4: búsqueda de receptor con confirmación explícita de la selección. */
export function isReceiverStepValid(state: {
  receiver: PublicProfile | null;
}): boolean {
  return state.receiver !== null && state.receiver.isVerified;
}

interface ReceiverStepProps {
  onFocusInput: OnFocusInput;
}

export function ReceiverStep({ onFocusInput }: ReceiverStepProps) {
  const colors = useThemeColors();
  const { receiver, setReceiver } = useShipmentWizardStore();

  return (
    <View className="gap-6">
      <View className="mt-2 mb-1 h-14 w-14 items-center justify-center rounded-[14px] bg-lime-200">
        <UserRound size={26} color="#0A0A0B" strokeWidth={1.8} />
      </View>
      <View>
        <Text className="mb-1.5 font-sans-semibold text-title text-fg">
          ¿Quién lo recibe?
        </Text>
        <Text className="font-sans text-body text-fg-2">
          Buscá por nombre y apellido, y confirmá al receptor.
        </Text>
      </View>

      <ReceiverSearchField
        testID="receiver-step-search"
        selected={receiver}
        onSelect={setReceiver}
        onClear={() => setReceiver(null)}
        onFocusInput={onFocusInput}
      />

      <View
        testID="receiver-step-verification-banner"
        className="flex-row items-start gap-2.5 rounded-[10px] border border-border bg-bg-sub px-3.5 py-3"
      >
        <ShieldCheck size={16} strokeWidth={1.8} color={colors.fg2} />
        <Text className="flex-1 font-sans text-[12px] text-fg-2">
          El receptor de tu paquete debe ser un miembro verificado de la
          comunidad Movo, esto nos permite mantener los envíos totalmente
          seguros y te da la tranquilidad de que tu paquete llegará a la persona
          correcta.
        </Text>
      </View>
    </View>
  );
}
